import { DomainError } from '../errors.js';
import { LocalDate, addDays, localDate } from '../shared/local-date.js';
import { localTime } from '../shared/local-time.js';
import { MealSlot } from '../shared/meal-slot.js';
import { MealCalendar, NoFeedRecord, SlotSchedule } from './meal-calendar.js';

const morning: SlotSchedule = {
  slot: 'morning',
  startDate: localDate('2026-08-17'),
  mealTime: localTime('10:00'),
};
const afternoon: SlotSchedule = {
  slot: 'afternoon',
  startDate: localDate('2026-08-17'),
  mealTime: localTime('17:00'),
};
const noFeed = (date: string, slot: MealSlot, thawed = false): NoFeedRecord => ({
  date: localDate(date),
  slot,
  thawed,
  reason: null,
});

describe('식단 날짜 계산', () => {
  it('미급여가 없으면 k번째 식단은 시작일 + (k-1)일이다', () => {
    const calendar = new MealCalendar([morning], []);

    expect(calendar.dateOf('morning', 1)).toBe('2026-08-17');
    expect(calendar.dateOf('morning', 4)).toBe('2026-08-20');
    expect(calendar.dateOf('morning', 35)).toBe('2026-09-20');
  });

  it('8/20에 못 먹이면 4번째 식단은 8/21로 밀리고 이후 식단도 하루씩 밀린다', () => {
    const calendar = new MealCalendar([morning], [noFeed('2026-08-20', 'morning')]);

    expect(calendar.dateOf('morning', 3)).toBe('2026-08-19');
    expect(calendar.dateOf('morning', 4)).toBe('2026-08-21');
    expect(calendar.dateOf('morning', 5)).toBe('2026-08-22');
  });

  it('연속된 미급여는 그만큼 더 민다', () => {
    const calendar = new MealCalendar([morning], [noFeed('2026-08-21', 'morning'), noFeed('2026-08-20', 'morning')]);

    expect(calendar.dateOf('morning', 4)).toBe('2026-08-22');
  });

  it('밀려난 자리에 또 미급여가 있으면 한 번 더 민다', () => {
    const calendar = new MealCalendar([morning], [noFeed('2026-08-18', 'morning'), noFeed('2026-08-20', 'morning')]);

    // 2번째: 8/18 → 8/19, 3번째: 8/19 → 8/20(미급여) → 8/21
    expect(calendar.dateOf('morning', 2)).toBe('2026-08-19');
    expect(calendar.dateOf('morning', 3)).toBe('2026-08-21');
  });

  it('미래 날짜를 미급여로 미리 등록하면 그 뒤 식단만 밀린다', () => {
    const calendar = new MealCalendar([morning], [noFeed('2026-09-25', 'morning')]);

    expect(calendar.dateOf('morning', 39)).toBe('2026-09-24');
    expect(calendar.dateOf('morning', 40)).toBe('2026-09-26');
  });

  it('끼니는 따로 밀린다: 오후만 못 먹이면 오전 식단의 날짜는 그대로다', () => {
    const calendar = new MealCalendar([morning, afternoon], [noFeed('2026-08-20', 'afternoon')]);

    expect(calendar.dateOf('morning', 4)).toBe('2026-08-20');
    expect(calendar.dateOf('morning', 5)).toBe('2026-08-21');
    expect(calendar.dateOf('afternoon', 4)).toBe('2026-08-21');
    expect(calendar.dateOf('afternoon', 5)).toBe('2026-08-22');
  });

  it('식단시간은 끼니 설정에서 온다', () => {
    const calendar = new MealCalendar([morning, afternoon], []);

    expect(calendar.scheduledAt('afternoon', 2)).toEqual({ date: '2026-08-18', time: '17:00' });
  });

  it('미급여 기록을 지우면 날짜가 원래대로 돌아온다', () => {
    const shifted = new MealCalendar([morning], []).withNoFeed(noFeed('2026-08-20', 'morning'));
    const restored = shifted.withoutNoFeed('morning', localDate('2026-08-20'));

    expect(shifted.dateOf('morning', 4)).toBe('2026-08-21');
    expect(restored.dateOf('morning', 4)).toBe('2026-08-20');
  });
});

