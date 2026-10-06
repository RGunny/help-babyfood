import { DomainError } from '../errors.js';
import { Ingredient, StockTracking } from '../ingredient/ingredient.js';
import { IngredientCatalog } from '../ingredient/ingredient-catalog.js';
import { Meal } from '../meal-plan/meal.js';
import { MealCalendar, NoFeedRecord, SlotSchedule } from '../meal-plan/meal-calendar.js';
import { Menu } from '../menu/menu.js';
import { localDate } from '../shared/local-date.js';
import { LocalDateTime, localTime } from '../shared/local-time.js';
import { MealSlot } from '../shared/meal-slot.js';
import { CookedBatch, LedgerEntry, remainingByBatch } from '../stock/ledger.js';
import { NoFeedChange, cancelNoFeed, registerNoFeed } from './no-feed.js';
import { ReconcileInput, applyReconcileResult, reconcileMeals } from './reconcile.js';

const ingredient = (id: string, servingWeightGram: number, stockTracking: StockTracking = 'cubes'): Ingredient => ({
  id,
  name: id,
  aliases: [],
  category: 'vegetable',
  servingWeightGram,
  stockTracking,
  constituentIngredientIds: [],
});
const catalog = new IngredientCatalog([
  ingredient('rice', 30),
  ingredient('oatmeal', 10),
  ingredient('beef', 10),
  ingredient('broccoli', 15),
  ingredient('zucchini', 15),
]);
const menus = new Map<string, Menu>([
  [
    'rice-oatmeal-porridge',
    {
      id: 'rice-oatmeal-porridge',
      name: '쌀오트밀죽',
      components: [
        { ingredientId: 'rice', cubes: 1 },
        { ingredientId: 'oatmeal', cubes: 1 },
      ],
    },
  ],
]);

const morning: SlotSchedule = { slot: 'morning', startDate: localDate('2026-08-17'), mealTime: localTime('10:00') };
const afternoon: SlotSchedule = { slot: 'afternoon', startDate: localDate('2026-08-17'), mealTime: localTime('17:00') };

const meal = (slot: MealSlot, order: number, overrides: Partial<Meal> = {}): Meal => ({
  id: `${slot}-${order}`,
  slot,
  order,
  planned: { baseMenuId: 'rice-oatmeal-porridge', toppingIngredientIds: ['beef', 'broccoli'] },
  actual: null,
  memo: null,
  status: 'planned',
  migrated: false,
  ...overrides,
});
const morningMeals = [1, 2, 3, 4, 5, 6].map((order) => meal('morning', order));

const batch = (
  ingredientId: string,
  cookedOn: string,
  cubeWeightGram: number,
  id = `${ingredientId}-${cookedOn}`,
): CookedBatch => ({
  id,
  ingredientId,
  cubeWeightGram,
  cookedOn: localDate(cookedOn),
});
const received = (batchId: string, cubes: number): LedgerEntry => ({
  batchId,
  type: 'received',
  delta: cubes,
  mealId: null,
  reason: null,
});
const fullStockBatches = [
  batch('rice', '2026-08-15', 30, 'rice'),
  batch('oatmeal', '2026-08-15', 10, 'oatmeal'),
  batch('beef', '2026-08-15', 10, 'beef'),
  batch('broccoli', '2026-08-15', 15, 'broccoli'),
  batch('zucchini', '2026-08-15', 15, 'zucchini'),
];
const fullStockEntries = fullStockBatches.map((stocked) => received(stocked.id, 10));

const at = (date: string, time: string): LocalDateTime => ({ date: localDate(date), time: localTime(time) });
const noFeed = (date: string, slot: MealSlot, thawed: boolean): NoFeedRecord => ({
  date: localDate(date),
  slot,
  thawed,
  reason: null,
});

const baseInput = (now: LocalDateTime, overrides: Partial<ReconcileInput> = {}): ReconcileInput => ({
  now,
  meals: morningMeals,
  calendar: new MealCalendar([morning], []),
  menus,
  catalog,
  batches: fullStockBatches,
  entries: fullStockEntries,
  ...overrides,
});
const settle = (input: ReconcileInput): ReconcileInput => applyReconcileResult(input, reconcileMeals(input));
const applyNoFeedChange = (input: ReconcileInput, change: NoFeedChange): ReconcileInput =>
  applyReconcileResult(
    { ...input, calendar: change.calendar, entries: [...input.entries, ...change.stockEntries] },
    change.reconcile,
  );
