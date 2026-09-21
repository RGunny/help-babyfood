import { Ingredient } from '../domain/ingredient/ingredient.js';
import { IngredientCatalog } from '../domain/ingredient/ingredient-catalog.js';
import { Meal } from '../domain/meal-plan/meal.js';
import { MealCalendar } from '../domain/meal-plan/meal-calendar.js';
import { Menu } from '../domain/menu/menu.js';
import { MealPlanningRules } from '../domain/rules/meal-rules.js';
import { LocalDate } from '../domain/shared/local-date.js';
import { LocalDateTime } from '../domain/shared/local-time.js';
import { CookedBatch, LedgerEntry } from '../domain/stock/ledger.js';
import { ReconcileInput } from '../domain/deduction/reconcile.js';

/**
 * Everything the domain functions need for one household, in domain types. The repository decides
 * how much of the history to read; see `LoadScope`.
 */
export interface HouseholdState {
  readonly householdId: string;
  readonly ingredients: readonly Ingredient[];
  readonly catalog: IngredientCatalog;
  readonly menus: ReadonlyMap<string, Menu>;
  readonly calendar: MealCalendar;
  readonly meals: readonly Meal[];
  readonly batches: readonly CookedBatch[];
  readonly entries: readonly LedgerEntry[];
  readonly rules: MealPlanningRules;
  readonly shelfLifeDays: number;
}

/**
 * Widens the default read window for requests that reach further than it.
 *
 * The default window covers meals whose computed date is within `LOOKBACK_DAYS`, every batch with
 * cubes left, and every ledger entry of those batches. That is enough for reconciliation, but not
 * for a request that names something older.
 */
export interface LoadScope {
  /** A date the request names, such as a no-feed being registered days late. */
  readonly sinceDate?: LocalDate;
  /** Discards to be reversed may sit on batches that the discard itself emptied. */
  readonly noFeedKeys?: readonly string[];
  /** A counted or discarded batch may have no cubes left and still be the subject. */
  readonly batchIds?: readonly string[];
}

export function toReconcileInput(state: HouseholdState, now: LocalDateTime): ReconcileInput {
  return {
    now,
    meals: state.meals,
    calendar: state.calendar,
    menus: state.menus,
    catalog: state.catalog,
    batches: state.batches,
    entries: state.entries,
  };
}
