import { MealStatusChange } from '../../domain/deduction/reconcile.js';
import { Meal } from '../../domain/meal-plan/meal.js';
import { NoFeedRecord } from '../../domain/meal-plan/meal-calendar.js';
import { MealSlot } from '../../domain/shared/meal-slot.js';
import { LocalDate } from '../../domain/shared/local-date.js';
import { LocalDateTime } from '../../domain/shared/local-time.js';
import { CookedBatch, LedgerEntry } from '../../domain/stock/ledger.js';
import { HouseholdState, LoadScope } from '../household-state.js';

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

/**
 * A unit of work inside one transaction on one household. The transaction is already holding the
 * household row, so reads here see every earlier write and no one else can interleave.
 *
 * Services never touch a transaction handle: keeping it out of this interface is what lets the
 * application layer stay free of Prisma types.
 */
export interface HouseholdWriteContext {
  readonly householdId: string;
  readonly now: LocalDateTime;
  load(scope?: LoadScope): Promise<HouseholdState>;

  appendLedgerEntries(entries: readonly LedgerEntry[]): Promise<void>;
  applyMealStatuses(changes: readonly MealStatusChange[]): Promise<void>;
  /** Ids come from the store, so they are time-ordered and the ledger can reference them at once. */
  insertCookedBatch(draft: CookedBatchDraft): Promise<CookedBatch>;
  addNoFeedRecord(record: NoFeedRecord): Promise<void>;
  removeNoFeedRecord(slot: MealSlot, date: LocalDate): Promise<void>;
  /** Identified by slot and order, which is what makes a meal a meal. */
  upsertMeal(draft: MealDraft): Promise<Meal>;
}

export type CookedBatchDraft = Omit<CookedBatch, 'id'>;
export type MealDraft = Omit<Meal, 'id'>;

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
