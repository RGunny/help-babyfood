import { LocalDate, addDays, daysBetween } from '../shared/local-date.js';
import { CookedBatch } from './ledger.js';

export const DEFAULT_SHELF_LIFE_DAYS = 14;
/** Days before the expiry date from which a batch is called due soon and its row is highlighted. */
export const EXPIRY_NOTICE_DAYS = 3;

export type ExpiryStage =
  | { readonly kind: 'fresh' }
  /** Within EXPIRY_NOTICE_DAYS of the expiry date, the date itself included (daysLeft 3..0). */
  | { readonly kind: 'due_soon'; readonly daysLeft: number }
  /** Past the expiry date. Still stock: parents keep it until they report a discard. */
  | { readonly kind: 'overdue'; readonly overdueDays: number };

export function expiryDateOf(batch: CookedBatch, shelfLifeDays: number): LocalDate {
  return addDays(batch.cookedOn, shelfLifeDays);
}

export function expiryStageOn(batch: CookedBatch, today: LocalDate, shelfLifeDays: number): ExpiryStage {
  const daysLeft = daysBetween(today, expiryDateOf(batch, shelfLifeDays));
  if (daysLeft > EXPIRY_NOTICE_DAYS) return { kind: 'fresh' };
  if (daysLeft >= 0) return { kind: 'due_soon', daysLeft };
  return { kind: 'overdue', overdueDays: -daysLeft };
}
