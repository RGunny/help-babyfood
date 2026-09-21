import { Ingredient } from '../ingredient/ingredient.js';
import { Meal } from '../meal-plan/meal.js';
import { MealCalendar, NoFeedRecord, SlotSchedule } from '../meal-plan/meal-calendar.js';
import { localDate } from '../shared/local-date.js';
import { localTime } from '../shared/local-time.js';
import { CookedBatch, LedgerEntry } from '../stock/ledger.js';
import { ForecastInput, forecastShortage } from './shortage-forecast.js';

const morning: SlotSchedule = { slot: 'morning', startDate: localDate('2026-09-21'), mealTime: localTime('10:00') };
const ingredient = (id: string, servingWeightGram = 15): Ingredient => ({
  id,
  name: id,
  aliases: [],
  category: 'vegetable',
  servingWeightGram,
});
const beef = ingredient('beef', 10);
const cucumber = ingredient('cucumber');
const spinach = ingredient('spinach');

const meal = (order: number, toppings: string[], overrides: Partial<Meal> = {}): Meal => ({
  id: `morning-${order}`,
  slot: 'morning',
  order,
  planned: { baseMenuId: null, toppingIngredientIds: toppings },
  actual: null,
  memo: null,
  status: 'planned',
  migrated: false,
  ...overrides,
});
const batch = (ingredientId: string, cubeWeightGram: number, cookedOn = '2026-09-15'): CookedBatch => ({
  id: `${ingredientId}-${cookedOn}-${cubeWeightGram}g`,
  ingredientId,
  cubeWeightGram,
  cookedOn: localDate(cookedOn),
});
const received = (stocked: CookedBatch, cubes: number): LedgerEntry => ({
  batchId: stocked.id,
  type: 'received',
  delta: cubes,
  mealId: null,
  reason: null,
});

// 소고기는 매일, 오이는 3일차와 4일차 이틀만 쓰는 7일 식단.
const weekMeals = [1, 2, 3, 4, 5, 6, 7].map((order) =>
  meal(order, order === 3 || order === 4 ? ['beef', 'cucumber'] : ['beef']),
);
const beefBatch = batch('beef', 10);
const cucumberBatch = batch('cucumber', 15);

const input = (overrides: Partial<ForecastInput> = {}): ForecastInput => ({
  ingredients: [beef, cucumber],
  meals: weekMeals,
  calendar: new MealCalendar([morning], []),
  menus: new Map(),
  batches: [beefBatch, cucumberBatch],
  entries: [received(beefBatch, 3), received(cucumberBatch, 3)],
  until: null,
  ...overrides,
});
const forecastOf = (forecastInput: ForecastInput, ingredientId: string) =>
  forecastShortage(forecastInput).find((forecast) => forecast.ingredientId === ingredientId);

describe('소진 예측', () => {
  it('예정 식단이 없으면 모든 재료가 사용량 0이고 부족도 없다', () => {
    expect(forecastShortage(input({ meals: [] }))).toEqual([
      { ingredientId: 'beef', plannedCubes: 0, depletionDate: null, firstShortageDate: null, shortfallCubes: 0 },
      { ingredientId: 'cucumber', plannedCubes: 0, depletionDate: null, firstShortageDate: null, shortfallCubes: 0 },
    ]);
  });

  it('같은 3개라도 매일 쓰는 소고기는 9/24에 부족해지고 이틀만 쓰는 오이는 부족하지 않다', () => {
    expect(forecastOf(input(), 'beef')).toEqual({
      ingredientId: 'beef',
      plannedCubes: 7,
      depletionDate: '2026-09-23',
      firstShortageDate: '2026-09-24',
      shortfallCubes: 4,
    });
    expect(forecastOf(input(), 'cucumber')).toEqual({
      ingredientId: 'cucumber',
      plannedCubes: 2,
      depletionDate: null,
      firstShortageDate: null,
      shortfallCubes: 0,
    });
  });

  it('식단을 딱 맞게 덮는 재고는 마지막 식단 날짜에 소진되고 부족은 없다', () => {
    const exact = input({ entries: [received(beefBatch, 7), received(cucumberBatch, 3)] });

    expect(forecastOf(exact, 'beef')).toMatchObject({
      depletionDate: '2026-09-27',
      firstShortageDate: null,
      shortfallCubes: 0,
    });
  });

  it('미급여를 등록하면 부족해지는 날짜도 하루 밀린다', () => {
    const noFeeds: NoFeedRecord[] = [{ date: localDate('2026-09-22'), slot: 'morning', thawed: false, reason: null }];
    const shifted = input({ calendar: new MealCalendar([morning], noFeeds) });

    expect(forecastOf(shifted, 'beef')).toMatchObject({ depletionDate: '2026-09-24', firstShortageDate: '2026-09-25' });
  });

  it('기간을 지정하면 그 날짜까지의 식단만 본다', () => {
    const untilSep25 = input({ until: localDate('2026-09-25') });

    expect(forecastOf(untilSep25, 'beef')).toMatchObject({ plannedCubes: 5, shortfallCubes: 2 });
  });

  it('이미 먹인 식단과 이관된 식단은 예측에 넣지 않는다', () => {
    const meals = weekMeals.map((planned) =>
      planned.order <= 2 ? { ...planned, status: 'consumed' as const, migrated: planned.order === 1 } : planned,
    );

    expect(forecastOf(input({ meals }), 'beef')).toMatchObject({ plannedCubes: 5, firstShortageDate: '2026-09-26' });
  });

  it('임계일이 지난 배치도 폐기 전까지는 예측 재고에 포함한다', () => {
    const expiredBeef = batch('beef', 10, '2026-09-01');
    const withExpired = input({
      batches: [expiredBeef, cucumberBatch],
      entries: [received(expiredBeef, 7), received(cucumberBatch, 3)],
    });

    expect(forecastOf(withExpired, 'beef')).toMatchObject({ firstShortageDate: null, shortfallCubes: 0 });
  });

  it('중량이 다른 배치는 예측 재고에서 뺀다', () => {
    const oldWeightBeef = batch('beef', 5);
    const mismatched = input({
      batches: [oldWeightBeef, cucumberBatch],
      entries: [received(oldWeightBeef, 10), received(cucumberBatch, 3)],
    });

    expect(forecastOf(mismatched, 'beef')).toMatchObject({ firstShortageDate: '2026-09-21', shortfallCubes: 7 });
  });

  it('실제 급여 내용이 입력된 예정 식단은 그 내용으로 계산한다', () => {
    const meals = [meal(1, ['beef'], { actual: { baseMenuId: null, toppingIngredientIds: ['cucumber'] } })];

    expect(forecastOf(input({ meals }), 'beef')?.plannedCubes).toBe(0);
    expect(forecastOf(input({ meals }), 'cucumber')?.plannedCubes).toBe(1);
  });

  it('예측 대상에 없는 재료와 끼니 설정이 없는 식단은 건너뛴다', () => {
    const meals: Meal[] = [
      meal(1, ['beef', 'unlisted']),
      { ...meal(1, ['beef']), id: 'afternoon-1', slot: 'afternoon' },
    ];

    expect(forecastShortage(input({ meals, ingredients: [beef, spinach] }))).toEqual([
      { ingredientId: 'beef', plannedCubes: 1, depletionDate: null, firstShortageDate: null, shortfallCubes: 0 },
      { ingredientId: 'spinach', plannedCubes: 0, depletionDate: null, firstShortageDate: null, shortfallCubes: 0 },
    ]);
  });
});
