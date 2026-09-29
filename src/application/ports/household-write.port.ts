import { MealStatusChange } from '../../domain/deduction/reconcile.js';
import { Ingredient, StockTracking } from '../../domain/ingredient/ingredient.js';
import { FeedingReaction } from '../../domain/ingredient/introduction-status.js';
import { Meal } from '../../domain/meal-plan/meal.js';
import { NoFeedRecord, SlotSchedule } from '../../domain/meal-plan/meal-calendar.js';
import { Menu } from '../../domain/menu/menu.js';
import { MealPlanningRules } from '../../domain/rules/meal-rules.js';
import { MealSlot } from '../../domain/shared/meal-slot.js';
import { LocalDate } from '../../domain/shared/local-date.js';
import { LocalDateTime } from '../../domain/shared/local-time.js';
import { CookedBatch, LedgerEntry } from '../../domain/stock/ledger.js';
import { AlertSettings, HouseholdState, LoadScope } from '../household-state.js';

/** Who caused a change. Reconciliation run by the scheduler has no member behind it. */
export type Actor = { readonly kind: 'member'; readonly memberId: string } | { readonly kind: 'scheduler' };

export interface WriteRequest {
  readonly householdId: string;
  readonly actor: Actor;
  /** Operation name recorded with the idempotency key, so a key cannot be reused across tools. */
  readonly operation: string;
  /** Absent for operations that are idempotent by construction, such as reconciliation. */
  readonly idempotencyKey?: string;
  /** Hashed and compared on retry: the same key with a different body is a mistake, not a retry. */
  readonly payload?: unknown;
}

export type CookedBatchDraft = Omit<CookedBatch, 'id'>;
export type MealDraft = Omit<Meal, 'id'>;
export type IngredientDraft = Omit<Ingredient, 'id'> & { readonly verifiedBeforeMigration: boolean };
export type MenuDraft = Omit<Menu, 'id'>;

/** One recorded reaction. A meal and an ingredient identify it, so recording twice is an update. */
export interface FeedingReactionDraft {
  readonly mealId: string;
  readonly ingredientId: string;
  readonly result: FeedingReaction;
  readonly symptomMemo: string | null;
}

/** Stock changes. Each entry moves the ledger and the batch's projected count together. */
export interface LedgerWrites {
  appendLedgerEntries(entries: readonly LedgerEntry[]): Promise<void>;
  /** Ids come from the store, so they are time-ordered and the ledger can reference them at once. */
  insertCookedBatch(draft: CookedBatchDraft): Promise<CookedBatch>;
}

/** Meals, the no-feed records their dates are computed from, and the reactions they produced. */
export interface MealWrites {
  applyMealStatuses(changes: readonly MealStatusChange[]): Promise<void>;
  /** Identified by slot and order, which is what makes a meal a meal. */
  upsertMeal(draft: MealDraft): Promise<Meal>;
  addNoFeedRecord(record: NoFeedRecord): Promise<void>;
  removeNoFeedRecord(slot: MealSlot, date: LocalDate): Promise<void>;
  recordFeedingReaction(draft: FeedingReactionDraft): Promise<void>;
}

/** The lists parents maintain themselves: ingredients, menus, slots, rules, alert settings. */
export interface CatalogWrites {
  insertIngredient(draft: IngredientDraft): Promise<Ingredient>;
  /** Appends one more name for the ingredient. The position continues the stored ones. */
  addIngredientAlias(ingredientId: string, alias: string): Promise<void>;
  updateServingWeight(ingredientId: string, servingWeightGram: number): Promise<void>;
  updateStockTracking(ingredientId: string, stockTracking: StockTracking): Promise<void>;
  insertMenu(draft: MenuDraft): Promise<Menu>;
  /** Replaces the components as a whole: a partial update could leave an orphan component. */
  updateMenu(menu: Menu): Promise<Menu>;
  insertSlotSchedule(schedule: SlotSchedule): Promise<void>;
  /** Free-text guidance is for the agent, so it travels beside the rules instead of inside them. */
  saveRules(rules: MealPlanningRules, textGuidance: string | null): Promise<void>;
  saveAlertSettings(settings: AlertSettings): Promise<void>;
  saveThresholds(thresholds: ReadonlyMap<string, number>): Promise<void>;
}

/**
 * A unit of work inside one transaction on one household. The transaction is already holding the
 * household row, so reads here see every earlier write and no one else can interleave.
 *
 * Services never touch a transaction handle: keeping it out of this interface is what lets the
 * application layer stay free of Prisma types.
 */
export interface HouseholdWriteContext extends LedgerWrites, MealWrites, CatalogWrites {
  readonly householdId: string;
  readonly now: LocalDateTime;
  load(scope?: LoadScope): Promise<HouseholdState>;
}

export interface HouseholdWriter {
  /**
   * Runs `body` in one transaction. When the request carries an idempotency key that was already
   * used with the same payload, `body` never runs and the recorded result comes back instead.
   */
  write<T>(request: WriteRequest, body: (context: HouseholdWriteContext) => Promise<T>): Promise<T>;
}

/** Read-only access outside a write transaction. */
export interface HouseholdReader {
  read<T>(householdId: string, body: (state: HouseholdState) => T | Promise<T>, scope?: LoadScope): Promise<T>;
}
