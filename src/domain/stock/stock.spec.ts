import { DomainError } from '../errors.js';
import { Ingredient } from '../ingredient/ingredient.js';
import { localDate } from '../shared/local-date.js';
import { allocateOldestFirst } from './allocation.js';
import { DEFAULT_SHELF_LIFE_DAYS, expiryDateOf, expiryStageOn } from './expiry.js';
import {
  CookedBatch,
  LedgerEntry,
  adjustToCountedCubes,
  discardRemaining,
  netConsumedByBatch,
  receiveBatch,
  remainingByBatch,
} from './ledger.js';
import { batchesNeedingExpiryAlert, isAtOrBelowThreshold, summarizeStock } from './stock-summary.js';

const broccoli: Ingredient = {
  id: 'broccoli',
  name: '브로콜리',
  aliases: [],
  category: 'vegetable',
  servingWeightGram: 15,
  stockTracking: 'cubes',
  constituentIngredientIds: [],
};
const beef: Ingredient = {
  id: 'beef',
  name: '소고기',
  aliases: [],
  category: 'meat',
  servingWeightGram: 10,
  stockTracking: 'cubes',
  constituentIngredientIds: [],
};
const egg: Ingredient = {
  id: 'egg',
  name: '계란',
  aliases: [],
  category: 'high_risk_allergen',
  servingWeightGram: 10,
  stockTracking: 'pantry',
  constituentIngredientIds: [],
};

const batch = (id: string, cookedOn: string, overrides: Partial<CookedBatch> = {}): CookedBatch => ({
  id,
  ingredientId: 'broccoli',
  cubeWeightGram: 15,
  cookedOn: localDate(cookedOn),
  ...overrides,
});
const consumed = (batchId: string, mealId: string, cubes = 1): LedgerEntry => ({
  batchId,
  type: 'meal_consumed',
  delta: -cubes,
  mealId,
  reason: null,
});
const reverted = (batchId: string, mealId: string, cubes = 1): LedgerEntry => ({
  batchId,
  type: 'consumption_reverted',
  delta: cubes,
  mealId,
  reason: null,
});

describe('재고 원장', () => {
  const sep20 = batch('sep20', '2026-09-20');

  it('이벤트가 없으면 남은 큐브도 없다', () => {
    expect(remainingByBatch([])).toEqual(new Map());
  });

  it('입고하면 그 수량이 남는다', () => {
    expect(remainingByBatch([receiveBatch(sep20, 12)]).get('sep20')).toBe(12);
  });

  it('잔여 수량은 입고, 소비, 취소, 폐기, 실사 조정의 합이다', () => {
    const entries: LedgerEntry[] = [
      receiveBatch(sep20, 12),
      consumed('sep20', 'meal-1'),
      consumed('sep20', 'meal-2'),
      reverted('sep20', 'meal-2'),
      { batchId: 'sep20', type: 'discarded', delta: -1, mealId: 'meal-3', reason: 'thawed_not_fed' },
      { batchId: 'sep20', type: 'count_adjusted', delta: -2, mealId: null, reason: '떨어뜨림' },
    ];

    expect(remainingByBatch(entries).get('sep20')).toBe(8);
  });

  it.each<[string, LedgerEntry]>([
    ['입고 0개', { batchId: 'b', type: 'received', delta: 0, mealId: null, reason: null }],
    ['입고 음수', { batchId: 'b', type: 'received', delta: -1, mealId: null, reason: null }],
    ['소비 양수', { batchId: 'b', type: 'meal_consumed', delta: 1, mealId: 'm', reason: null }],
    ['소비 취소 음수', { batchId: 'b', type: 'consumption_reverted', delta: -1, mealId: 'm', reason: null }],
    ['폐기 양수', { batchId: 'b', type: 'discarded', delta: 1, mealId: null, reason: null }],
    ['실사 조정 0', { batchId: 'b', type: 'count_adjusted', delta: 0, mealId: null, reason: null }],
    ['소수 증감', { batchId: 'b', type: 'received', delta: 1.5, mealId: null, reason: null }],
    ['식단 없는 소비', { batchId: 'b', type: 'meal_consumed', delta: -1, mealId: null, reason: null }],
  ])('잘못된 이벤트(%s)는 거부한다', (_, entry) => {
    expect(() => remainingByBatch([entry])).toThrow(DomainError);
  });

  it('식단이 배치별로 실제 가져간 큐브는 소비에서 취소를 뺀 값이다', () => {
    const entries = [
      receiveBatch(sep20, 12),
      consumed('sep20', 'meal-1'),
      consumed('other', 'meal-1', 2),
      reverted('other', 'meal-1', 2),
      consumed('sep20', 'meal-2'),
    ];

    expect(netConsumedByBatch(entries, 'meal-1')).toEqual(new Map([['sep20', 1]]));
    expect(netConsumedByBatch(entries, 'meal-9')).toEqual(new Map());
  });

  it('폐기는 입고 수량이 아니라 남은 수량만큼만 차감한다', () => {
    const entries = [receiveBatch(sep20, 12), consumed('sep20', 'meal-1'), consumed('sep20', 'meal-2')];

    expect(discardRemaining('sep20', entries, 'expired')).toEqual({
      batchId: 'sep20',
      type: 'discarded',
      delta: -10,
      mealId: null,
      reason: 'expired',
    });
  });

  it('남은 큐브가 없는 배치는 폐기할 수 없다', () => {
    const entries = [receiveBatch(sep20, 1), consumed('sep20', 'meal-1')];

    expect(() => discardRemaining('sep20', entries, 'expired')).toThrow(DomainError);
    expect(() => discardRemaining('unknown', entries, 'expired')).toThrow(DomainError);
  });

  it('실사 수량이 다르면 차이만큼 조정 이벤트를 만든다', () => {
    const entries = [receiveBatch(sep20, 12)];

    expect(adjustToCountedCubes('sep20', entries, 10, '세어 보니 10개')?.delta).toBe(-2);
    expect(adjustToCountedCubes('sep20', entries, 13, null)?.delta).toBe(1);
  });

  it('실사 수량이 같으면 이벤트를 만들지 않는다', () => {
    expect(adjustToCountedCubes('sep20', [receiveBatch(sep20, 12)], 12, null)).toBeNull();
  });

  it('실사 수량은 0 이상의 정수여야 한다', () => {
    expect(() => adjustToCountedCubes('sep20', [], -1, null)).toThrow(DomainError);
    expect(() => adjustToCountedCubes('sep20', [], 2.5, null)).toThrow(DomainError);
  });
});

