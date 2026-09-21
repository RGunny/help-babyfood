import { LocalDate, localDate } from '../../../domain/shared/local-date.js';

/**
 * `LocalDate` is a calendar date in Asia/Seoul, not an instant. PostgreSQL `DATE` carries the same
 * meaning, but the driver hands it over as a JS `Date`, which is an instant. Everything goes
 * through here so the conversion is pinned in one place and cannot drift with the process
 * time zone: we read and write UTC midnight, and never let local-time getters near the value.
 */
export function toLocalDate(value: Date): LocalDate {
  return localDate(value.toISOString().slice(0, 10));
}

export function fromLocalDate(value: LocalDate): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
