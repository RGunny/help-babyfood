import { Ingredient } from '../domain/ingredient/ingredient.js';
import { IngredientCatalog } from '../domain/ingredient/ingredient-catalog.js';
import { Meal } from '../domain/meal-plan/meal.js';
import { MealCalendar, NoFeedRecord } from '../domain/meal-plan/meal-calendar.js';
import { Menu } from '../domain/menu/menu.js';
import { MealPlanningRules } from '../domain/rules/meal-rules.js';
import { LocalDate, addDays, localDate } from '../domain/shared/local-date.js';
import { LocalDateTime, localTime } from '../domain/shared/local-time.js';
import { CookedBatch, LedgerEntry } from '../domain/stock/ledger.js';
import { DailyBrief, buildDailyBrief } from './daily-brief.js';
import { HouseholdState } from './household-state.js';
import { FeedingHistory, RecordedReaction } from './ports/feeding-history.port.js';

const TODAY = '2026-09-22';
const MEAL_TIME = '10:00';

const INGREDIENTS: Ingredient[] = [
  { id: 'rice', name: '쌀', aliases: [], category: 'base', servingWeightGram: 30, stockTracking: 'cubes', constituentIngredientIds: [] },
  { id: 'oatmeal', name: '오트밀', aliases: [], category: 'base', servingWeightGram: 10, stockTracking: 'cubes', constituentIngredientIds: [] },
  { id: 'beef', name: '소고기', aliases: [], category: 'meat', servingWeightGram: 10, stockTracking: 'cubes', constituentIngredientIds: [] },
  { id: 'broccoli', name: '브로콜리', aliases: [], category: 'vegetable', servingWeightGram: 15, stockTracking: 'cubes', constituentIngredientIds: [] },
  { id: 'pea', name: '완두콩', aliases: [], category: 'vegetable', servingWeightGram: 15, stockTracking: 'cubes', constituentIngredientIds: [] },
  { id: 'egg', name: '계란', aliases: [], category: 'high_risk_allergen', servingWeightGram: 10, stockTracking: 'pantry', constituentIngredientIds: [] },
];

const PORRIDGE: Menu = {
  id: 'porridge',
  name: '쌀오트밀죽',
  components: [
    { ingredientId: 'rice', cubes: 1 },
    { ingredientId: 'oatmeal', cubes: 1 },
  ],
};

/** 이관 때 검증이 끝난 재료로 등록한 넷. 완두콩만 미도입으로 남는다. */
const VERIFIED_AT_MIGRATION = new Set(['rice', 'oatmeal', 'beef', 'broccoli']);

const NO_RULES: MealPlanningRules = {
  forbiddenPairings: [],
  maxFirstIntroductionsPerDay: null,
  firstIntroductionSlot: null,
};

function meal(order: number, toppings: string[], overrides: Partial<Meal> = {}): Meal {
  return {
    id: `meal-${order}`,
    slot: 'morning',
    order,
    planned: { baseMenuId: PORRIDGE.id, toppingIngredientIds: toppings },
    actual: null,
    memo: null,
    status: 'planned',
    migrated: false,
    ...overrides,
  };
}

interface StockSpec {
  readonly ingredientId: string;
  readonly cookedOn: string;
  readonly cubes: number;
  /** Defaults to the ingredient's current serving weight, which is what deduction requires. */
  readonly cubeWeightGram?: number;
}

function stock(specs: readonly StockSpec[]): { batches: CookedBatch[]; entries: LedgerEntry[] } {
  const batches: CookedBatch[] = [];
  const entries: LedgerEntry[] = [];
  for (const spec of specs) {
    const serving = INGREDIENTS.find((item) => item.id === spec.ingredientId)!.servingWeightGram;
    const batch: CookedBatch = {
      id: `${spec.ingredientId}-${spec.cookedOn}-${spec.cubeWeightGram ?? serving}`,
      ingredientId: spec.ingredientId,
      cubeWeightGram: spec.cubeWeightGram ?? serving,
      cookedOn: localDate(spec.cookedOn),
    };
    batches.push(batch);
    entries.push({ batchId: batch.id, type: 'received', delta: spec.cubes, mealId: null, reason: null });
  }
  return { batches, entries };
}

