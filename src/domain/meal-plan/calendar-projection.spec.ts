import { DomainError } from '../errors.js';
import { localDate } from '../shared/local-date.js';
import { localTime } from '../shared/local-time.js';
import { MealSlot } from '../shared/meal-slot.js';
import { lastPlannedMealDate, projectCalendar } from './calendar-projection.js';
import { Meal, effectiveComposition } from './meal.js';
import { MealCalendar, SlotSchedule } from './meal-calendar.js';

const morning: SlotSchedule = { slot: 'morning', startDate: localDate('2026-08-17'), mealTime: localTime('10:00') };
const afternoon: SlotSchedule = { slot: 'afternoon', startDate: localDate('2026-08-17'), mealTime: localTime('17:00') };

const meal = (slot: MealSlot, order: number, overrides: Partial<Meal> = {}): Meal => ({
  id: `${slot}-${order}`,
  slot,
  order,
  planned: { baseMenuId: 'rice-oatmeal-porridge', toppingIngredientIds: ['beef'] },
  actual: null,
  memo: null,
  status: 'planned',
  migrated: false,
  ...overrides,
});
const meals = [1, 2, 3, 4, 5].flatMap((order) => [meal('morning', order), meal('afternoon', order)]);

describe('달력 투영', () => {
  it('미급여가 없으면 같은 날에 같은 순서의 오전, 오후 식단이 놓인다', () => {
    const [day] = projectCalendar(
      meals,
      new MealCalendar([morning, afternoon], []),
      localDate('2026-08-20'),
      localDate('2026-08-20'),
    );

    expect(day.dayNumber).toBe(4);
    expect(day.slots.map((entry) => entry.meal?.id)).toEqual(['morning-4', 'afternoon-4']);
  });

  it('8/20 오전만 못 먹였으면 8/21은 5일차이고 오전 4번째, 오후 5번째 식단을 먹인다', () => {
    const calendar = new MealCalendar(
      [morning, afternoon],
      [{ date: localDate('2026-08-20'), slot: 'morning', thawed: false, reason: '감기' }],
    );

    const [aug20, aug21] = projectCalendar(meals, calendar, localDate('2026-08-20'), localDate('2026-08-21'));

    expect(aug20.dayNumber).toBe(4);
    expect(aug20.slots[0]).toMatchObject({ slot: 'morning', meal: null, noFeed: { reason: '감기' } });
    expect(aug20.slots[1].meal?.id).toBe('afternoon-4');
    expect(aug21.dayNumber).toBe(5);
    expect(aug21.slots.map((entry) => entry.meal?.id)).toEqual(['morning-4', 'afternoon-5']);
  });

  it('식단표가 끝난 뒤의 날짜는 식단이 비어 있다', () => {
    const [day] = projectCalendar(
      meals,
      new MealCalendar([morning], []),
      localDate('2026-08-22'),
      localDate('2026-08-22'),
    );

    expect(day.slots).toEqual([{ slot: 'morning', meal: null, noFeed: null }]);
  });

  it('끼니 시작일 이전 날짜에는 끼니 자체가 없다', () => {
    const [day] = projectCalendar(
      meals,
      new MealCalendar([morning], []),
      localDate('2026-08-16'),
      localDate('2026-08-16'),
    );

    expect(day).toEqual({ date: '2026-08-16', dayNumber: null, slots: [] });
  });

  it('시작 날짜가 끝 날짜보다 뒤면 빈 달력이다', () => {
    expect(
      projectCalendar(meals, new MealCalendar([morning], []), localDate('2026-08-21'), localDate('2026-08-20')),
    ).toEqual([]);
  });

  it('같은 끼니에 순서가 겹치는 식단은 거부한다', () => {
    const duplicated = [meal('morning', 1), meal('morning', 1, { id: 'other' })];

    expect(() =>
      projectCalendar(duplicated, new MealCalendar([morning], []), localDate('2026-08-17'), localDate('2026-08-17')),
    ).toThrow(DomainError);
  });

  it('순서가 1 미만인 식단은 거부한다', () => {
    expect(() =>
      projectCalendar(
        [meal('morning', 0)],
        new MealCalendar([morning], []),
        localDate('2026-08-17'),
        localDate('2026-08-17'),
      ),
    ).toThrow(DomainError);
  });
});

describe('식단 잔여 확인', () => {
  it('예정 식단이 없으면 null이다', () => {
    const consumed = [meal('morning', 1, { status: 'consumed' })];

    expect(lastPlannedMealDate(consumed, new MealCalendar([morning], []))).toBeNull();
  });

  it('마지막 예정 식단의 날짜를 미급여를 반영해 돌려준다', () => {
    const calendar = new MealCalendar(
      [morning, afternoon],
      [{ date: localDate('2026-08-20'), slot: 'afternoon', thawed: false, reason: null }],
    );

    expect(lastPlannedMealDate(meals, calendar)).toBe('2026-08-22');
  });

  it('끼니 설정이 없는 식단은 건너뛴다', () => {
    expect(lastPlannedMealDate(meals, new MealCalendar([morning], []))).toBe('2026-08-21');
  });
});

describe('실제 급여 내용', () => {
  it('실제 급여 내용이 있으면 계획 대신 그것을 쓴다', () => {
    const actual = { baseMenuId: 'rice-porridge', toppingIngredientIds: ['zucchini'] };

    expect(effectiveComposition(meal('morning', 1))).toEqual(meal('morning', 1).planned);
    expect(effectiveComposition(meal('morning', 1, { actual }))).toEqual(actual);
  });
});
