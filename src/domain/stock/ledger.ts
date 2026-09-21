import { DomainError } from '../errors.js';
import { LocalDate } from '../shared/local-date.js';

/** Cubes of one ingredient cooked on the same day. The unit of stock, instead of single cubes. */
export interface CookedBatch {
  readonly id: string;
  readonly ingredientId: string;
  readonly cubeWeightGram: number;
  readonly cookedOn: LocalDate;
}

/** Deduction order: oldest cooking date first, batch id as a stable tie-breaker. */
export function oldestCookedFirst(a: CookedBatch, b: CookedBatch): number {
  if (a.cookedOn !== b.cookedOn) return a.cookedOn < b.cookedOn ? -1 : 1;
  return a.id.localeCompare(b.id);
}

export type LedgerEntryType = 'received' | 'meal_consumed' | 'consumption_reverted' | 'discarded' | 'count_adjusted';

export type DiscardReason = 'expired' | 'thawed_not_fed' | 'other';

/**
 * One change of stock. Remaining cubes are always the sum of entries and are never overwritten,
 * so undoing means appending the opposite entry.
 */
export interface LedgerEntry {
  readonly batchId: string;
  readonly type: LedgerEntryType;
  /** Positive adds cubes, negative removes them. */
  readonly delta: number;
  /** Set for `meal_consumed` and `consumption_reverted`, and for a discard caused by a skipped meal. */
  readonly mealId: string | null;
  readonly reason: string | null;
  /** Links a thawed-cube discard, and its reversal, to the no-feed record that caused it. */
  readonly noFeedKey?: string;
}

const REQUIRED_SIGN: Record<LedgerEntryType, 'positive' | 'negative' | 'nonzero'> = {
  received: 'positive',
  meal_consumed: 'negative',
  consumption_reverted: 'positive',
  discarded: 'negative',
  count_adjusted: 'nonzero',
};

export function assertValidEntry(entry: LedgerEntry): void {
  const sign = REQUIRED_SIGN[entry.type];
  const valid =
    Number.isInteger(entry.delta) &&
    ((sign === 'positive' && entry.delta > 0) ||
      (sign === 'negative' && entry.delta < 0) ||
      (sign === 'nonzero' && entry.delta !== 0));
  if (!valid) {
    throw new DomainError('INVALID_LEDGER_ENTRY', `${entry.type} 이벤트의 증감이 올바르지 않습니다: ${entry.delta}`);
  }
  const needsMeal = entry.type === 'meal_consumed' || entry.type === 'consumption_reverted';
  if (needsMeal && entry.mealId === null) {
    throw new DomainError('INVALID_LEDGER_ENTRY', `${entry.type} 이벤트에는 식단이 있어야 합니다`);
  }
}

export function remainingByBatch(entries: readonly LedgerEntry[]): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const entry of entries) {
    assertValidEntry(entry);
    remaining.set(entry.batchId, (remaining.get(entry.batchId) ?? 0) + entry.delta);
  }
  return remaining;
}

/** Cubes each batch currently gives to a meal: consumed minus reverted. */
export function netConsumedByBatch(entries: readonly LedgerEntry[], mealId: string): Map<string, number> {
  const consumed = new Map<string, number>();
  for (const entry of entries) {
    if (entry.mealId !== mealId) continue;
    if (entry.type !== 'meal_consumed' && entry.type !== 'consumption_reverted') continue;
    const net = (consumed.get(entry.batchId) ?? 0) - entry.delta;
    if (net === 0) consumed.delete(entry.batchId);
    else consumed.set(entry.batchId, net);
  }
  return consumed;
}

export function receiveBatch(batch: CookedBatch, cubes: number): LedgerEntry {
  const entry: LedgerEntry = { batchId: batch.id, type: 'received', delta: cubes, mealId: null, reason: null };
  assertValidEntry(entry);
  return entry;
}

/** Parents threw the batch away. Removes whatever is left, which may be less than what was received. */
export function discardRemaining(batchId: string, entries: readonly LedgerEntry[], reason: DiscardReason): LedgerEntry {
  const remaining = remainingByBatch(entries).get(batchId) ?? 0;
  if (remaining <= 0) {
    throw new DomainError('NOTHING_TO_DISCARD', `폐기할 큐브가 남아 있지 않습니다: ${batchId}`);
  }
  return { batchId, type: 'discarded', delta: -remaining, mealId: null, reason };
}

/** Parents counted the freezer and found a different number. */
export function adjustToCountedCubes(
  batchId: string,
  entries: readonly LedgerEntry[],
  countedCubes: number,
  reason: string | null,
): LedgerEntry | null {
  if (!Number.isInteger(countedCubes) || countedCubes < 0) {
    throw new DomainError('ADJUSTMENT_BELOW_ZERO', `실사 수량은 0 이상의 정수여야 합니다: ${countedCubes}`);
  }
  const remaining = remainingByBatch(entries).get(batchId) ?? 0;
  if (countedCubes === remaining) return null;
  return { batchId, type: 'count_adjusted', delta: countedCubes - remaining, mealId: null, reason };
}