const stockOf = (input: ReconcileInput, batchId: string) => remainingByBatch(input.entries).get(batchId);
const statusOf = (input: ReconcileInput, mealId: string) =>
  input.meals.find((candidate) => candidate.id === mealId)?.status;

describe('자동 차감', () => {
  it('식단시간 전에는 아무것도 바뀌지 않는다', () => {
    expect(reconcileMeals(baseInput(at('2026-08-17', '09:59')))).toEqual({
      statusChanges: [],
      newEntries: [],
      held: [],
    });
  });

  it('식단시간이 되면 급여 완료로 바꾸고 메뉴와 토핑의 큐브를 1개씩 차감한다', () => {
    const result = reconcileMeals(baseInput(at('2026-08-17', '10:00')));

    expect(result.statusChanges).toEqual([{ mealId: 'morning-1', status: 'consumed' }]);
    expect(result.newEntries).toEqual(
      ['rice', 'oatmeal', 'beef', 'broccoli'].map((batchId) => ({
        batchId,
        type: 'meal_consumed',
        delta: -1,
        mealId: 'morning-1',
        reason: null,
      })),
    );
    expect(result.held).toEqual([]);
  });

  it('결과를 반영한 뒤 다시 돌리면 바뀌는 것이 없다', () => {
    const settled = settle(baseInput(at('2026-08-17', '10:00')));

    expect(reconcileMeals(settled)).toEqual({ statusChanges: [], newEntries: [], held: [] });
  });

  it('서버가 멈춰 있던 동안의 식단은 다음 실행에서 소급해 차감한다', () => {
    const settled = settle(baseInput(at('2026-08-20', '12:00')));

    expect(['morning-1', 'morning-2', 'morning-3', 'morning-4'].map((id) => statusOf(settled, id))).toEqual(
      Array(4).fill('consumed'),
    );
    expect(statusOf(settled, 'morning-5')).toBe('planned');
    expect(stockOf(settled, 'broccoli')).toBe(6);
  });

  it('먼저 먹인 식단이 더 오래된 배치의 큐브를 가져간다', () => {
    const olderBroccoli = batch('broccoli', '2026-08-10', 15, 'broccoli-old');
    const input = baseInput(at('2026-08-18', '12:00'), {
      batches: [...fullStockBatches, olderBroccoli],
      entries: [...fullStockEntries, received('broccoli-old', 1)],
    });

    const broccoliEntries = reconcileMeals(input).newEntries.filter((entry) => entry.batchId.startsWith('broccoli'));

    expect(broccoliEntries.map((entry) => [entry.mealId, entry.batchId])).toEqual([
      ['morning-1', 'broccoli-old'],
      ['morning-2', 'broccoli'],
    ]);
  });

  it('이관된 과거 식단은 급여 완료지만 재고를 차감하지 않는다', () => {
    const meals = morningMeals.map((planned) =>
      planned.order <= 3 ? { ...planned, status: 'consumed' as const, migrated: true } : planned,
    );

    const result = reconcileMeals(baseInput(at('2026-08-20', '12:00'), { meals }));

    expect(result.statusChanges).toEqual([{ mealId: 'morning-4', status: 'consumed' }]);
    expect(new Set(result.newEntries.map((entry) => entry.mealId))).toEqual(new Set(['morning-4']));
  });

  it('끼니 설정이 없는 식단은 건드리지 않는다', () => {
    const meals = [...morningMeals, meal('afternoon', 1)];

    const result = reconcileMeals(baseInput(at('2026-08-17', '23:00'), { meals }));

    expect(result.statusChanges).toEqual([{ mealId: 'morning-1', status: 'consumed' }]);
  });

  it('원장에 있는 배치를 찾을 수 없으면 오류다', () => {
    const entries: LedgerEntry[] = [
      ...fullStockEntries,
      { batchId: 'ghost', type: 'meal_consumed', delta: -1, mealId: 'morning-1', reason: null },
    ];

    expect(() => reconcileMeals(baseInput(at('2026-08-17', '10:00'), { entries }))).toThrow(DomainError);
  });
});