/** 임계일(14일) 안쪽이라 알람이 없는 재고. 완두콩만 없어 부족과 보류가 생긴다. */
const DEFAULT_STOCK = stock([
  { ingredientId: 'rice', cookedOn: '2026-09-15', cubes: 10 },
  { ingredientId: 'oatmeal', cookedOn: '2026-09-15', cubes: 10 },
  { ingredientId: 'beef', cookedOn: '2026-09-15', cubes: 10 },
  { ingredientId: 'broccoli', cookedOn: '2026-09-15', cubes: 10 },
]);

const clear = (mealId: string, ingredientId: string): RecordedReaction => ({
  mealId,
  ingredientId,
  result: 'clear',
});

interface Fixture {
  readonly meals?: readonly Meal[];
  readonly slotStartDate?: string;
  readonly noFeedRecords?: readonly NoFeedRecord[];
  readonly stock?: { batches: CookedBatch[]; entries: LedgerEntry[] };
  readonly rules?: MealPlanningRules;
  readonly thresholds?: ReadonlyMap<string, number>;
  readonly history?: Partial<FeedingHistory>;
  readonly at?: string;
}

/**
 * The default household: the morning slot opens today at 10:00 with five meals ahead of it, today's
 * meal carrying the one ingredient that has never been fed. "Now" is before the meal time, so
 * nothing is due yet.
 */
function brief(fixture: Fixture = {}): DailyBrief {
  const calendar = new MealCalendar(
    [
      {
        slot: 'morning',
        startDate: localDate(fixture.slotStartDate ?? TODAY),
        mealTime: localTime(MEAL_TIME),
      },
    ],
    fixture.noFeedRecords ?? [],
  );
  const { batches, entries } = fixture.stock ?? DEFAULT_STOCK;
  const state: HouseholdState = {
    householdId: 'household',
    ingredients: INGREDIENTS,
    catalog: new IngredientCatalog(INGREDIENTS),
    menus: new Map([[PORRIDGE.id, PORRIDGE]]),
    calendar,
    meals: fixture.meals ?? [
      meal(1, ['beef', 'pea']),
      meal(2, ['beef', 'broccoli']),
      meal(3, ['beef', 'broccoli']),
      meal(4, ['beef', 'broccoli']),
      meal(5, ['beef', 'broccoli']),
    ],
    nextMealOrders: new Map([['morning', 6]]),
    batches,
    entries,
    rules: fixture.rules ?? NO_RULES,
    textGuidance: null,
    alertSettings: { briefTime: localTime('07:30'), shelfLifeDays: 14 },
    thresholds: fixture.thresholds ?? new Map(),
  };
  const history: FeedingHistory = {
    consumedMeals: [],
    reactions: [],
    verifiedBeforeMigrationIds: VERIFIED_AT_MIGRATION,
    ...fixture.history,
  };
  return buildDailyBrief({ state, history, now: at(fixture.at ?? '08:00') });
}

const at = (time: string): LocalDateTime => ({ date: localDate(TODAY), time: localTime(time) });
const dateOf = (daysFromToday: number): LocalDate => addDays(localDate(TODAY), daysFromToday);

