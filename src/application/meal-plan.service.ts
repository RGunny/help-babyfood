import { DomainError } from '../domain/errors.js';
import { CalendarDay, projectCalendar } from '../domain/meal-plan/calendar-projection.js';
import { Meal } from '../domain/meal-plan/meal.js';
import { MealComposition } from '../domain/menu/menu.js';
import { LocalDate } from '../domain/shared/local-date.js';
import { MealSlot } from '../domain/shared/meal-slot.js';
import { HouseholdState } from './household-state.js';
import { reconcile, ReconcileReport } from './reconcile.service.js';
import { Actor, HouseholdReader, HouseholdWriter } from './ports/household-write.port.js';

/** What a parent says a meal is made of, in the names they use. */
export interface CompositionInput {
  readonly baseMenuName: string | null;
  readonly toppingIngredientNames: readonly string[];
}

export interface UpdatePlannedMealCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly date: LocalDate;
  readonly slot: MealSlot;
  readonly composition: CompositionInput;
  readonly memo?: string | null;
}

export interface UpdateMealActualCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly date: LocalDate;
  readonly slot: MealSlot;
  /** Null clears the correction and puts the meal back on its plan. */
  readonly composition: CompositionInput | null;
}

export class MealPlanService {
  constructor(
    private readonly writer: HouseholdWriter,
    private readonly reader: HouseholdReader,
  ) {}

  /** Changes what a meal is supposed to be. Stock follows in the same transaction. */
  async updatePlannedMeal(command: UpdatePlannedMealCommand): Promise<ReconcileReport> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'update_planned_meal',
        idempotencyKey: command.idempotencyKey,
        payload: { date: command.date, slot: command.slot, composition: command.composition, memo: command.memo },
      },
      async (context) => {
        const state = await context.load({ sinceDate: command.date });
        const meal = mealOn(state, command.slot, command.date);
        await context.upsertMeal({
          ...meal,
          planned: resolve(state, command.composition),
          memo: command.memo === undefined ? meal.memo : command.memo,
        });
        // 바뀐 내용으로 기존 소비를 취소하고 다시 차감한다. 둘은 같은 트랜잭션이어야 한다.
        return await reconcile(context);
      },
    );
  }

  /**
   * Records what was really fed. Reconciliation then reverts the old consumption and deducts the
   * new one; a half-applied correction would silently change the stock count.
   */
  async updateMealActualItems(command: UpdateMealActualCommand): Promise<ReconcileReport> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'update_meal_actual_items',
        idempotencyKey: command.idempotencyKey,
        payload: { date: command.date, slot: command.slot, composition: command.composition },
      },
      async (context) => {
        const state = await context.load({ sinceDate: command.date });
        const meal = mealOn(state, command.slot, command.date);
        await context.upsertMeal({
          ...meal,
          actual: command.composition === null ? null : resolve(state, command.composition),
        });
        return await reconcile(context);
      },
    );
  }

  /** What parents see: each date with its day number and the meal of every slot. */
  async getMealPlan(householdId: string, from: LocalDate, to: LocalDate): Promise<CalendarDay[]> {
    return await this.reader.read(
      householdId,
      (state) => projectCalendar(state.meals, state.calendar, from, to),
      { sinceDate: from },
    );
  }
}

function mealOn(state: HouseholdState, slot: MealSlot, date: LocalDate): Meal {
  if (!state.calendar.hasSlot(slot)) {
    throw new DomainError('SLOT_NOT_SCHEDULED', `설정되지 않은 끼니입니다: ${slot}`);
  }
  const order = state.calendar.orderAt(slot, date);
  const meal = order === null ? undefined : state.meals.find((candidate) => candidate.slot === slot && candidate.order === order);
  if (meal === undefined) {
    throw new DomainError('SLOT_NOT_SCHEDULED', `그 날짜와 끼니에 식단이 없습니다: ${date} ${slot}`);
  }
  return meal;
}

/** Names come from the parent; unknown ones cannot be deducted, so they are rejected here. */
function resolve(state: HouseholdState, input: CompositionInput): MealComposition {
  const baseMenuId =
    input.baseMenuName === null
      ? null
      : ([...state.menus.values()].find((menu) => menu.name === input.baseMenuName)?.id ??
        raise('UNKNOWN_MENU', `등록되지 않은 메뉴입니다: ${input.baseMenuName}`));

  return {
    baseMenuId,
    toppingIngredientIds: input.toppingIngredientNames.map(
      (name) =>
        state.catalog.findByName(name)?.id ?? raise('UNKNOWN_INGREDIENT', `등록되지 않은 재료입니다: ${name}`),
    ),
  };
}

function raise(code: 'UNKNOWN_MENU' | 'UNKNOWN_INGREDIENT', message: string): never {
  throw new DomainError(code, message);
}