describe('재고 부족과 보류', () => {
  const withoutBroccoli = {
    batches: fullStockBatches.filter((stocked) => stocked.id !== 'broccoli'),
    entries: fullStockEntries.filter((entry) => entry.batchId !== 'broccoli'),
  };

  it('모자란 재료만 보류하고 나머지 재료는 차감하며 식단은 급여 완료가 된다', () => {
    const result = reconcileMeals(baseInput(at('2026-08-17', '10:00'), withoutBroccoli));

    expect(result.statusChanges).toEqual([{ mealId: 'morning-1', status: 'consumed' }]);
    expect(result.newEntries.map((entry) => entry.batchId)).toEqual(['rice', 'oatmeal', 'beef']);
    expect(result.held).toEqual([{ mealId: 'morning-1', mealDate: '2026-08-17', ingredientId: 'broccoli', cubes: 1 }]);
  });

  it('재고는 음수로 내려가지 않는다: 2개뿐이면 두 식단만 차감하고 나머지는 보류한다', () => {
    const entries = [...withoutBroccoli.entries, received('broccoli', 2)];
    const input = baseInput(at('2026-08-20', '12:00'), { entries });

    const result = reconcileMeals(input);

    expect(stockOf(applyReconcileResult(input, result), 'broccoli')).toBe(0);
    expect(result.held.map((heldDeduction) => heldDeduction.mealId)).toEqual(['morning-3', 'morning-4']);
  });

  it('입고를 늦게 등록하면 보류된 차감이 다음 실행에서 처리된다', () => {
    const settled = settle(baseInput(at('2026-08-17', '10:00'), withoutBroccoli));
    const lateRegistered = batch('broccoli', '2026-08-16', 15, 'broccoli-late');

    const result = reconcileMeals({
      ...settled,
      batches: [...settled.batches, lateRegistered],
      entries: [...settled.entries, received('broccoli-late', 5)],
    });

    expect(result.held).toEqual([]);
    expect(result.newEntries).toEqual([
      { batchId: 'broccoli-late', type: 'meal_consumed', delta: -1, mealId: 'morning-1', reason: null },
    ]);
  });

  it('식단 날짜보다 늦게 조리한 배치로는 보류가 풀리지 않는다', () => {
    const settled = settle(baseInput(at('2026-08-17', '10:00'), withoutBroccoli));
    const cookedLater = batch('broccoli', '2026-08-18', 15, 'broccoli-later');

    const result = reconcileMeals({
      ...settled,
      now: at('2026-08-18', '09:00'),
      batches: [...settled.batches, cookedLater],
      entries: [...settled.entries, received('broccoli-later', 5)],
    });

    expect(result.newEntries).toEqual([]);
    expect(result.held.map((heldDeduction) => heldDeduction.mealId)).toEqual(['morning-1']);
  });

  it('큐브 중량이 현재 1회분 중량과 다른 배치뿐이면 보류한다', () => {
    const oldWeight = batch('broccoli', '2026-08-15', 10, 'broccoli-10g');
    const input = baseInput(at('2026-08-17', '10:00'), {
      batches: [...withoutBroccoli.batches, oldWeight],
      entries: [...withoutBroccoli.entries, received('broccoli-10g', 5)],
    });

    const result = reconcileMeals(input);

    expect(result.held.map((heldDeduction) => heldDeduction.ingredientId)).toEqual(['broccoli']);
    expect(stockOf(applyReconcileResult(input, result), 'broccoli-10g')).toBe(5);
  });
});

describe('상비 재료', () => {
  const withEgg = (stockTracking: StockTracking) =>
    new IngredientCatalog([
      ingredient('rice', 30),
      ingredient('oatmeal', 10),
      ingredient('beef', 10),
      ingredient('broccoli', 15),
      ingredient('egg', 10, stockTracking),
    ]);
  const eggMeal = meal('morning', 1, {
    planned: { baseMenuId: 'rice-oatmeal-porridge', toppingIngredientIds: ['beef', 'egg'] },
  });

  it('상비 재료는 재고가 없어도 차감하지 않고 보류하지 않는다', () => {
    const result = reconcileMeals(
      baseInput(at('2026-08-17', '10:00'), { meals: [eggMeal], catalog: withEgg('pantry') }),
    );

    expect(result.statusChanges).toEqual([{ mealId: 'morning-1', status: 'consumed' }]);
    expect(result.newEntries.map((entry) => entry.batchId)).toEqual(['rice', 'oatmeal', 'beef']);
    expect(result.held).toEqual([]);
  });

  it('상비 재료의 소비 이벤트는 되돌리지 않는다', () => {
    const eggBatch = batch('egg', '2026-08-15', 10, 'egg');
    const settled = settle(
      baseInput(at('2026-08-17', '10:00'), {
        meals: [eggMeal],
        catalog: withEgg('cubes'),
        batches: [...fullStockBatches, eggBatch],
        entries: [...fullStockEntries, received('egg', 10)],
      }),
    );
    expect(stockOf(settled, 'egg')).toBe(9);

    const result = reconcileMeals({ ...settled, catalog: withEgg('pantry') });

    expect(result).toEqual({ statusChanges: [], newEntries: [], held: [] });
  });
});

