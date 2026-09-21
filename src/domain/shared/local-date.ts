import { DomainError } from '../errors.js';

/** Calendar date in Asia/Seoul, formatted as `YYYY-MM-DD`. Not an instant. */
export type LocalDate = string & { readonly __brand: 'LocalDate' };

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localDate(value: string): LocalDate {
  const match = ISO_DATE.exec(value);
  if (!match) {
    throw new DomainError('INVALID_DATE', `날짜 형식이 아닙니다: ${value}`);
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  if (!isRealDate) {
    throw new DomainError('INVALID_DATE', `존재하지 않는 날짜입니다: ${value}`);
  }
  return value as LocalDate;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/** Number of days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(dates: readonly LocalDate[]): LocalDate | null {
  return dates.reduce<LocalDate | null>((min, date) => (min === null || date < min ? date : min), null);
}

function toEpochDay(date: LocalDate): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromEpochDay(epochDay: number): LocalDate {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10) as LocalDate;
}