describe('날짜에서 식단 찾기', () => {
  it('8/20 오전만 못 먹였으면 8/21 오전은 4번째, 오후는 5번째 식단이다', () => {
    const calendar = new MealCalendar([morning, afternoon], [noFeed('2026-08-20', 'morning')]);

    expect(calendar.orderAt('morning', localDate('2026-08-21'))).toBe(4);
    expect(calendar.orderAt('afternoon', localDate('2026-08-21'))).toBe(5);
  });

  it('미급여 날짜에는 식단이 놓이지 않는다', () => {
    const calendar = new MealCalendar([morning], [noFeed('2026-08-20', 'morning')]);

    expect(calendar.orderAt('morning', localDate('2026-08-20'))).toBeNull();
  });

  it('끼니 시작일 이전에는 식단이 없다', () => {
    const calendar = new MealCalendar([morning], []);

    expect(calendar.orderAt('morning', localDate('2026-08-16'))).toBeNull();
  });
});

describe('일차 계산', () => {
  it('시작일이 1일차다', () => {
    expect(new MealCalendar([morning], []).dayNumberOn(localDate('2026-08-17'))).toBe(1);
  });

  it('시작일 이전은 일차가 없다', () => {
    expect(new MealCalendar([morning], []).dayNumberOn(localDate('2026-08-16'))).toBeNull();
  });

  it('끼니 설정이 없으면 일차가 없다', () => {
    const calendar = new MealCalendar([], []);

    expect(calendar.feedingStartDate).toBeNull();
    expect(calendar.dayNumberOn(localDate('2026-08-17'))).toBeNull();
  });

  it('8/20 오전만 못 먹이고 오후를 먹였으면 8/20은 4일차로 끝나고 8/21은 5일차다', () => {
    const calendar = new MealCalendar([morning, afternoon], [noFeed('2026-08-20', 'morning')]);

    expect(calendar.dayNumberOn(localDate('2026-08-20'))).toBe(4);
    expect(calendar.dayNumberOn(localDate('2026-08-21'))).toBe(5);
  });

  it('8/20에 두 끼를 모두 못 먹였으면 8/20은 일차가 없고 8/21이 4일차다', () => {
    const calendar = new MealCalendar(
      [morning, afternoon],
      [noFeed('2026-08-20', 'morning'), noFeed('2026-08-20', 'afternoon')],
    );

    expect(calendar.dayNumberOn(localDate('2026-08-19'))).toBe(3);
    expect(calendar.dayNumberOn(localDate('2026-08-20'))).toBeNull();
    expect(calendar.dayNumberOn(localDate('2026-08-21'))).toBe(4);
  });

  it('끼니가 오전 하나뿐이면 오전 미급여가 곧 전체 미급여다', () => {
    const calendar = new MealCalendar([morning], [noFeed('2026-08-20', 'morning')]);

    expect(calendar.dayNumberOn(localDate('2026-08-20'))).toBeNull();
    expect(calendar.dayNumberOn(localDate('2026-08-21'))).toBe(4);
  });

  it('오후 끼니가 나중에 시작되면 그 전 날짜는 오전만으로 전체 미급여를 판단한다', () => {
    const lateAfternoon: SlotSchedule = { ...afternoon, startDate: localDate('2026-09-01') };
    const calendar = new MealCalendar(
      [morning, lateAfternoon],
      [noFeed('2026-08-20', 'morning'), noFeed('2026-09-02', 'morning')],
    );

    // 8/20에는 오전 끼니뿐이므로 전체 미급여, 9/2에는 오후를 먹였으므로 일차에 든다.
    expect(calendar.dayNumberOn(localDate('2026-08-21'))).toBe(4);
    expect(calendar.dayNumberOn(localDate('2026-09-02'))).toBe(16);
    expect(calendar.activeSlotsOn(localDate('2026-08-31'))).toEqual(['morning']);
    expect(calendar.activeSlotsOn(localDate('2026-09-01'))).toEqual(['morning', 'afternoon']);
    expect(calendar.dateOf('afternoon', 1)).toBe('2026-09-01');
  });

  it('기준 날짜 이후의 전체 미급여일은 일차에 영향을 주지 않는다', () => {
    const calendar = new MealCalendar([morning], [noFeed('2026-08-25', 'morning')]);

    expect(calendar.dayNumberOn(localDate('2026-08-21'))).toBe(5);
  });
});