describe('실제 급여 내용 변경', () => {
  it('브로콜리 대신 애호박을 먹였다고 고치면 브로콜리 소비를 취소하고 애호박을 차감한다', () => {
    const settled = settle(baseInput(at('2026-08-17', '10:00')));
    const corrected = settled.meals.map((fed) =>
      fed.id === 'morning-1'
        ? { ...fed, actual: { baseMenuId: 'rice-oatmeal-porridge', toppingIngredientIds: ['beef', 'zucchini'] } }
        : fed,
    );

    const result = reconcileMeals({ ...settled, meals: corrected });

    expect(result.statusChanges).toEqual([]);
    expect(result.newEntries).toEqual([
      { batchId: 'broccoli', type: 'consumption_reverted', delta: 1, mealId: 'morning-1', reason: null },
      { batchId: 'zucchini', type: 'meal_consumed', delta: -1, mealId: 'morning-1', reason: null },
    ]);
  });

  it('여러 배치에서 가져갔던 큐브는 늦게 조리한 배치부터 되돌린다', () => {
    const olderBroccoli = batch('broccoli', '2026-08-10', 15, 'broccoli-old');
    const doubleBroccoli = meal('morning', 1, {
      planned: { baseMenuId: null, toppingIngredientIds: ['broccoli', 'broccoli'] },
    });
    const settled = settle(
      baseInput(at('2026-08-17', '10:00'), {
        meals: [doubleBroccoli],
        batches: [...fullStockBatches, olderBroccoli],
        entries: [...fullStockEntries, received('broccoli-old', 1)],
      }),
    );
    const corrected = [{ ...settled.meals[0], actual: { baseMenuId: null, toppingIngredientIds: ['broccoli'] } }];

    const result = reconcileMeals({ ...settled, meals: corrected });

    expect(result.newEntries).toEqual([
      { batchId: 'broccoli', type: 'consumption_reverted', delta: 1, mealId: 'morning-1', reason: null },
    ]);
  });
});