describe('데일리 브리프', () => {
  describe('오늘 식단', () => {
    it('날짜와 일차, 끼니별 식단과 식단시간이 머리에 온다', () => {
      const today = brief();

      expect(today.date).toBe(TODAY);
      expect(today.dayNumber).toBe(1);
      expect(today.slots).toEqual([
        {
          slot: 'morning',
          mealTime: MEAL_TIME,
          meal: {
            menuName: '쌀오트밀죽',
            toppingNames: ['소고기', '완두콩'],
            memo: null,
            fed: false,
            corrected: false,
          },
          noFeed: null,
        },
      ]);
    });

    it('일차는 급여를 시작한 날부터 센다', () => {
      expect(brief({ slotStartDate: '2026-09-20' }).dayNumber).toBe(3);
    });

    it('실제 급여 내용을 고친 식단은 고친 내용으로 보인다', () => {
      const today = brief({
        meals: [meal(1, ['beef', 'pea'], { actual: { baseMenuId: PORRIDGE.id, toppingIngredientIds: ['beef'] } })],
      });

      expect(today.slots[0].meal).toMatchObject({ toppingNames: ['소고기'], corrected: true });
    });

    it('미급여로 등록한 끼니는 식단 없이 미급여 기록으로 보인다', () => {
      const record: NoFeedRecord = {
        date: localDate(TODAY),
        slot: 'morning',
        thawed: false,
        reason: '감기',
      };

      const today = brief({ noFeedRecords: [record] });

      expect(today.slots[0].meal).toBeNull();
      expect(today.slots[0].noFeed).toEqual(record);
      expect(today.dayNumber).toBeNull();
    });
  });

  describe('새 재료 관찰 안내', () => {
    it('오늘 식단의 미도입 재료가 회차와 함께 올라온다', () => {
      expect(brief().newIngredients).toEqual([
        { ingredientId: 'pea', name: '완두콩', slot: 'morning', exposureNumber: 1 },
      ]);
    });

    it('이상 없음을 한 번 기록한 재료는 2회차로 올라온다', () => {
      const fed = meal(1, ['beef', 'pea'], { id: 'fed', status: 'consumed' });

      const today = brief({ history: { consumedMeals: [fed], reactions: [clear('fed', 'pea')] } });

      expect(today.newIngredients).toMatchObject([{ name: '완두콩', exposureNumber: 2 }]);
    });

    it('검증완료 재료는 올라오지 않는다', () => {
      const today = brief({ meals: [meal(1, ['beef', 'broccoli'])] });

      expect(today.newIngredients).toEqual([]);
    });
  });

  describe('재고현황', () => {
    it('합계와 가용, 임계 지남을 나눠 보인다', () => {
      const today = brief({
        stock: stock([
          { ingredientId: 'broccoli', cookedOn: '2026-09-15', cubes: 9 },
          // 임계일(9/19)이 지났지만 합계에는 그대로 들어간다.
          { ingredientId: 'broccoli', cookedOn: '2026-09-05', cubes: 3 },
        ]),
      });

      expect(today.stock.find((row) => row.name === '브로콜리')).toMatchObject({
        total: 12,
        fresh: 9,
        overdue: 3,
      });
    });

    it('재고가 없는 재료도 한 줄로 나온다', () => {
      expect(brief().stock.map((row) => row.name)).toEqual([
        '쌀',
        '오트밀',
        '소고기',
        '브로콜리',
        '완두콩',
      ]);
    });

    it('상비 재료는 재고 표에 없고 상비 목록에 이름이 있다', () => {
      const today = brief();

      expect(today.stock.map((row) => row.name)).not.toContain('계란');
      expect(today.pantryIngredients).toEqual([{ ingredientId: 'egg', name: '계란' }]);
    });

    it('임계일 열은 잔여가 있는 가장 이른 배치의 임계일과 단계다', () => {
      const today = brief({
        stock: stock([
          { ingredientId: 'broccoli', cookedOn: '2026-09-15', cubes: 9 },
          { ingredientId: 'broccoli', cookedOn: '2026-09-09', cubes: 2 },
        ]),
      });

      expect(today.stock.find((row) => row.name === '브로콜리')!.nextExpiry).toEqual({
        date: dateOf(1),
        stage: { kind: 'due_soon', daysLeft: 1 },
      });
    });

    it('배치가 없는 재료의 임계일 열은 비어 있다', () => {
      expect(brief().stock.find((row) => row.name === '완두콩')!.nextExpiry).toBeNull();
    });

    it('식단이 재고를 다 쓰는 날이 소진 예상일로 붙는다', () => {
      const today = brief({
        meals: [meal(1, ['beef']), meal(2, ['beef']), meal(3, ['beef'])],
        stock: stock([
          { ingredientId: 'rice', cookedOn: '2026-09-15', cubes: 10 },
          { ingredientId: 'oatmeal', cookedOn: '2026-09-15', cubes: 10 },
          { ingredientId: 'beef', cookedOn: '2026-09-15', cubes: 2 },
        ]),
      });

      // 오늘과 내일 식단이 두 개를 쓰고 모레 식단은 못 채운다.
      expect(today.stock.find((row) => row.name === '소고기')).toMatchObject({
        depletionDate: dateOf(1),
      });
      expect(today.shortages).toMatchObject([
        { name: '소고기', firstShortageDate: dateOf(2), shortfallCubes: 1, plannedCubes: 3 },
      ]);
    });
  });

  describe('부족 예측과 임계개수', () => {
    it('재고가 없는 재료는 그 식단 날짜부터 부족으로 올라온다', () => {
      expect(brief().shortages).toMatchObject([
        { name: '완두콩', firstShortageDate: TODAY, shortfallCubes: 1 },
      ]);
    });

    it('임계개수 이하인 재료만 임계개수 알람에 오른다', () => {
      const today = brief({
        stock: stock([
          { ingredientId: 'beef', cookedOn: '2026-09-15', cubes: 3 },
          { ingredientId: 'broccoli', cookedOn: '2026-09-15', cubes: 9 },
        ]),
        thresholds: new Map([
          ['beef', 3],
          ['broccoli', 3],
        ]),
      });

      expect(today.thresholdAlerts).toEqual([
        { ingredientId: 'beef', name: '소고기', total: 3, thresholdCubes: 3 },
      ]);
    });
  });

  describe('재고 알람', () => {
    /** 죽의 쌀과 오트밀은 넉넉하게 두어 토핑 재료만 항목이 되게 한다. */
    const stockWith = (specs: readonly StockSpec[]) =>
      stock([
        { ingredientId: 'rice', cookedOn: '2026-09-15', cubes: 20 },
        { ingredientId: 'oatmeal', cookedOn: '2026-09-15', cubes: 20 },
        ...specs,
      ]);
    /** 식단 n번은 오늘 + (n − 1)일이다. */
    const mealsOf = (count: number, toppings: string[]): Meal[] =>
      Array.from({ length: count }, (_, index) => meal(index + 1, toppings));

    it('첫 부족일이 오늘이나 내일이면 urgent다', () => {
      const today = brief({
        meals: [meal(1, ['pea']), meal(2, ['beef']), meal(3, ['broccoli'])],
        stock: stockWith([]),
      });

      expect(today.stockAlert.horizonDays).toBe(7);
      expect(today.stockAlert.items).toMatchObject([
        { name: '완두콩', firstShortageDate: TODAY, daysUntilShortage: 0, urgency: 'urgent' },
        { name: '소고기', firstShortageDate: dateOf(1), daysUntilShortage: 1, urgency: 'urgent' },
        { name: '브로콜리', firstShortageDate: dateOf(2), daysUntilShortage: 2, urgency: 'upcoming' },
      ]);
    });

    it('첫 부족일이 7일 안이면 upcoming이다', () => {
      // 소고기 일곱 개가 오늘부터 6일째까지를 덮고 7일째 식단(8번)이 처음 모자란다.
      const today = brief({
        meals: mealsOf(8, ['beef']),
        stock: stockWith([{ ingredientId: 'beef', cookedOn: '2026-09-15', cubes: 7 }]),
      });

      expect(today.stockAlert.items).toEqual([
        {
          ingredientId: 'beef',
          name: '소고기',
          total: 7,
          thresholdCubes: null,
          firstShortageDate: dateOf(7),
          daysUntilShortage: 7,
          horizonShortfallCubes: 1,
          urgency: 'upcoming',
        },
      ]);
    });

    it('첫 부족일이 8일 뒤이고 임계개수가 없으면 항목이 아니다', () => {
      const today = brief({
        meals: mealsOf(9, ['beef']),
        stock: stockWith([{ ingredientId: 'beef', cookedOn: '2026-09-15', cubes: 8 }]),
      });

      expect(today.stock.find((row) => row.name === '소고기')!.firstShortageDate).toBe(dateOf(8));
      expect(today.stockAlert.items).toEqual([]);
    });

    it('첫 부족일이 8일 뒤여도 임계개수 이하면 low_stock으로 든다', () => {
      const today = brief({
        meals: mealsOf(9, ['beef']),
        stock: stockWith([{ ingredientId: 'beef', cookedOn: '2026-09-15', cubes: 8 }]),
        thresholds: new Map([['beef', 8]]),
      });

      expect(today.stockAlert.items).toEqual([
        {
          ingredientId: 'beef',
          name: '소고기',
          total: 8,
          thresholdCubes: 8,
          firstShortageDate: dateOf(8),
          daysUntilShortage: 8,
          horizonShortfallCubes: 0,
          urgency: 'low_stock',
        },
      ]);
    });

    it('식단에 없는 재료도 임계개수 이하면 low_stock이고 남은 일수가 없다', () => {
      const today = brief({
        meals: mealsOf(3, []),
        stock: stockWith([]),
        thresholds: new Map([['pea', 4]]),
      });

      expect(today.stockAlert.items).toEqual([
        {
          ingredientId: 'pea',
          name: '완두콩',
          total: 0,
          thresholdCubes: 4,
          firstShortageDate: null,
          daysUntilShortage: null,
          horizonShortfallCubes: 0,
          urgency: 'low_stock',
        },
      ]);
    });

    it('임계개수보다 많고 부족이 7일 밖이면 항목이 아니다', () => {
      const today = brief({
        meals: mealsOf(9, ['beef']),
        stock: stockWith([
          { ingredientId: 'beef', cookedOn: '2026-09-15', cubes: 8 },
          { ingredientId: 'broccoli', cookedOn: '2026-09-15', cubes: 5 },
        ]),
        thresholds: new Map([
          ['beef', 7],
          ['broccoli', 4],
        ]),
      });

      expect(today.stockAlert.items).toEqual([]);
    });

    it('7일 안의 부족 수량은 7일 안의 식단만 센다', () => {
      // 소고기 여섯 개 뒤로 식단 7~10번이 모자라고, 그중 7일 창에 드는 것은 7번과 8번이다.
      const today = brief({
        meals: mealsOf(10, ['beef']),
        stock: stockWith([{ ingredientId: 'beef', cookedOn: '2026-09-15', cubes: 6 }]),
      });

      expect(today.shortages).toMatchObject([{ name: '소고기', shortfallCubes: 4 }]);
      expect(today.stockAlert.items).toMatchObject([
        { name: '소고기', firstShortageDate: dateOf(6), horizonShortfallCubes: 2, urgency: 'upcoming' },
      ]);
    });

    it('재고가 있어도 중량이 달라 차감하지 못하면 부족으로 든다', () => {
      const today = brief({
        meals: [meal(1, ['broccoli'])],
        stock: stockWith([{ ingredientId: 'broccoli', cookedOn: '2026-09-15', cubes: 4, cubeWeightGram: 20 }]),
        // 합계 4는 임계개수 3보다 많다. 항목이 되는 이유는 예측뿐이다.
        thresholds: new Map([['broccoli', 3]]),
      });

      expect(today.stockAlert.items).toEqual([
        {
          ingredientId: 'broccoli',
          name: '브로콜리',
          total: 4,
          thresholdCubes: null,
          firstShortageDate: TODAY,
          daysUntilShortage: 0,
          horizonShortfallCubes: 1,
          urgency: 'urgent',
        },
      ]);
    });

    it('상비 재료는 항목이 되지 않는다', () => {
      const today = brief({
        meals: [meal(1, ['egg'])],
        stock: stockWith([]),
        thresholds: new Map([['egg', 4]]),
      });

      expect(today.stockAlert.items).toEqual([]);
    });

    it('항목은 첫 부족일이 이른 순이고 첫 부족일이 없는 항목이 뒤다', () => {
      // 재고 표의 순서는 쌀, 오트밀, 소고기, 브로콜리, 완두콩이다.
      const today = brief({
        meals: [meal(1, []), meal(2, ['broccoli']), meal(3, []), meal(4, ['beef'])],
        stock: stock([
          { ingredientId: 'rice', cookedOn: '2026-09-15', cubes: 4 },
          { ingredientId: 'oatmeal', cookedOn: '2026-09-15', cubes: 20 },
        ]),
        thresholds: new Map([
          ['rice', 4],
          ['pea', 4],
        ]),
      });

      expect(today.stockAlert.items.map((item) => [item.name, item.firstShortageDate])).toEqual([
        ['브로콜리', dateOf(1)],
        ['소고기', dateOf(3)],
        ['쌀', null],
        ['완두콩', null],
      ]);
    });

    it('재고 표의 행에 첫 부족일이 붙고 재고가 0인 재료도 식단 날짜가 붙는다', () => {
      const today = brief({
        meals: [meal(1, ['beef']), meal(2, ['beef', 'pea']), meal(3, ['beef'])],
        stock: stockWith([{ ingredientId: 'beef', cookedOn: '2026-09-15', cubes: 2 }]),
      });

      const rowOf = (name: string) => today.stock.find((row) => row.name === name)!;
      expect(rowOf('소고기')).toMatchObject({ depletionDate: dateOf(1), firstShortageDate: dateOf(2) });
      // 할당이 한 번도 성공하지 않아 소진 예상일은 없지만 모자라는 첫날은 있다.
      expect(rowOf('완두콩')).toMatchObject({ total: 0, depletionDate: null, firstShortageDate: dateOf(1) });
      expect(rowOf('쌀').firstShortageDate).toBeNull();
    });
  });

  describe('임계일 알람', () => {
    it('전일과 당일과 초과만 오르고 신선한 배치는 오르지 않는다', () => {
      const today = brief({
        stock: stock([
          { ingredientId: 'rice', cookedOn: '2026-09-15', cubes: 1 },
          { ingredientId: 'oatmeal', cookedOn: '2026-09-09', cubes: 2 },
          { ingredientId: 'beef', cookedOn: '2026-09-08', cubes: 3 },
          { ingredientId: 'broccoli', cookedOn: '2026-09-05', cubes: 4 },
        ]),
      });

      expect(today.expiryAlerts).toMatchObject([
        { name: '오트밀', expiryDate: dateOf(1), remaining: 2, stage: { kind: 'due_soon', daysLeft: 1 } },
        { name: '소고기', expiryDate: TODAY, remaining: 3, stage: { kind: 'due_soon', daysLeft: 0 } },
        {
          name: '브로콜리',
          expiryDate: '2026-09-19',
          remaining: 4,
          stage: { kind: 'overdue', overdueDays: 3 },
        },
      ]);
    });
  });

  describe('확인 필요', () => {
    it('재고가 모자라 보류된 차감이 올라온다', () => {
      // 식단시간이 지나야 차감이 일어나고, 그때 완두콩만 재고가 없다.
      const today = brief({ at: '12:00' });

      expect(today.attention.heldDeductions).toEqual([
        { ingredientId: 'pea', name: '완두콩', cubes: 1, date: TODAY, slot: 'morning' },
      ]);
    });

    it('상비 재료는 재고가 없어도 보류된 차감에 오르지 않는다', () => {
      const today = brief({ meals: [meal(1, ['beef', 'egg'])], at: '12:00' });

      expect(today.attention.heldDeductions).toEqual([]);
    });

    it('식단시간 전에는 보류된 차감이 없다', () => {
      expect(brief().attention.heldDeductions).toEqual([]);
    });

    it('반응을 기록하지 않은 급여가 올라온다', () => {
      const fed = meal(1, ['beef', 'pea'], { id: 'fed', status: 'consumed' });

      const today = brief({ history: { consumedMeals: [fed] } });

      expect(today.attention.unrecordedReactions).toEqual([
        { ingredientId: 'pea', name: '완두콩', date: TODAY, slot: 'morning' },
      ]);
    });

    it('반응을 기록한 급여는 올라오지 않는다', () => {
      const fed = meal(1, ['beef', 'pea'], { id: 'fed', status: 'consumed' });

      const today = brief({ history: { consumedMeals: [fed], reactions: [clear('fed', 'pea')] } });

      expect(today.attention.unrecordedReactions).toEqual([]);
    });

    it('이관된 식단은 반응 미기록으로 올라오지 않는다', () => {
      const migrated = meal(1, ['beef', 'pea'], { id: 'migrated', status: 'consumed', migrated: true });

      const today = brief({ history: { consumedMeals: [migrated] } });

      expect(today.attention.unrecordedReactions).toEqual([]);
    });

    it('남은 식단의 조합 금지 위반이 올라온다', () => {
      const today = brief({
        rules: { ...NO_RULES, forbiddenPairings: [{ ingredientIds: ['beef', 'pea'], scope: 'same_meal' }] },
      });

      expect(today.attention.ruleWarnings).toEqual([
        {
          code: 'FORBIDDEN_PAIRING',
          date: TODAY,
          slot: 'morning',
          ingredientNames: ['소고기', '완두콩'],
        },
      ]);
    });

    it('오늘 뒤에 있는 식단의 위반도 올라온다', () => {
      const today = brief({
        meals: [meal(1, ['beef']), meal(2, ['beef', 'pea'])],
        rules: { ...NO_RULES, forbiddenPairings: [{ ingredientIds: ['beef', 'pea'], scope: 'same_meal' }] },
      });

      expect(today.attention.ruleWarnings).toMatchObject([{ date: dateOf(1) }]);
    });

    it('중량이 1회분과 다른 배치가 올라온다', () => {
      const today = brief({
        stock: stock([{ ingredientId: 'broccoli', cookedOn: '2026-09-15', cubes: 4, cubeWeightGram: 20 }]),
      });

      expect(today.attention.weightMismatchedBatches).toMatchObject([
        { name: '브로콜리', remaining: 4, cubeWeightGram: 20, servingWeightGram: 15 },
      ]);
    });

    it('식단 잔여 일수가 임계 이하면 경고가 붙는다', () => {
      const today = brief();

      expect(today.attention.planRunwayDays).toBe(4);
      expect(today.attention.planRunwayShort).toBe(true);
    });

    it('식단이 넉넉하면 경고가 붙지 않는다', () => {
      const meals = Array.from({ length: 20 }, (_, index) => meal(index + 1, ['beef', 'broccoli']));

      const today = brief({ meals });

      expect(today.attention.planRunwayDays).toBe(19);
      expect(today.attention.planRunwayShort).toBe(false);
    });

    it('예정 식단이 없으면 잔여 일수가 없고 경고가 붙는다', () => {
      const today = brief({ meals: [] });

      expect(today.attention.planRunwayDays).toBeNull();
      expect(today.attention.planRunwayShort).toBe(true);
    });
  });
});