describe('임계일', () => {
  const sep20 = batch('sep20', '2026-09-20');
  const stageOn = (today: string) => expiryStageOn(sep20, localDate(today), DEFAULT_SHELF_LIFE_DAYS);

  it('조리일 9/20의 임계일은 14일 뒤인 10/4다', () => {
    expect(expiryDateOf(sep20, DEFAULT_SHELF_LIFE_DAYS)).toBe('2026-10-04');
  });

  it('임계일 4일 전은 여유다', () => {
    expect(stageOn('2026-09-20')).toEqual({ kind: 'fresh' });
    expect(stageOn('2026-09-30')).toEqual({ kind: 'fresh' });
  });

  it('임계일 3일 전부터 임박이고 daysLeft가 3이다', () => {
    expect(stageOn('2026-10-01')).toEqual({ kind: 'due_soon', daysLeft: 3 });
    expect(stageOn('2026-10-03')).toEqual({ kind: 'due_soon', daysLeft: 1 });
  });

  it('임계일 당일은 임박이고 daysLeft가 0이다', () => {
    expect(stageOn('2026-10-04')).toEqual({ kind: 'due_soon', daysLeft: 0 });
  });

  it('임계일 다음 날은 지남이고 overdueDays가 1이다', () => {
    expect(stageOn('2026-10-05')).toEqual({ kind: 'overdue', overdueDays: 1 });
    expect(stageOn('2026-10-11')).toEqual({ kind: 'overdue', overdueDays: 7 });
  });

  it('임계일 설정값을 바꾸면 그 값으로 계산한다', () => {
    expect(expiryStageOn(sep20, localDate('2026-09-27'), 7)).toEqual({ kind: 'due_soon', daysLeft: 0 });
  });
});