describe('미급여 등록', () => {
  it('식단시간 전에 등록하면 차감 없이 식단만 다음 날로 밀린다', () => {
    const input = settle(baseInput(at('2026-08-20', '08:00')));

    const change = registerNoFeed(input, noFeed('2026-08-20', 'morning', false));

    expect(change.reconcile).toEqual({ statusChanges: [], newEntries: [], held: [] });
    expect(change.stockEntries).toEqual([]);
    expect(change.calendar.dateOf('morning', 4)).toBe('2026-08-21');
  });

  it('식단시간 후 해동 전에 등록하면 소비를 취소하고 식단은 예정으로 돌아간다', () => {
    const input = settle(baseInput(at('2026-08-20', '12:00')));

    const change = registerNoFeed(input, noFeed('2026-08-20', 'morning', false));
    const after = applyNoFeedChange(input, change);

    expect(change.reconcile.statusChanges).toEqual([{ mealId: 'morning-4', status: 'planned' }]);
    expect(change.reconcile.newEntries.map((entry) => [entry.type, entry.mealId, entry.delta])).toEqual(
      Array(4).fill(['consumption_reverted', 'morning-4', 1]),
    );
    expect(change.stockEntries).toEqual([]);
    expect(stockOf(after, 'broccoli')).toBe(7);
  });

  it('식단시간 후 해동 후에 등록하면 소비를 취소하고 같은 수량을 폐기로 기록한다', () => {
    const input = settle(baseInput(at('2026-08-20', '12:00')));

    const change = registerNoFeed(input, noFeed('2026-08-20', 'morning', true));
    const after = applyNoFeedChange(input, change);

    expect(change.stockEntries).toEqual(
      ['rice', 'oatmeal', 'beef', 'broccoli'].map((batchId) => ({
        batchId,
        type: 'discarded',
        delta: -1,
        mealId: 'morning-4',
        reason: 'thawed_not_fed',
        noFeedKey: '2026-08-20/morning',
      })),
    );
    expect(statusOf(after, 'morning-4')).toBe('planned');
    expect(stockOf(after, 'broccoli')).toBe(6);
  });

  it('전날 밤 해동해 둔 식단을 식단시간 전에 미급여로 등록하면 취소 없이 폐기만 기록한다', () => {
    const input = settle(baseInput(at('2026-08-20', '08:00')));

    const change = registerNoFeed(input, noFeed('2026-08-20', 'morning', true));

    expect(change.reconcile.newEntries).toEqual([]);
    expect(change.stockEntries.map((entry) => entry.type)).toEqual(Array(4).fill('discarded'));
    expect(stockOf(applyNoFeedChange(input, change), 'broccoli')).toBe(6);
  });

  it('미뤄진 식단을 실제로 먹이는 날에는 큐브가 다시 차감된다', () => {
    const input = settle(baseInput(at('2026-08-20', '12:00')));
    const skipped = applyNoFeedChange(input, registerNoFeed(input, noFeed('2026-08-20', 'morning', true)));

    const nextDay = settle({ ...skipped, now: at('2026-08-21', '10:00') });

    expect(statusOf(nextDay, 'morning-4')).toBe('consumed');
    expect(stockOf(nextDay, 'broccoli')).toBe(5);
  });

  it('며칠 뒤 소급해 등록하면 마지막에 차감됐던 식단만 예정으로 돌아간다', () => {
    const input = settle(baseInput(at('2026-08-20', '12:00')));

    const change = registerNoFeed(input, noFeed('2026-08-18', 'morning', false));

    expect(change.reconcile.statusChanges).toEqual([{ mealId: 'morning-4', status: 'planned' }]);
    expect(new Set(change.reconcile.newEntries.map((entry) => entry.mealId))).toEqual(new Set(['morning-4']));
    expect(change.calendar.dateOf('morning', 2)).toBe('2026-08-19');
    expect(change.calendar.dateOf('morning', 4)).toBe('2026-08-21');
  });

  it('소급 등록이 해동 후였다면 그 날짜에 놓여 있던 식단의 큐브를 폐기한다', () => {
    const input = settle(baseInput(at('2026-08-20', '12:00')));

    const change = registerNoFeed(input, noFeed('2026-08-18', 'morning', true));

    expect(new Set(change.stockEntries.map((entry) => entry.mealId))).toEqual(new Set(['morning-2']));
    expect(stockOf(applyNoFeedChange(input, change), 'broccoli')).toBe(6);
  });

  it('오후만 못 먹였으면 오전 식단의 차감은 그대로다', () => {
    const meals = [...morningMeals, ...[1, 2, 3, 4, 5, 6].map((order) => meal('afternoon', order))];
    const input = settle(
      baseInput(at('2026-08-20', '18:00'), { meals, calendar: new MealCalendar([morning, afternoon], []) }),
    );

    const change = registerNoFeed(input, noFeed('2026-08-20', 'afternoon', false));

    expect(change.reconcile.statusChanges).toEqual([{ mealId: 'afternoon-4', status: 'planned' }]);
    expect(new Set(change.reconcile.newEntries.map((entry) => entry.mealId))).toEqual(new Set(['afternoon-4']));
  });

  it('해동했지만 원장에 재고가 없으면 폐기하지 못한 재료로 돌려준다', () => {
    const input = settle(
      baseInput(at('2026-08-20', '08:00'), {
        batches: fullStockBatches.filter((stocked) => stocked.id !== 'broccoli'),
        entries: fullStockEntries.filter((entry) => entry.batchId !== 'broccoli'),
      }),
    );

    const change = registerNoFeed(input, noFeed('2026-08-20', 'morning', true));

    expect(change.undiscardable).toEqual([{ ingredientId: 'broccoli', cubes: 1 }]);
    expect(change.stockEntries.map((entry) => entry.batchId)).toEqual(['rice', 'oatmeal', 'beef']);
  });

  it('식단표가 끝난 뒤의 날짜는 해동 후로 등록해도 폐기할 식단이 없다', () => {
    const input = settle(baseInput(at('2026-08-20', '12:00')));

    const change = registerNoFeed(input, noFeed('2026-08-30', 'morning', true));

    expect(change.stockEntries).toEqual([]);
  });

  it('이관된 과거 식단의 날짜를 해동 후 미급여로 등록해도 폐기하지 않는다', () => {
    const meals = morningMeals.map((planned) =>
      planned.order <= 3 ? { ...planned, status: 'consumed' as const, migrated: true } : planned,
    );
    const input = settle(baseInput(at('2026-08-20', '12:00'), { meals }));

    const change = registerNoFeed(input, noFeed('2026-08-18', 'morning', true));

    expect(change.stockEntries).toEqual([]);
  });

  it('같은 날짜와 끼니를 두 번 등록할 수 없다', () => {
    const input = settle(baseInput(at('2026-08-20', '12:00')));
    const skipped = applyNoFeedChange(input, registerNoFeed(input, noFeed('2026-08-20', 'morning', false)));

    expect(() => registerNoFeed(skipped, noFeed('2026-08-20', 'morning', true))).toThrow(DomainError);
  });

  it('설정되지 않은 끼니에는 등록할 수 없다', () => {
    const input = baseInput(at('2026-08-20', '12:00'));

    expect(() => registerNoFeed(input, noFeed('2026-08-20', 'afternoon', false))).toThrow(DomainError);
  });
});

