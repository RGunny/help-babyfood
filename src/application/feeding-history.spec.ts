import { Ingredient } from '../domain/ingredient/ingredient.js';
import { Meal } from '../domain/meal-plan/meal.js';
import { MealCalendar } from '../domain/meal-plan/meal-calendar.js';
import { Menu } from '../domain/menu/menu.js';
import { localDate } from '../domain/shared/local-date.js';
import { localTime } from '../domain/shared/local-time.js';
import {
  fedIngredientIdsBefore,
  introductionStatuses,
  reactedIngredientIds,
} from './feeding-history.js';
import { FeedingHistory, RecordedReaction } from './ports/feeding-history.port.js';

const INGREDIENTS: Ingredient[] = [
  { id: 'rice', name: '쌀', aliases: [], category: 'base', servingWeightGram: 30, stockTracking: 'cubes', constituentIngredientIds: [] },
  { id: 'oatmeal', name: '오트밀', aliases: [], category: 'base', servingWeightGram: 10, stockTracking: 'cubes', constituentIngredientIds: [] },
  { id: 'pea', name: '완두콩', aliases: [], category: 'vegetable', servingWeightGram: 15, stockTracking: 'cubes', constituentIngredientIds: [] },
  { id: 'peanut', name: '땅콩버터', aliases: [], category: 'high_risk_allergen', servingWeightGram: 5, stockTracking: 'cubes', constituentIngredientIds: [] },
];

const MENUS = new Map<string, Menu>([
  [
    'porridge',
    { id: 'porridge', name: '쌀오트밀죽', components: [{ ingredientId: 'rice', cubes: 1 }] },
  ],
]);

const CALENDAR = new MealCalendar(
  [{ slot: 'morning', startDate: localDate('2026-08-17'), mealTime: localTime('10:00') }],
  [],
);

function meal(order: number, toppings: string[], overrides: Partial<Meal> = {}): Meal {
  return {
    id: `meal-${order}`,
    slot: 'morning',
    order,
    planned: { baseMenuId: 'porridge', toppingIngredientIds: toppings },
    actual: null,
    memo: null,
    status: 'consumed',
    migrated: false,
    ...overrides,
  };
}

function history(overrides: Partial<FeedingHistory> = {}): FeedingHistory {
  return {
    consumedMeals: [],
    reactions: [],
    verifiedBeforeMigrationIds: new Set(),
    ...overrides,
  };
}

const clear = (mealId: string, ingredientId: string): RecordedReaction => ({
  mealId,
  ingredientId,
  result: 'clear',
});

const statusOf = (input: FeedingHistory, ingredientId: string) =>
  introductionStatuses(input, INGREDIENTS, MENUS).get(ingredientId);

