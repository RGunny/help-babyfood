import { Ingredient } from '../domain/ingredient/ingredient.js';
import { IngredientCatalog } from '../domain/ingredient/ingredient-catalog.js';
import { Meal } from '../domain/meal-plan/meal.js';
import { MealCalendar, NoFeedRecord, SlotSchedule } from '../domain/meal-plan/meal-calendar.js';
import { Menu } from '../domain/menu/menu.js';
import { localDate } from '../domain/shared/local-date.js';
import { localTime } from '../domain/shared/local-time.js';
import { MealSlot } from '../domain/shared/meal-slot.js';
import { BoardDay, HouseholdBoard, MAX_BOARD_BLOCKS, buildHouseholdBoard } from './household-board.js';
import { HouseholdState } from './household-state.js';
import { FeedingHistory, RecordedReaction } from './ports/feeding-history.port.js';

const START = '2026-08-31';
const TODAY = '2026-09-26';

const INGREDIENTS: Ingredient[] = [
  { id: 'rice', name: '쌀', aliases: [], category: 'base', servingWeightGram: 30 },
  { id: 'oatmeal', name: '오트밀', aliases: [], category: 'base', servingWeightGram: 10 },
  { id: 'flour', name: '밀가루', aliases: [], category: 'high_risk_allergen', servingWeightGram: 10 },
  { id: 'beef', name: '소고기', aliases: [], category: 'meat', servingWeightGram: 10 },
  { id: 'pea', name: '완두콩', aliases: [], category: 'vegetable', servingWeightGram: 15 },
  { id: 'egg', name: '계란', aliases: [], category: 'high_risk_allergen', servingWeightGram: 10 },
];

const PORRIDGE: Menu = {
  id: 'porridge',
  name: '쌀오트밀죽',
  components: [
    { ingredientId: 'rice', cubes: 1 },
    { ingredientId: 'oatmeal', cubes: 1 },
  ],
};
const FLOUR_PORRIDGE: Menu = {
  id: 'flour-porridge',
  name: '쌀밀가루죽',
  components: [
    { ingredientId: 'rice', cubes: 1 },
    { ingredientId: 'flour', cubes: 1 },
  ],
};

interface MealSpec {
  readonly order: number;
  readonly toppings?: string[];
  readonly slot?: MealSlot;
  readonly menuId?: string | null;
  readonly consumed?: boolean;
  readonly actual?: { menuId: string | null; toppings: string[] };
  readonly memo?: string;
}

function meal(spec: MealSpec): Meal {
  return {
    id: `${spec.slot ?? 'morning'}-${spec.order}`,
    slot: spec.slot ?? 'morning',
    order: spec.order,
    planned: { baseMenuId: spec.menuId === undefined ? PORRIDGE.id : spec.menuId, toppingIngredientIds: spec.toppings ?? [] },
    actual: spec.actual === undefined ? null : { baseMenuId: spec.actual.menuId, toppingIngredientIds: spec.actual.toppings },
    memo: spec.memo ?? null,
    status: spec.consumed === true ? 'consumed' : 'planned',
    migrated: false,
  };
}

/** 오전 식단 `count`개. 1~`fedThrough`번째는 급여 완료다. 토핑은 소고기 하나다. */
function plainMeals(count: number, fedThrough: number): Meal[] {
  return Array.from({ length: count }, (_, index) =>
    meal({ order: index + 1, toppings: ['beef'], consumed: index + 1 <= fedThrough }),
  );
}

interface Fixture {
  readonly meals?: readonly Meal[];
  readonly schedules?: readonly SlotSchedule[];
  readonly noFeedRecords?: readonly NoFeedRecord[];
  readonly reactions?: readonly RecordedReaction[];
  readonly verified?: readonly string[];
  readonly today?: string;
}

/**
 * The migrated household: the morning slot started 2026-08-31, today is 2026-09-26 (27일차), and
 * rice, oatmeal and beef were registered as verified at migration.
 */
function board(fixture: Fixture = {}): HouseholdBoard {
  const schedules = fixture.schedules ?? [{ slot: 'morning', startDate: localDate(START), mealTime: localTime('10:00') }];
  const meals = fixture.meals ?? plainMeals(35, 27);
  const calendar = new MealCalendar(schedules, fixture.noFeedRecords ?? []);
  const state: HouseholdState = {
    householdId: 'household',
    ingredients: INGREDIENTS,
    catalog: new IngredientCatalog(INGREDIENTS),
    menus: new Map([
      [PORRIDGE.id, PORRIDGE],
      [FLOUR_PORRIDGE.id, FLOUR_PORRIDGE],
    ]),
    calendar,
    meals,
    nextMealOrders: new Map([['morning', meals.length + 1]]),
    batches: [],
    entries: [],
    rules: { forbiddenPairings: [], maxFirstIntroductionsPerDay: null, firstIntroductionSlot: null },
    textGuidance: null,
    alertSettings: { briefTime: localTime('07:30'), shelfLifeDays: 14 },
    thresholds: new Map(),
  };
  const history: FeedingHistory = {
    consumedMeals: meals.filter((entry) => entry.status === 'consumed'),
    reactions: fixture.reactions ?? [],
    verifiedBeforeMigrationIds: new Set(fixture.verified ?? ['rice', 'oatmeal', 'beef']),
  };
  return buildHouseholdBoard({ state, history, now: { date: localDate(fixture.today ?? TODAY), time: localTime('09:00') } });
}