describe('조리일 순 할당', () => {
  const old = batch('old', '2026-09-10');
  const mid = batch('mid', '2026-09-15');
  const recent = batch('recent', '2026-09-20');
  const mealDate = localDate('2026-09-21');

  it('조리일이 가장 오래된 배치에서 먼저 가져간다', () => {
    const remaining = new Map([
      ['recent', 5],
      ['old', 5],
      ['mid', 5],
    ]);

    expect(allocateOldestFirst(broccoli, 1, mealDate, [recent, old, mid], remaining)).toEqual([
      { batchId: 'old', cubes: 1 },
    ]);
  });

  it('오래된 배치가 모자라면 다음 배치로 넘어간다', () => {
    const remaining = new Map([
      ['old', 1],
      ['mid', 5],
    ]);

    expect(allocateOldestFirst(broccoli, 3, mealDate, [old, mid], remaining)).toEqual([
      { batchId: 'old', cubes: 1 },
      { batchId: 'mid', cubes: 2 },
    ]);
  });

  it('조리일이 같으면 배치 id 순으로 가져가 결과가 항상 같다', () => {
    const twin = batch('a-twin', '2026-09-10');
    const remaining = new Map([
      ['old', 1],
      ['a-twin', 1],
    ]);

    expect(allocateOldestFirst(broccoli, 1, mealDate, [old, twin], remaining)).toEqual([
      { batchId: 'a-twin', cubes: 1 },
    ]);
  });

  it('전체 재고로도 모자라면 일부만 가져가지 않고 null을 돌려준다', () => {
    const remaining = new Map([
      ['old', 1],
      ['mid', 1],
    ]);

    expect(allocateOldestFirst(broccoli, 3, mealDate, [old, mid], remaining)).toBeNull();
  });

  it('재고가 전혀 없으면 null이다', () => {
    expect(allocateOldestFirst(broccoli, 1, mealDate, [], new Map())).toBeNull();
    expect(allocateOldestFirst(broccoli, 1, mealDate, [old], new Map([['old', 0]]))).toBeNull();
  });

  it('임계일이 지난 배치도 폐기 전까지는 차감 대상이고 오래된 순서상 먼저 나간다', () => {
    const expired = batch('expired', '2026-09-01');
    const remaining = new Map([
      ['expired', 3],
      ['recent', 9],
    ]);

    expect(allocateOldestFirst(broccoli, 1, mealDate, [recent, expired], remaining)).toEqual([
      { batchId: 'expired', cubes: 1 },
    ]);
  });

  it('큐브 중량이 현재 1회분 중량과 다른 배치에서는 가져가지 않는다', () => {
    const oldWeight = batch('old-weight', '2026-09-01', { cubeWeightGram: 10 });
    const remaining = new Map([
      ['old-weight', 5],
      ['recent', 5],
    ]);

    expect(allocateOldestFirst(broccoli, 1, mealDate, [oldWeight, recent], remaining)).toEqual([
      { batchId: 'recent', cubes: 1 },
    ]);
  });

  it('식단 날짜보다 늦게 조리한 배치에서는 가져가지 않는다', () => {
    const cookedLater = batch('later', '2026-09-22');

    expect(allocateOldestFirst(broccoli, 1, mealDate, [cookedLater], new Map([['later', 5]]))).toBeNull();
  });

  it('식단 당일에 조리한 배치에서는 가져간다', () => {
    const cookedToday = batch('today', '2026-09-21');

    expect(allocateOldestFirst(broccoli, 1, mealDate, [cookedToday], new Map([['today', 5]]))).toEqual([
      { batchId: 'today', cubes: 1 },
    ]);
  });

  it('다른 재료의 배치에서는 가져가지 않는다', () => {
    const beefBatch = batch('beef-batch', '2026-09-10', { ingredientId: 'beef', cubeWeightGram: 10 });

    expect(allocateOldestFirst(broccoli, 1, mealDate, [beefBatch], new Map([['beef-batch', 5]]))).toBeNull();
  });
});

