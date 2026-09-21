import { LocalDate, addDays, daysBetween } from '../shared/local-date.js';
import { CookedBatch } from './ledger.js';

export const DEFAULT_SHELF_LIFE_DAYS = 14;

export type ExpiryStage =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'due_tomorrow' }
  | { readonly kind: 'due_today' }
  /** Past the expiry date and waiting for a parent to throw it away. Still counted as stock. */
  | { readonly kind: 'pending_discard'; readonly overdueDays: number };

export function expiryDateOf(batch: CookedBatch, shelfLifeDays: number): LocalDate {
  return addDays(batch.cookedOn, shelfLifeDays);
}

export function expiryStageOn(batch: CookedBatch, today: LocalDate, shelfLifeDays: number): ExpiryStage {
  const daysLeft = daysBetween(today, expiryDateOf(batch, shelfLifeDays));
  if (daysLeft > 1) return { kind: 'fresh' };
  if (daysLeft === 1) return { kind: 'due_tomorrow' };
  if (daysLeft === 0) return { kind: 'due_today' };
  return { kind: 'pending_discard', overdueDays: -daysLeft };
}
