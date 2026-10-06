import { DomainError } from '../domain/errors.js';
import { projectCalendar } from '../domain/meal-plan/calendar-projection.js';
import { Meal } from '../domain/meal-plan/meal.js';
import { MealComposition } from '../domain/menu/menu.js';
import { RuleWarning, validateMealPlan } from '../domain/rules/meal-rules.js';
import { LocalDate } from '../domain/shared/local-date.js';
import { MealSlot } from '../domain/shared/meal-slot.js';
import { resolveComposition } from './composition.js';
import { ApplicationError } from './errors.js';
import {
  fedIngredientIdsBefore,
  introductionStatuses,
  reactedIngredientIds,
} from './feeding-history.js';
import { HouseholdState } from './household-state.js';
import { MealDraftInput } from './meal-plan.service.js';
import { FeedingHistoryPort } from './ports/feeding-history.port.js';
import { Actor, HouseholdReader, HouseholdWriter } from './ports/household-write.port.js';

export interface ImportMealPlanCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly slot: MealSlot;
  /** The spreadsheet rows in the order the parent listed them, oldest first. */
  readonly meals: readonly MealDraftInput[];
  /**
   * Last date the baby was already fed before the service existed. Meals landing on or before it
   * are recorded as feeding history and never touch the ledger. Null imports a plan only.
   */
  readonly fedThrough: LocalDate | null;
}

/** One row of the preview: where the meal lands and whether it counts as already fed. */
export interface ImportedMeal {
  readonly order: number;
  readonly date: LocalDate;
  readonly migrated: boolean;
  readonly composition: MealComposition;
  readonly memo: string | null;
}

export interface ImportPreview {
  readonly meals: readonly ImportedMeal[];
  /** Constraint violations. They never block: a parent may confirm the plan as it is. */
  readonly warnings: readonly RuleWarning[];
}

/**
 * Brings the spreadsheet in. The agent reads the file and hands over structured rows; the server
 * checks them and stores them.
 *
 * Appending is the only shape available, as it is for `appendMeals`: a meal's date is counted from
 * the slot start, so an order inserted in the middle re-dates every meal after it.
 *
 * What makes this its own use case rather than a flag on `appendMeals` is the migration boundary.
 * Meals fed before the service existed are recorded as consumed but marked migrated, which is what
 * keeps reconciliation from deducting cubes that were eaten months ago — the freezer holds what it
 * holds, and the parent registers that separately as cooked batches.
 */
export class MealPlanImportService {
  constructor(
    private readonly writer: HouseholdWriter,
    private readonly reader: HouseholdReader,
    private readonly history: FeedingHistoryPort,
  ) {}

  /**
   * What the import would do, without doing it. Runs on the read path and writes nothing, so a
   * parent can look at the warnings and correct the spreadsheet before committing.
   */
  async preview(command: ImportMealPlanCommand): Promise<ImportPreview> {
    const history = await this.history.load(command.householdId);
    return await this.reader.read(command.householdId, (state) => {
      const meals = plan(state, command);
      // 경고는 확정 경로와 같은 검증이어야 한다. 미리보기가 통과시킨 것이 확정에서 걸리면
      // 부모는 고칠 곳을 알 수 없다.
      const drafts = meals.map<Meal>((meal) => ({
        id: `preview:${meal.order}`,
        slot: command.slot,
        order: meal.order,
        planned: meal.composition,
        actual: null,
        memo: meal.memo,
        status: meal.migrated ? 'consumed' : 'planned',
        migrated: meal.migrated,
      }));
      const from = meals[0]?.date ?? state.calendar.dateOf(command.slot, 1);
      const days = projectCalendar(
        [...state.meals, ...drafts],
        state.calendar,
        from,
        meals[meals.length - 1]?.date ?? from,
      );
      const statuses = introductionStatuses(history, state.ingredients, state.menus, state.catalog);
      return {
        meals,
        warnings: validateMealPlan({
          days,
          menus: state.menus,
          catalog: state.catalog,
          rules: state.rules,
          alreadyFedIngredientIds: fedIngredientIdsBefore(
            history,
            state.calendar,
            state.menus,
            state.catalog,
            from,
          ),
          reactedIngredientIds: reactedIngredientIds(statuses),
        }),
      };
    });
  }

  /** Stores the plan. One transaction: a half-written spreadsheet would leave the dates wrong. */
  async commit(command: ImportMealPlanCommand): Promise<ImportedMeal[]> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'import_meal_plan',
        idempotencyKey: command.idempotencyKey,
        payload: { slot: command.slot, meals: command.meals, fedThrough: command.fedThrough },
      },
      async (context) => {
        const state = await context.load();
        const meals = plan(state, command);
        // 이관은 끼니가 비어 있을 때만 받는다. 이미 있는 식단 뒤에 과거 식단이 붙으면
        // 순서와 날짜의 대응이 뒤집혀 지나간 날짜의 식단이 미래에 놓인다.
        if (command.fedThrough !== null && (state.nextMealOrders.get(command.slot) ?? 1) > 1) {
          throw new ApplicationError(
            'SLOT_NOT_EMPTY',
            `이미 식단이 있는 끼니에는 이관할 수 없습니다: ${command.slot}`,
          );
        }
        for (const meal of meals) {
          await context.upsertMeal({
            slot: command.slot,
            order: meal.order,
            planned: meal.composition,
            actual: null,
            memo: meal.memo,
            status: meal.migrated ? 'consumed' : 'planned',
            migrated: meal.migrated,
          });
        }
        return meals;
      },
    );
  }
}

/**
 * Places the rows in the slot and decides which of them were already fed.
 *
 * Shared by both paths so that the preview cannot approve something the commit then stores
 * differently. The name resolution throws on an unregistered ingredient or menu, which is why the
 * preview rejects those too.
 */
function plan(state: HouseholdState, command: ImportMealPlanCommand): ImportedMeal[] {
  if (!state.calendar.hasSlot(command.slot)) {
    throw new DomainError('SLOT_NOT_SCHEDULED', `설정되지 않은 끼니입니다: ${command.slot}`);
  }
  const firstOrder = state.nextMealOrders.get(command.slot) ?? 1;
  return command.meals.map((draft, index) => {
    const order = firstOrder + index;
    const date = state.calendar.dateOf(command.slot, order);
    return {
      order,
      date,
      migrated: command.fedThrough !== null && date <= command.fedThrough,
      composition: resolveComposition(state, draft.composition),
      memo: draft.memo ?? null,
    };
  });
}