describe('미급여 취소', () => {
  it('잘못 등록한 미급여를 지우면 날짜가 당겨지고 식단시간이 지난 식단이 다시 차감된다', () => {
    const input = settle(baseInput(at('2026-08-20', '12:00')));
    const skipped = applyNoFeedChange(input, registerNoFeed(input, noFeed('2026-08-20', 'morning', false)));

    const change = cancelNoFeed(skipped, 'morning', localDate('2026-08-20'));
    const restored = applyNoFeedChange(skipped, change);

    expect(change.reconcile.statusChanges).toEqual([{ mealId: 'morning-4', status: 'consumed' }]);
    expect(stockOf(restored, 'broccoli')).toBe(6);
    expect(restored.calendar.dateOf('morning', 4)).toBe('2026-08-20');
  });

  it('해동 후로 등록했던 미급여를 지우면 폐기했던 큐브도 되돌린다', () => {
    const input = settle(baseInput(at('2026-08-20', '12:00')));
    const skipped = applyNoFeedChange(input, registerNoFeed(input, noFeed('2026-08-20', 'morning', true)));

    const change = cancelNoFeed(skipped, 'morning', localDate('2026-08-20'));
    const restored = applyNoFeedChange(skipped, change);

    expect(change.stockEntries).toEqual(
      ['rice', 'oatmeal', 'beef', 'broccoli'].map((batchId) => ({
        batchId,
        type: 'count_adjusted',
        delta: 1,
        mealId: null,
        reason: 'no_feed_cancelled',
        noFeedKey: '2026-08-20/morning',
      })),
    );
    expect(stockOf(restored, 'broccoli')).toBe(stockOf(input, 'broccoli'));
  });

  it('같은 날짜를 다시 해동 후로 등록했다가 지워도 되돌림은 한 번분만 생긴다', () => {
    const input = settle(baseInput(at('2026-08-20', '12:00')));
    const record = noFeed('2026-08-20', 'morning', true);
    const once = applyNoFeedChange(input, registerNoFeed(input, record));
    const cancelled = applyNoFeedChange(once, cancelNoFeed(once, 'morning', record.date));
    const twice = applyNoFeedChange(cancelled, registerNoFeed(cancelled, record));

    const change = cancelNoFeed(twice, 'morning', record.date);

    expect(change.stockEntries.map((entry) => entry.delta)).toEqual([1, 1, 1, 1]);
    expect(stockOf(applyNoFeedChange(twice, change), 'broccoli')).toBe(stockOf(input, 'broccoli'));
  });

  it('없는 미급여 기록은 지울 수 없다', () => {
    const input = baseInput(at('2026-08-20', '12:00'));

    expect(() => cancelNoFeed(input, 'morning', localDate('2026-08-20'))).toThrow(DomainError);
  });
});