describe('미급여 기록 검증', () => {
  const calendar = new MealCalendar([morning], [noFeed('2026-08-20', 'morning')]);

  it('같은 날짜와 끼니를 두 번 등록할 수 없다', () => {
    expect(() => calendar.withNoFeed(noFeed('2026-08-20', 'morning'))).toThrow(DomainError);
  });

  it('끼니 시작일 이전은 등록할 수 없다', () => {
    expect(() => calendar.withNoFeed(noFeed('2026-08-16', 'morning'))).toThrow(DomainError);
  });

  it('설정되지 않은 끼니에는 등록할 수 없다', () => {
    expect(() => calendar.withNoFeed(noFeed('2026-08-21', 'afternoon'))).toThrow(DomainError);
  });

  it('없는 기록은 지울 수 없다', () => {
    expect(() => calendar.withoutNoFeed('morning', localDate('2026-08-21'))).toThrow(DomainError);
  });

  it('끼니 설정이 겹치면 거부한다', () => {
    expect(() => new MealCalendar([morning, morning], [])).toThrow(DomainError);
  });

  it('식단 순서는 1 이상의 정수여야 한다', () => {
    expect(() => calendar.dateOf('morning', 0)).toThrow(DomainError);
    expect(() => calendar.dateOf('morning', 1.5)).toThrow(DomainError);
  });

  it('시작일 이전이거나 없는 끼니의 미급여 기록은 계산에서 무시한다', () => {
    const tolerant = new MealCalendar([morning], [noFeed('2026-08-10', 'morning'), noFeed('2026-08-18', 'afternoon')]);

    expect(tolerant.noFeedRecords).toEqual([]);
    expect(tolerant.dateOf('morning', 2)).toBe('2026-08-18');
  });
});

describe('불변식: 시작일부터 8일 안의 모든 미급여 조합(256가지)', () => {
  const windowDates: LocalDate[] = Array.from({ length: 8 }, (_, i) => addDays(morning.startDate, i));
  const combinations = Array.from({ length: 2 ** windowDates.length }, (_, mask) =>
    windowDates.filter((_, bit) => (mask >> bit) & 1),
  );

  it('식단 순서대로 날짜가 늘어나고, 미급여 날짜에는 식단이 없고, 먹이는 날에는 빈자리가 없다', () => {
    for (const skippedDates of combinations) {
      const skipped = new Set(skippedDates);
      const calendar = new MealCalendar(
        [morning],
        skippedDates.map((date) => noFeed(date, 'morning')),
      );
      const dates = Array.from({ length: 10 }, (_, i) => calendar.dateOf('morning', i + 1));

      dates.forEach((date, i) => {
        expect(skipped.has(date)).toBe(false);
        expect(calendar.orderAt('morning', date)).toBe(i + 1);
        if (i > 0) expect(date > dates[i - 1]).toBe(true);
      });

      const fedDatesInWindow = windowDates.filter((date) => !skipped.has(date));
      expect(dates.slice(0, fedDatesInWindow.length)).toEqual(fedDatesInWindow);

      // 끼니가 하나이므로 일차는 그날 먹이는 식단의 순서와 같다.
      for (const date of fedDatesInWindow) {
        expect(calendar.dayNumberOn(date)).toBe(calendar.orderAt('morning', date));
      }
    }
  });
});
