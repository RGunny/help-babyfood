import { DomainError } from '../errors.js';
import { addDays, compareDates, daysBetween, localDate, minDate } from './local-date.js';
import { compareDateTimes, isAtOrBefore, localTime } from './local-time.js';

describe('LocalDate', () => {
  it('YYYY-MM-DD 형식의 실제 날짜를 받는다', () => {
    expect(localDate('2026-09-21')).toBe('2026-09-21');
  });

  it.each(['2026-9-21', '20260921', '2026-09-21T00:00', '', 'abc'])('형식이 다른 값 "%s"은 거부한다', (value) => {
    expect(() => localDate(value)).toThrow(DomainError);
  });

  it.each(['2026-02-29', '2026-13-01', '2026-04-31', '2026-00-10'])('존재하지 않는 날짜 %s은 거부한다', (value) => {
    expect(() => localDate(value)).toThrow(DomainError);
  });

  it('윤년의 2월 29일은 받는다', () => {
    expect(localDate('2028-02-29')).toBe('2028-02-29');
  });

  it('0일을 더하면 같은 날짜다', () => {
    expect(addDays(localDate('2026-09-21'), 0)).toBe('2026-09-21');
  });

  it('조리일 9/20에 14일을 더하면 10/4다', () => {
    expect(addDays(localDate('2026-09-20'), 14)).toBe('2026-10-04');
  });

  it('달과 해를 넘겨 더하고 뺀다', () => {
    expect(addDays(localDate('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(localDate('2026-03-01'), -1)).toBe('2026-02-28');
  });

  it('두 날짜 사이의 일수를 센다', () => {
    expect(daysBetween(localDate('2026-08-17'), localDate('2026-08-17'))).toBe(0);
    expect(daysBetween(localDate('2026-08-17'), localDate('2026-08-21'))).toBe(4);
    expect(daysBetween(localDate('2026-08-21'), localDate('2026-08-17'))).toBe(-4);
  });

  it('날짜를 비교한다', () => {
    expect(compareDates(localDate('2026-08-17'), localDate('2026-08-18'))).toBe(-1);
    expect(compareDates(localDate('2026-08-18'), localDate('2026-08-17'))).toBe(1);
    expect(compareDates(localDate('2026-08-17'), localDate('2026-08-17'))).toBe(0);
  });

  it('가장 이른 날짜를 고르고, 비어 있으면 null이다', () => {
    expect(minDate([])).toBeNull();
    expect(minDate([localDate('2026-09-01'), localDate('2026-08-17')])).toBe('2026-08-17');
  });
});

describe('LocalTime', () => {
  it('HH:mm 형식을 받는다', () => {
    expect(localTime('10:00')).toBe('10:00');
    expect(localTime('00:00')).toBe('00:00');
    expect(localTime('23:59')).toBe('23:59');
  });

  it.each(['24:00', '9:00', '10:60', '10', ''])('형식이 다른 값 "%s"은 거부한다', (value) => {
    expect(() => localTime(value)).toThrow(DomainError);
  });

  it('같은 날이면 시각으로, 다른 날이면 날짜로 선후를 가린다', () => {
    const mealTime = { date: localDate('2026-08-20'), time: localTime('10:00') };

    expect(isAtOrBefore(mealTime, { date: localDate('2026-08-20'), time: localTime('10:00') })).toBe(true);
    expect(isAtOrBefore(mealTime, { date: localDate('2026-08-20'), time: localTime('09:59') })).toBe(false);
    expect(isAtOrBefore(mealTime, { date: localDate('2026-08-21'), time: localTime('00:00') })).toBe(true);
    expect(isAtOrBefore(mealTime, { date: localDate('2026-08-19'), time: localTime('23:59') })).toBe(false);
  });

  it('날짜와 시각을 함께 비교한다', () => {
    const a = { date: localDate('2026-08-20'), time: localTime('10:00') };
    const later = { date: localDate('2026-08-20'), time: localTime('17:00') };
    const nextDay = { date: localDate('2026-08-21'), time: localTime('09:00') };

    expect(compareDateTimes(a, a)).toBe(0);
    expect(compareDateTimes(a, later)).toBe(-1);
    expect(compareDateTimes(later, a)).toBe(1);
    expect(compareDateTimes(later, nextDay)).toBe(-1);
    expect(compareDateTimes(nextDay, later)).toBe(1);
  });
});