describe('재고현황', () => {
  const expired = batch('expired', '2026-09-01');
  const fresh = batch('fresh', '2026-09-20');
  const oldWeight = batch('old-weight', '2026-09-18', { cubeWeightGram: 10 });
  const beefBatch = batch('beef-batch', '2026-09-07', { ingredientId: 'beef', cubeWeightGram: 10 });
  const today = localDate('2026-09-21');

  it('재고가 없는 재료는 0으로 나온다', () => {
    expect(summarizeStock([broccoli], [], [], today, DEFAULT_SHELF_LIFE_DAYS)).toEqual([
      { ingredientId: 'broccoli', total: 0, fresh: 0, overdue: 0, weightMismatched: 0, batches: [] },
    ]);
  });

  it('임계일이 지난 큐브는 overdue에 세고 fresh에서 빠진다', () => {
    const entries = [receiveBatch(expired, 3), receiveBatch(fresh, 9)];

    const [stock] = summarizeStock([broccoli], [fresh, expired], entries, today, DEFAULT_SHELF_LIFE_DAYS);

    expect(stock).toMatchObject({ total: 12, fresh: 9, overdue: 3, weightMismatched: 0 });
    expect(stock.batches.map((batchStock) => batchStock.batch.id)).toEqual(['expired', 'fresh']);
  });

  it('중량 불일치 배치는 합계에 들어가되 따로 센다', () => {
    const entries = [receiveBatch(fresh, 9), receiveBatch(oldWeight, 4)];

    const [stock] = summarizeStock([broccoli], [fresh, oldWeight], entries, today, DEFAULT_SHELF_LIFE_DAYS);

    expect(stock).toMatchObject({ total: 13, weightMismatched: 4 });
  });

  it('재료별로 나눠 집계한다', () => {
    const entries = [receiveBatch(fresh, 9), receiveBatch(beefBatch, 6)];

    const stocks = summarizeStock([broccoli, beef], [fresh, beefBatch], entries, today, DEFAULT_SHELF_LIFE_DAYS);

    expect(stocks.map((stock) => [stock.ingredientId, stock.total])).toEqual([
      ['broccoli', 9],
      ['beef', 6],
    ]);
  });

  it('임박 배치도 임계일 알람 대상이다', () => {
    const dueIn3Days = batch('due-in-3-days', '2026-09-10');
    const dueTomorrow = batch('due-tomorrow', '2026-09-08');
    const entries = [
      receiveBatch(expired, 3),
      receiveBatch(fresh, 9),
      receiveBatch(dueIn3Days, 1),
      receiveBatch(dueTomorrow, 2),
      receiveBatch(beefBatch, 6),
    ];

    const stocks = summarizeStock(
      [broccoli, beef],
      [expired, fresh, dueIn3Days, dueTomorrow, beefBatch],
      entries,
      today,
      DEFAULT_SHELF_LIFE_DAYS,
    );

    expect(batchesNeedingExpiryAlert(stocks).map((batchStock) => [batchStock.batch.id, batchStock.expiry])).toEqual([
      ['expired', { kind: 'overdue', overdueDays: 6 }],
      ['due-tomorrow', { kind: 'due_soon', daysLeft: 1 }],
      ['due-in-3-days', { kind: 'due_soon', daysLeft: 3 }],
      ['beef-batch', { kind: 'due_soon', daysLeft: 0 }],
    ]);
  });

  it('상비 재료는 재고 현황에 행이 없다', () => {
    const eggBatch = batch('egg-batch', '2026-09-20', { ingredientId: 'egg', cubeWeightGram: 10 });
    const entries = [receiveBatch(fresh, 9), receiveBatch(eggBatch, 2)];

    const stocks = summarizeStock([broccoli, egg], [fresh, eggBatch], entries, today, DEFAULT_SHELF_LIFE_DAYS);

    expect(stocks.map((stock) => stock.ingredientId)).toEqual(['broccoli']);
  });

  it('임계 지남 배치가 소비로 0개가 되면 알람 대상에서 빠진다', () => {
    const entries = [receiveBatch(expired, 1), consumed('expired', 'meal-1')];

    const stocks = summarizeStock([broccoli], [expired], entries, today, DEFAULT_SHELF_LIFE_DAYS);

    expect(batchesNeedingExpiryAlert(stocks)).toEqual([]);
    expect(stocks[0].total).toBe(0);
  });

  it('부모가 폐기를 지시하면 남은 수량이 빠지고 알람도 끝난다', () => {
    const received = [receiveBatch(expired, 3), receiveBatch(fresh, 9)];
    const entries = [...received, discardRemaining('expired', received, 'expired')];

    const stocks = summarizeStock([broccoli], [expired, fresh], entries, today, DEFAULT_SHELF_LIFE_DAYS);

    expect(stocks[0]).toMatchObject({ total: 9, overdue: 0 });
    expect(batchesNeedingExpiryAlert(stocks)).toEqual([]);
  });

  it('합계가 임계개수 이하이면 임계개수 알람 대상이다', () => {
    const [stock] = summarizeStock([broccoli], [fresh], [receiveBatch(fresh, 3)], today, DEFAULT_SHELF_LIFE_DAYS);

    expect(isAtOrBelowThreshold(stock, 3)).toBe(true);
    expect(isAtOrBelowThreshold(stock, 2)).toBe(false);
  });
});
