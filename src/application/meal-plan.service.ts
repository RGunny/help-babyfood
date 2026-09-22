import { DomainError } from '../domain/errors.js';
import { CalendarDay, projectCalendar } from '../domain/meal-plan/calendar-projection.js';
import { Meal } from '../domain/meal-plan/meal.js';
import { RuleWarning, validateMealPlan } from '../domain/rules/meal-rules.js';
import { LocalDate } from '../domain/shared/local-date.js';
import { MealSlot } from '../domain/shared/meal-slot.js';
import { CompositionInput, resolveComposition } from './composition.js';
import {
  fedIngredientIdsBefore,
  introductionStatuses,
  reactedIngredientIds,
} from './feeding-history.js';
import { mealAt } from './household-state.js';
import { reconcile, ReconcileReport } from './reconcile.service.js';
import { FeedingHistoryPort } from './ports/feeding-history.port.js';
import { Actor, HouseholdReader, HouseholdWriter } from './ports/household-write.port.js';

export type { CompositionInput };

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

/** One meal to append, in the order the parent listed it. */
export interface MealDraftInput {
  readonly composition: CompositionInput;
  readonly memo?: string | null;
}

export interface AppendMealsCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly slot: MealSlot;
  readonly meals: readonly MealDraftInput[];
}

/** The calendar a parent reads, together with what the server wants them to look at. */
export interface MealPlanView {
  readonly days: readonly CalendarDay[];
  readonly warnings: readonly RuleWarning[];
}

export class MealPlanService {
  constructor(
    private readonly writer: HouseholdWriter,
    private readonly reader: HouseholdReader,
    private readonly history: FeedingHistoryPort,
  ) {}

  /**
   * Adds meals to the end of a slot. Only appending is possible: a meal's date comes from counting
   * dates from the slot start, so an order inserted in the middle would re-date every meal after it.
   * Changing a date that already has a meal is what `update_planned_meal` is for.
   *
   * No reconciliation runs here, unlike the two updates below. Appending cannot invalidate a
   * deduction that already happened: existing meals keep their order, so they keep their date. A new
   * meal whose meal time has already passed is deducted by the next reconciliation, which is the
   * same path that covers the server having been down.
   */
  async appendMeals(command: AppendMealsCommand): Promise<Meal[]> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'append_meals',
        idempotencyKey: command.idempotencyKey,
        payload: { slot: command.slot, meals: command.meals },
      },
      async (context) => {
        const state = await context.load();
        if (!state.calendar.hasSlot(command.slot)) {
          throw new DomainError('SLOT_NOT_SCHEDULED', `설정되지 않은 끼니입니다: ${command.slot}`);
        }
        const firstOrder = state.nextMealOrders.get(command.slot) ?? 1;
        const meals: Meal[] = [];
        for (const [index, draft] of command.meals.entries()) {
          meals.push(
            await context.upsertMeal({
              slot: command.slot,
              order: firstOrder + index,
              planned: resolveComposition(state, draft.composition),
              actual: null,
              memo: draft.memo ?? null,
              status: 'planned',
              migrated: false,
            }),
          );
        }
        return meals;
      },
    );
  }

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
        const meal = mealAt(state, command.slot, command.date);
        await context.upsertMeal({
          ...meal,
          planned: resolveComposition(state, command.composition),
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
        const meal = mealAt(state, command.slot, command.date);
        await context.upsertMeal({
          ...meal,
          actual: command.composition === null ? null : resolveComposition(state, command.composition),
        });
        return await reconcile(context);
      },
    );
  }

  /**
   * What parents see: each date with its day number and the meal of every slot, plus the rule
   * violations of the planned meals in that range.
   *
   * The warnings have to be recomputed on every read. When only one slot is postponed, meals that
   * were never on the same date end up together, and a pairing or a second first-introduction
   * appears without anyone editing the plan.
   */
  async getMealPlan(householdId: string, from: LocalDate, to: LocalDate): Promise<MealPlanView> {
    const history = await this.history.load(householdId);
    return await this.reader.read(
      householdId,
      (state) => {
        const days = projectCalendar(state.meals, state.calendar, from, to);
        const statuses = introductionStatuses(history, state.ingredients, state.menus);
        return {
          days,
          warnings: validateMealPlan({
            days,
            menus: state.menus,
            rules: state.rules,
            alreadyFedIngredientIds: fedIngredientIdsBefore(history, state.calendar, state.menus, from),
            reactedIngredientIds: reactedIngredientIds(statuses),
          }),
        };
      },
      { sinceDate: from },
    );
  }
}