describe('도입 상태', () => {
  it('먹인 적이 없으면 미도입이다', () => {
    expect(statusOf(history(), 'pea')).toEqual({ kind: 'not_introduced' });
  });

  it('먹였지만 반응 기록이 없으면 검증중 0회에 미기록 1건이다', () => {
    const input = history({ consumedMeals: [meal(1, ['pea'])] });
    expect(statusOf(input, 'pea')).toEqual({ kind: 'verifying', clearCount: 0, unrecordedCount: 1 });
  });

  it('이상 없음 한 번이면 검증중 1회다', () => {
    const input = history({
      consumedMeals: [meal(1, ['pea'])],
      reactions: [clear('meal-1', 'pea')],
    });
    expect(statusOf(input, 'pea')).toEqual({ kind: 'verifying', clearCount: 1, unrecordedCount: 0 });
  });

  it('이상 없음 두 번이면 검증완료다', () => {
    const input = history({
      consumedMeals: [meal(1, ['pea']), meal(2, ['pea'])],
      reactions: [clear('meal-1', 'pea'), clear('meal-2', 'pea')],
    });
    expect(statusOf(input, 'pea')).toEqual({ kind: 'verified' });
  });

  it('반응 있음이 있으면 이상 없음 횟수와 무관하게 반응있음이다', () => {
    const input = history({
      consumedMeals: [meal(1, ['pea']), meal(2, ['pea']), meal(3, ['pea'])],
      reactions: [
        clear('meal-1', 'pea'),
        clear('meal-2', 'pea'),
        { mealId: 'meal-3', ingredientId: 'pea', result: 'reacted' },
      ],
    });
    expect(statusOf(input, 'pea')).toEqual({ kind: 'reacted' });
  });

  it('이관 때 검증완료로 등록한 재료는 급여 이력이 없어도 검증완료다', () => {
    const input = history({ verifiedBeforeMigrationIds: new Set(['peanut']) });
    expect(statusOf(input, 'peanut')).toEqual({ kind: 'verified' });
  });

  it('베이스 메뉴의 재료도 먹인 것으로 센다', () => {
    const input = history({ consumedMeals: [meal(1, [])] });
    expect(statusOf(input, 'rice')).toEqual({ kind: 'verifying', clearCount: 0, unrecordedCount: 1 });
  });

  it('실제 급여 내용으로 고친 식단은 고친 내용으로 센다', () => {
    const corrected = meal(1, ['pea'], {
      actual: { baseMenuId: 'porridge', toppingIngredientIds: ['peanut'] },
    });
    const input = history({ consumedMeals: [corrected] });

    expect(statusOf(input, 'peanut')).toEqual({ kind: 'verifying', clearCount: 0, unrecordedCount: 1 });
    expect(statusOf(input, 'pea')).toEqual({ kind: 'not_introduced' });
  });

  it('이관된 식단도 급여 이력으로 센다', () => {
    const input = history({ consumedMeals: [meal(1, ['pea'], { migrated: true })] });
    expect(statusOf(input, 'pea')).toEqual({ kind: 'verifying', clearCount: 0, unrecordedCount: 1 });
  });

  it('다른 식단의 반응은 세지 않는다', () => {
    const input = history({
      consumedMeals: [meal(1, ['pea'])],
      reactions: [clear('meal-2', 'pea')],
    });
    expect(statusOf(input, 'pea')).toEqual({ kind: 'verifying', clearCount: 0, unrecordedCount: 1 });
  });

  it('등록된 모든 재료가 한 줄씩 나온다', () => {
    const statuses = introductionStatuses(history(), INGREDIENTS, MENUS);
    expect([...statuses.keys()]).toEqual(['rice', 'oatmeal', 'pea', 'peanut']);
  });
});

describe('반응있음 재료', () => {
  it('반응있음인 재료만 모은다', () => {
    const input = history({
      consumedMeals: [meal(1, ['pea']), meal(2, ['peanut'])],
      reactions: [
        { mealId: 'meal-1', ingredientId: 'pea', result: 'reacted' },
        clear('meal-2', 'peanut'),
      ],
    });
    const reacted = reactedIngredientIds(introductionStatuses(input, INGREDIENTS, MENUS));
    expect([...reacted]).toEqual(['pea']);
  });
});

describe('이전에 먹인 재료', () => {
  it('기준 날짜보다 앞선 식단의 재료만 센다', () => {
    const input = history({ consumedMeals: [meal(1, ['pea']), meal(2, ['peanut'])] });
    // 1번은 8/17, 2번은 8/18이다.
    const fed = fedIngredientIdsBefore(input, CALENDAR, MENUS, localDate('2026-08-18'));
    expect([...fed].sort()).toEqual(['pea', 'rice']);
  });

  it('이관 때 검증완료로 등록한 재료는 급여 이력이 없어도 먹인 것으로 센다', () => {
    const input = history({ verifiedBeforeMigrationIds: new Set(['peanut']) });
    const fed = fedIngredientIdsBefore(input, CALENDAR, MENUS, localDate('2026-08-18'));
    expect([...fed]).toEqual(['peanut']);
  });

  it('설정되지 않은 끼니의 식단은 날짜를 알 수 없으므로 건너뛴다', () => {
    const input = history({ consumedMeals: [meal(1, ['pea'], { slot: 'afternoon' })] });
    const fed = fedIngredientIdsBefore(input, CALENDAR, MENUS, localDate('2026-09-01'));
    expect([...fed]).toEqual([]);
  });
});