const dayOf = (result: HouseholdBoard, date: string): BoardDay => {
  const day = result.blocks.flatMap((block) => block.days).find((candidate) => candidate.date === date);
  if (day === undefined) throw new Error(`창 밖의 날짜입니다: ${date}`);
  return day;
};

const morningOf = (result: HouseholdBoard, date: string) => dayOf(result, date).slots.find((entry) => entry.slot === 'morning')!;

const toppingMarks = (result: HouseholdBoard, date: string) =>
  morningOf(result, date).meal!.toppings.map((topping) => [topping.name, topping.exposureNumber, topping.reacted]);

describe('상태판의 블록', () => {
  it('블록은 이유식 시작일부터 10일 단위이고, 7일 전이 속한 블록부터 마지막 예정 식단의 블록까지 보인다', () => {
    // 시작일 08-31. 09-19(7일 전)는 09-10~09-19인 2번 블록, 마지막 예정 식단 10-04는 4번 블록이다.
    const result = board();

    expect(result.blocks.map((block) => block.number)).toEqual([2, 3, 4]);
    expect(result.blocks[0].days.map((day) => day.date)).toEqual([
      '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14',
      '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19',
    ]);
    expect(result.blocks[2].days.at(-1)?.date).toBe('2026-10-09');
    expect(result.omittedBlocks).toBe(0);
  });

  it('예정 식단이 없으면 오늘이 속한 블록까지만 보인다', () => {
    const result = board({ meals: plainMeals(27, 27) });

    expect(result.blocks.map((block) => block.number)).toEqual([2, 3]);
  });

  it('블록이 여섯을 넘으면 오래된 블록을 버리고 그 수를 센다', () => {
    // 식단이 100개면 마지막 예정 식단은 12-08(10번 블록)이다. 2~10번 아홉 블록 중 앞 셋을 버린다.
    const result = board({ meals: plainMeals(100, 27) });

    expect(result.blocks).toHaveLength(MAX_BOARD_BLOCKS);
    expect(result.blocks.map((block) => block.number)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(result.omittedBlocks).toBe(3);
  });

  it('이유식이 시작되기 전 날짜는 1번 블록보다 앞으로 가지 않는다', () => {
    // 오늘이 시작일 이틀 뒤면 7일 전은 시작일보다 앞이다. 그래도 1번 블록에서 시작한다.
    const result = board({ meals: plainMeals(5, 2), today: '2026-09-02' });

    expect(result.blocks.map((block) => block.number)).toEqual([1]);
    expect(result.blocks[0].days[0].date).toBe(START);
  });

  it('끼니가 하나도 없으면 블록도 없고 브리프만 있다', () => {
    const result = board({ schedules: [], meals: [] });

    expect(result.blocks).toEqual([]);
    expect(result.slots).toEqual([]);
    expect(result.brief.date).toBe(TODAY);
  });

  it('끼니는 오전, 오후 순서이고 창 안에 식단이 있는 끼니만 센다', () => {
    const result = board({
      schedules: [
        { slot: 'afternoon', startDate: localDate('2026-09-20'), mealTime: localTime('15:00') },
        { slot: 'morning', startDate: localDate(START), mealTime: localTime('10:00') },
      ],
      meals: [...plainMeals(35, 27), meal({ slot: 'afternoon', order: 1, toppings: ['pea'] })],
    });

    expect(result.slots).toEqual(['morning', 'afternoon']);
    expect(dayOf(result, '2026-09-20').slots.map((entry) => entry.slot)).toEqual(['morning', 'afternoon']);
  });
});

describe('상태판의 날', () => {
  it('일차와 급여 여부가 날짜마다 붙는다', () => {
    const result = board();

    expect(dayOf(result, TODAY).dayNumber).toBe(27);
    expect(morningOf(result, TODAY).meal?.fed).toBe(true);
    expect(morningOf(result, '2026-09-27').meal?.fed).toBe(false);
  });

  it('미급여로 밀린 날은 식단이 없고 일차도 없으며, 그 뒤 식단은 하루씩 밀린다', () => {
    const result = board({
      meals: plainMeals(35, 27),
      noFeedRecords: [{ date: localDate('2026-09-27'), slot: 'morning', thawed: false, reason: '감기' }],
    });

    const skipped = dayOf(result, '2026-09-27');
    expect(skipped.dayNumber).toBeNull();
    expect(skipped.slots[0].meal).toBeNull();
    expect(skipped.slots[0].noFeed?.reason).toBe('감기');
    expect(dayOf(result, '2026-09-28').dayNumber).toBe(28);
  });

  it('실제 급여로 정정된 식단은 정정된 구성을 보이고 수정 표시가 붙는다', () => {
    const result = board({
      meals: [
        ...plainMeals(26, 26),
        meal({ order: 27, toppings: ['beef'], consumed: true, actual: { menuId: PORRIDGE.id, toppings: ['pea'] } }),
      ],
    });

    const today = morningOf(result, TODAY).meal!;
    expect(today.corrected).toBe(true);
    expect(today.toppings.map((topping) => topping.name)).toEqual(['완두콩']);
  });

  it('메모와 메뉴 이름이 그대로 실린다', () => {
    const result = board({ meals: [...plainMeals(26, 26), meal({ order: 27, menuId: FLOUR_PORRIDGE.id, memo: '(+10g)' })] });

    expect(morningOf(result, TODAY).meal).toMatchObject({ menuName: '쌀밀가루죽', memo: '(+10g)' });
  });
});

describe('상태판의 회차', () => {
  it('앞으로의 식단에서 처음 나오는 재료는 ①, 그 다음은 ②, 두 번 뒤에는 표시가 없다', () => {
    const result = board({
      meals: [
        ...plainMeals(27, 27),
        meal({ order: 28, toppings: ['beef', 'pea'] }),
        meal({ order: 29, toppings: ['beef', 'pea'] }),
        meal({ order: 30, toppings: ['beef', 'pea'] }),
      ],
    });

    expect(toppingMarks(result, '2026-09-27')).toEqual([['소고기', null, false], ['완두콩', 1, false]]);
    expect(toppingMarks(result, '2026-09-28')).toEqual([['소고기', null, false], ['완두콩', 2, false]]);
    expect(toppingMarks(result, '2026-09-29')).toEqual([['소고기', null, false], ['완두콩', null, false]]);
  });

  it('창이 시작되기 전에 이상 없음으로 한 번 먹인 재료는 창 안에서 ②부터 시작한다', () => {
    // 2번 블록은 09-10부터다. 09-05(6일차)에 완두콩을 먹이고 이상 없음을 기록했다.
    const meals = plainMeals(35, 27).map((entry) =>
      entry.order === 6 ? meal({ order: 6, toppings: ['beef', 'pea'], consumed: true }) : entry,
    );
    const result = board({
      meals: [...meals.slice(0, 27), meal({ order: 28, toppings: ['pea'] })],
      reactions: [{ mealId: 'morning-6', ingredientId: 'pea', result: 'clear' }],
    });

    expect(toppingMarks(result, '2026-09-27')).toEqual([['완두콩', 2, false]]);
  });

  it('이미 먹였지만 기록이 없는 급여는 회차를 올리지 않는다', () => {
    // 09-25(26일차)에 완두콩을 먹였는데 반응을 기록하지 않았다. 다음 완두콩은 여전히 ①이다.
    const meals = plainMeals(35, 27).map((entry) =>
      entry.order === 26 ? meal({ order: 26, toppings: ['beef', 'pea'], consumed: true }) : entry,
    );
    const result = board({ meals: [...meals.slice(0, 27), meal({ order: 28, toppings: ['pea'] })] });

    expect(toppingMarks(result, '2026-09-25')).toEqual([['소고기', null, false], ['완두콩', 1, false]]);
    expect(toppingMarks(result, '2026-09-27')).toEqual([['완두콩', 1, false]]);
  });

  it('반응있음 재료가 예정 식단에 남아 있으면 표시되고, 이미 먹인 식단에는 표시되지 않는다', () => {
    const meals = plainMeals(35, 27).map((entry) =>
      entry.order === 26 ? meal({ order: 26, toppings: ['egg'], consumed: true }) : entry,
    );
    const result = board({
      meals: [...meals.slice(0, 27), meal({ order: 28, toppings: ['egg'] })],
      reactions: [{ mealId: 'morning-26', ingredientId: 'egg', result: 'reacted' }],
    });

    expect(toppingMarks(result, '2026-09-25')).toEqual([['계란', 1, false]]);
    expect(toppingMarks(result, '2026-09-27')).toEqual([['계란', null, true]]);
  });

  it('베이스 메뉴의 구성 재료도 관찰 대상이면 베이스에 표시된다', () => {
    // 쌀은 검증완료라 빠지고, 밀가루만 ①로 남는다.
    const result = board({ meals: [...plainMeals(27, 27), meal({ order: 28, menuId: FLOUR_PORRIDGE.id })] });

    expect(morningOf(result, '2026-09-27').meal?.watchedBaseIngredients).toEqual([
      { ingredientId: 'flour', name: '밀가루', exposureNumber: 1, reacted: false },
    ]);
    expect(morningOf(result, TODAY).meal?.watchedBaseIngredients).toEqual([]);
  });
});
