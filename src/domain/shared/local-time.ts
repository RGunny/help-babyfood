import { DomainError } from '../errors.js';
import { LocalDate } from './local-date.js';

/** Wall-clock time in Asia/Seoul, formatted as `HH:mm`. */
export type LocalTime = string & { readonly __brand: 'LocalTime' };

export interface LocalDateTime {
  readonly date: LocalDate;
  readonly time: LocalTime;
}

const HOUR_MINUTE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function localTime(value: string): LocalTime {
  if (!HOUR_MINUTE.test(value)) {
    throw new DomainError('INVALID_TIME', `시각 형식이 아닙니다: ${value}`);
  }
  return value as LocalTime;
}

/** True when `a` is at or before `b`. */
export function isAtOrBefore(a: LocalDateTime, b: LocalDateTime): boolean {
  return a.date < b.date || (a.date === b.date && a.time <= b.time);
}

export function compareDateTimes(a: LocalDateTime, b: LocalDateTime): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
}
