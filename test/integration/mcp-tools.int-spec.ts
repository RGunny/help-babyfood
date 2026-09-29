import { Client } from '@modelcontextprotocol/client';
import { MutableClock, at, buildServices, seedHouseholdOnly, TestServices } from './setup/fixtures.js';
import { McpTestServer, connectClient, issueToken, startMcpServer, textOf } from './setup/mcp-server.js';

let server: McpTestServer;
let services: TestServices;
let clock: MutableClock;
let client: Client;
let household: { id: string; memberId: string };

/** 7장의 도구와 3단계에서 더한 것들. 이름이 바뀌면 부모의 MCP 설정이 조용히 깨진다. */
const EXPECTED_TOOLS = [
  'register_cooked_batch',
  'get_stock_status',
  'adjust_stock_by_count',
  'discard_batch',
  'import_meal_plan',
  'get_meal_plan',
  'update_planned_meal',
  'update_meal_actual_items',
  'start_meal_slot',
  'register_no_feed',
  'cancel_no_feed',
  'get_meal_planning_rules',
  'update_meal_planning_rules',
  'record_feeding_reaction',
  'get_ingredient_introduction_status',
  'get_daily_brief',
  'forecast_shortage',
  'get_alert_settings',
  'update_alert_settings',
  'register_ingredient',
  'add_ingredient_alias',
  'update_ingredient_serving_weight',
  'register_menu',
  'update_menu',
  'get_menus',
];

let keyCounter = 0;
const nextKey = () => `key-${(keyCounter += 1)}`;

/** Calls a tool and parses the JSON body, failing loudly when the tool reported an error. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = await client.callTool({ name, arguments: { ...args } });
  if ((result as { isError?: boolean }).isError === true) {
    throw new Error(`도구가 오류를 돌려줬습니다: ${name} -> ${textOf(result)}`);
  }
  return JSON.parse(textOf(result));
}

/** Calls a tool expecting it to fail, and returns the structured error. */
async function callExpectingError(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ code: string; message: string }> {
  const result = await client.callTool({ name, arguments: { ...args } });
  expect((result as { isError?: boolean }).isError).toBe(true);
  return (result as { structuredContent: { code: string; message: string } }).structuredContent;
}

beforeAll(async () => {
  clock = new MutableClock(at('2026-09-22', '09:00'));
  server = await startMcpServer(clock);
  services = buildServices(at('2026-09-22', '09:00'));
});

afterAll(async () => {
  await server.close();
  await services.prisma.$disconnect();
});

beforeEach(async () => {
  clock.set('2026-09-22', '09:00');
  keyCounter = 0;
  household = await seedHouseholdOnly(services.prisma);
  const { token } = await issueToken(services.prisma, household);
  client = await connectClient(server.url, token);
});

afterEach(async () => {
  await client.close();
});

/** The masters every other scenario needs, built through the tools themselves. */
async function seedMasters(): Promise<void> {
  for (const [name, category, gram] of [
    ['쌀', 'base', 30],
    ['오트밀', 'base', 10],
    ['소고기', 'meat', 10],
    ['브로콜리', 'vegetable', 15],
    ['애호박', 'vegetable', 15],
  ] as const) {
    await call('register_ingredient', {
      idempotencyKey: nextKey(),
      name,
      category,
      servingWeightGram: gram,
    });
  }
  await call('register_menu', {
    idempotencyKey: nextKey(),
    name: '쌀오트밀죽',
    components: [
      { ingredientName: '쌀', cubes: 1 },
      { ingredientName: '오트밀', cubes: 1 },
    ],
  });
  await call('start_meal_slot', {
    idempotencyKey: nextKey(),
    slot: 'morning',
    startDate: '2026-09-22',
    mealTime: '10:00',
  });
}

const rows = (count: number) =>
  Array.from({ length: count }, () => ({
    composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['소고기'] },
  }));

describe('도구 목록', () => {
  it('7장의 도구가 전부 나온다', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('재고와 식단을 바꾸는 도구는 모두 멱등키를 받는다', async () => {
    const { tools } = await client.listTools();
    const mutating = tools.filter((tool) => !tool.name.startsWith('get_') && tool.name !== 'forecast_shortage');

    for (const tool of mutating) {
      const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      expect(Object.keys(properties), `${tool.name}에 멱등키가 없습니다`).toContain('idempotencyKey');
    }
  });

  it('어느 도구도 가정이나 구성원을 인자로 받지 않는다', async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      const properties = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      expect(properties, tool.name).not.toContain('householdId');
      expect(properties, tool.name).not.toContain('memberId');
      expect(properties, tool.name).not.toContain('actor');
    }
  });
});

describe('재료와 메뉴', () => {
  it('등록한 재료가 도입 상태 조회에 나온다', async () => {
    await call('register_ingredient', {
      idempotencyKey: nextKey(),
      name: '브로콜리',
      aliases: ['브로컬리'],
      category: 'vegetable',
      servingWeightGram: 15,
    });

    const statuses = await call('get_ingredient_introduction_status');
    expect(statuses).toEqual([{ ingredientName: '브로콜리', status: { kind: 'not_introduced' } }]);
  });

  it('별칭으로 가리켜도 같은 재료다', async () => {
    await seedMasters();
    await call('add_ingredient_alias', { idempotencyKey: nextKey(), name: '브로콜리', alias: '브로컬리' });

    await call('register_cooked_batch', {
      idempotencyKey: nextKey(),
      ingredientName: '브로컬리',
      cubeWeightGram: 15,
      cookedOn: '2026-09-21',
      cubes: 4,
    });

    const status = await call('get_stock_status');
    const broccoli = status.ingredients.find((row: any) => row.ingredientName === '브로콜리');
    expect(broccoli.total).toBe(4);
  });

  it('등록되지 않은 재료명은 도구 오류로 돌아온다', async () => {
    const error = await callExpectingError('register_cooked_batch', {
      idempotencyKey: nextKey(),
      ingredientName: '당근',
      cubeWeightGram: 15,
      cookedOn: '2026-09-21',
      cubes: 4,
    });

    expect(error.code).toBe('UNKNOWN_INGREDIENT');
    expect(error.message).toContain('당근');
  });

  it('메뉴 목록은 구성을 재료 이름으로 돌려준다', async () => {
    await seedMasters();

    expect(await call('get_menus')).toEqual([
      {
        name: '쌀오트밀죽',
        components: [
          { ingredientName: '쌀', cubes: 1 },
          { ingredientName: '오트밀', cubes: 1 },
        ],
      },
    ]);
  });

  it('1회분 중량을 바꾸면 옛 배치가 중량 불일치로 잡힌다', async () => {
    await seedMasters();
    await call('register_cooked_batch', {
      idempotencyKey: nextKey(),
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: '2026-09-20',
      cubes: 5,
    });

    await call('update_ingredient_serving_weight', {
      idempotencyKey: nextKey(),
      name: '소고기',
      servingWeightGram: 15,
    });

    const status = await call('get_stock_status');
    const beef = status.ingredients.find((row: any) => row.ingredientName === '소고기');
    expect([beef.total, beef.weightMismatched]).toEqual([5, 5]);
  });

  it('메뉴 구성을 바꾸면 그대로 반영된다', async () => {
    await seedMasters();
    await call('update_menu', {
      idempotencyKey: nextKey(),
      currentName: '쌀오트밀죽',
      name: '쌀죽',
      components: [{ ingredientName: '쌀', cubes: 2 }],
    });

    expect(await call('get_menus')).toEqual([
      { name: '쌀죽', components: [{ ingredientName: '쌀', cubes: 2 }] },
    ]);
  });
});

describe('재고', () => {
  beforeEach(seedMasters);

  it('입고하면 재고현황에 잡힌다', async () => {
    await call('register_cooked_batch', {
      idempotencyKey: nextKey(),
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: '2026-09-20',
      cubes: 8,
    });

    const status = await call('get_stock_status');
    const beef = status.ingredients.find((row: any) => row.ingredientName === '소고기');
    expect([beef.total, beef.fresh, beef.overdue]).toEqual([8, 8, 0]);
  });

  it('같은 멱등키로 두 번 부르면 배치가 하나다', async () => {
    const key = nextKey();
    const args = {
      idempotencyKey: key,
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: '2026-09-20',
      cubes: 8,
    };

    const first = await call('register_cooked_batch', args);
    const second = await call('register_cooked_batch', args);

    expect(second).toEqual(first);
    const status = await call('get_stock_status');
    expect(status.ingredients.find((row: any) => row.ingredientName === '소고기').total).toBe(8);
  });

  it('같은 멱등키에 다른 본문이 오면 거부한다', async () => {
    const key = nextKey();
    await call('register_cooked_batch', {
      idempotencyKey: key,
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: '2026-09-20',
      cubes: 8,
    });

    const error = await callExpectingError('register_cooked_batch', {
      idempotencyKey: key,
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: '2026-09-20',
      cubes: 99,
    });

    expect(error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('실사 조정으로 수량을 맞춘다', async () => {
    const batch = await call('register_cooked_batch', {
      idempotencyKey: nextKey(),
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: '2026-09-20',
      cubes: 8,
    });

    await call('adjust_stock_by_count', {
      idempotencyKey: nextKey(),
      batchId: batch.batchId,
      countedCubes: 5,
      reason: '하나 떨어뜨림',
    });

    const status = await call('get_stock_status');
    expect(status.ingredients.find((row: any) => row.ingredientName === '소고기').total).toBe(5);
  });

  it('폐기하면 재고에서 빠진다', async () => {
    const batch = await call('register_cooked_batch', {
      idempotencyKey: nextKey(),
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: '2026-09-20',
      cubes: 8,
    });

    await call('discard_batch', { idempotencyKey: nextKey(), batchId: batch.batchId, reason: 'expired' });

    const status = await call('get_stock_status');
    expect(status.ingredients.find((row: any) => row.ingredientName === '소고기').total).toBe(0);
  });

  it('임계일이 지난 배치는 임계 지남으로 알리되 재고에는 남는다', async () => {
    await call('register_cooked_batch', {
      idempotencyKey: nextKey(),
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: '2026-09-01',
      cubes: 3,
    });

    const status = await call('get_stock_status');
    const beef = status.ingredients.find((row: any) => row.ingredientName === '소고기');
    expect([beef.total, beef.overdue]).toEqual([3, 3]);
    expect(status.expiryAlerts).toHaveLength(1);
    expect(status.expiryAlerts[0].ingredientName).toBe('소고기');
  });
});

describe('식단', () => {
  beforeEach(seedMasters);

  it('가져오기 미리보기는 날짜를 붙여 주고 아무것도 쓰지 않는다', async () => {
    const preview = await call('import_meal_plan', {
      idempotencyKey: nextKey(),
      dryRun: true,
      slot: 'morning',
      meals: rows(3),
      fedThrough: null,
    });

    expect(preview.dryRun).toBe(true);
    expect(preview.meals.map((meal: any) => meal.date)).toEqual([
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
    ]);

    const plan = await call('get_meal_plan', { from: '2026-09-22', to: '2026-09-24' });
    expect(plan.days.every((day: any) => day.slots[0].meal === null)).toBe(true);
  });

  it('미리보기도 제약 위반을 경고로 알린다', async () => {
    await call('update_meal_planning_rules', {
      idempotencyKey: nextKey(),
      forbiddenPairings: [{ ingredientNames: ['소고기', '애호박'], scope: 'same_meal' }],
      maxFirstIntroductionsPerDay: null,
      firstIntroductionSlot: null,
      textGuidance: null,
    });

    const preview = await call('import_meal_plan', {
      idempotencyKey: nextKey(),
      dryRun: true,
      slot: 'morning',
      meals: [
        { composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['소고기', '애호박'] } },
      ],
      fedThrough: null,
    });

    expect(preview.warnings.map((warning: any) => warning.code)).toContain('FORBIDDEN_PAIRING');
    expect(preview.warnings[0].ingredientNames.sort()).toEqual(['소고기', '애호박']);
  });

  it('식단시간 형식이 아니면 끼니를 열 수 없다', async () => {
    const result = await client.callTool({
      name: 'start_meal_slot',
      arguments: {
        idempotencyKey: nextKey(),
        slot: 'afternoon',
        startDate: '2026-09-22',
        mealTime: '25:00',
      },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
  });

  it('확정하면 달력에 이름으로 나온다', async () => {
    await call('import_meal_plan', {
      idempotencyKey: nextKey(),
      dryRun: false,
      slot: 'morning',
      meals: rows(2),
      fedThrough: null,
    });

    const plan = await call('get_meal_plan', { from: '2026-09-22', to: '2026-09-23' });
    expect(plan.days[0].slots[0].meal.planned).toEqual({
      baseMenuName: '쌀오트밀죽',
      toppingIngredientNames: ['소고기'],
    });
    expect(plan.days.map((day: any) => day.dayNumber)).toEqual([1, 2]);
  });

  it('이관한 식단은 급여 완료이고 재고를 건드리지 않는다', async () => {
    await call('register_cooked_batch', {
      idempotencyKey: nextKey(),
      ingredientName: '쌀',
      cubeWeightGram: 30,
      cookedOn: '2026-09-20',
      cubes: 10,
    });
    await call('start_meal_slot', {
      idempotencyKey: nextKey(),
      slot: 'afternoon',
      startDate: '2026-09-18',
      mealTime: '17:00',
    });

    await call('import_meal_plan', {
      idempotencyKey: nextKey(),
      dryRun: false,
      slot: 'afternoon',
      meals: rows(3),
      fedThrough: '2026-09-19',
    });

    const plan = await call('get_meal_plan', { from: '2026-09-18', to: '2026-09-20' });
    const afternoons = plan.days.map(
      (day: any) => day.slots.find((entry: any) => entry.slot === 'afternoon').meal,
    );
    expect(afternoons.map((meal: any) => [meal.status, meal.migrated])).toEqual([
      ['consumed', true],
      ['consumed', true],
      ['planned', false],
    ]);
    const status = await call('get_stock_status');
    expect(status.ingredients.find((row: any) => row.ingredientName === '쌀').total).toBe(10);
  });

  it('계획을 바꾸면 달력에 반영된다', async () => {
    await call('import_meal_plan', {
      idempotencyKey: nextKey(),
      dryRun: false,
      slot: 'morning',
      meals: rows(2),
      fedThrough: null,
    });

    await call('update_planned_meal', {
      idempotencyKey: nextKey(),
      date: '2026-09-23',
      slot: 'morning',
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['애호박'] },
      memo: '(소량)',
    });

    const plan = await call('get_meal_plan', { from: '2026-09-23', to: '2026-09-23' });
    expect(plan.days[0].slots[0].meal.planned.toppingIngredientNames).toEqual(['애호박']);
    expect(plan.days[0].slots[0].meal.memo).toBe('(소량)');
  });

  it('식단이 없는 날짜를 고치려 하면 도구 오류로 돌아온다', async () => {
    const error = await callExpectingError('update_planned_meal', {
      idempotencyKey: nextKey(),
      date: '2026-09-30',
      slot: 'morning',
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: [] },
    });

    expect(error.code).toBe('SLOT_NOT_SCHEDULED');
  });

  it('제약 위반은 막지 않고 경고로 알린다', async () => {
    await call('update_meal_planning_rules', {
      idempotencyKey: nextKey(),
      forbiddenPairings: [{ ingredientNames: ['소고기', '애호박'], scope: 'same_meal' }],
      maxFirstIntroductionsPerDay: 1,
      firstIntroductionSlot: 'morning',
      textGuidance: '새 재료는 주말에 피한다',
    });

    await call('import_meal_plan', {
      idempotencyKey: nextKey(),
      dryRun: false,
      slot: 'morning',
      meals: [
        { composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['소고기', '애호박'] } },
      ],
      fedThrough: null,
    });

    const plan = await call('get_meal_plan', { from: '2026-09-22', to: '2026-09-22' });
    const codes = plan.warnings.map((warning: any) => warning.code);
    expect(codes).toContain('FORBIDDEN_PAIRING');
    expect(plan.warnings.find((w: any) => w.code === 'FORBIDDEN_PAIRING').ingredientNames.sort()).toEqual(
      ['소고기', '애호박'],
    );
  });

  it('규칙 조회는 이름으로 돌려준다', async () => {
    await call('update_meal_planning_rules', {
      idempotencyKey: nextKey(),
      forbiddenPairings: [{ ingredientNames: ['소고기', '애호박'], scope: 'same_day' }],
      maxFirstIntroductionsPerDay: 1,
      firstIntroductionSlot: 'morning',
      textGuidance: '가이드',
    });

    const rules = await call('get_meal_planning_rules');
    expect(rules.forbiddenPairings[0].ingredientNames.sort()).toEqual(['소고기', '애호박']);
    expect(rules.textGuidance).toBe('가이드');
  });
});

describe('자동 차감과 미급여', () => {
  beforeEach(async () => {
    await seedMasters();
    for (const [name, gram] of [
      ['쌀', 30],
      ['오트밀', 10],
      ['소고기', 10],
    ] as const) {
      await call('register_cooked_batch', {
        idempotencyKey: nextKey(),
        ingredientName: name,
        cubeWeightGram: gram,
        cookedOn: '2026-09-20',
        cubes: 10,
      });
    }
    await call('import_meal_plan', {
      idempotencyKey: nextKey(),
      dryRun: false,
      slot: 'morning',
      meals: rows(4),
      fedThrough: null,
    });
  });

  it('미급여를 등록하면 그날은 비고 이후가 밀린다', async () => {
    await call('register_no_feed', {
      idempotencyKey: nextKey(),
      date: '2026-09-22',
      slot: 'morning',
      thawed: false,
      reason: '감기',
    });

    const plan = await call('get_meal_plan', { from: '2026-09-22', to: '2026-09-23' });
    expect(plan.days[0].slots[0].meal).toBeNull();
    expect(plan.days[0].slots[0].noFeed.reason).toBe('감기');
    expect(plan.days[0].dayNumber).toBeNull();
    expect(plan.days[1].slots[0].meal.planned.toppingIngredientNames).toEqual(['소고기']);
  });

  it('전체를 지정하면 그 날짜에 열려 있는 끼니를 모두 등록한다', async () => {
    await call('start_meal_slot', {
      idempotencyKey: nextKey(),
      slot: 'afternoon',
      startDate: '2026-09-22',
      mealTime: '17:00',
    });

    const report = await call('register_no_feed', {
      idempotencyKey: nextKey(),
      date: '2026-09-22',
      slot: 'all',
      thawed: false,
      reason: '여행',
    });

    expect(report.slots.map((entry: any) => entry.slot).sort()).toEqual(['afternoon', 'morning']);
    const rowsInDb = await services.prisma.noFeedRecord.count({ where: { householdId: household.id } });
    expect(rowsInDb).toBe(2);
  });

  it('해동 후 미급여는 그 날짜 식단의 큐브를 폐기로 기록한다', async () => {
    clock.set('2026-09-22', '11:00');
    // 식단시간이 지나 차감이 일어난 뒤에 등록해야 해동 폐기가 생긴다.
    await call('update_planned_meal', {
      idempotencyKey: nextKey(),
      date: '2026-09-22',
      slot: 'morning',
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['소고기'] },
    });
    const before = await call('get_stock_status');
    const beefBefore = before.ingredients.find((row: any) => row.ingredientName === '소고기').total;

    const report = await call('register_no_feed', {
      idempotencyKey: nextKey(),
      date: '2026-09-22',
      slot: 'morning',
      thawed: true,
      reason: '해동해 뒀는데 안 먹음',
    });

    expect(report.slots[0].undiscardable).toEqual([]);
    const after = await call('get_stock_status');
    const beefAfter = after.ingredients.find((row: any) => row.ingredientName === '소고기').total;
    // 소비가 취소되어 돌아온 뒤 같은 수량이 폐기되므로 합계는 그대로다.
    expect(beefAfter).toBe(beefBefore);
    const discards = await services.prisma.stockLedgerEntry.count({
      where: { householdId: household.id, type: 'discarded' },
    });
    expect(discards).toBeGreaterThan(0);
  });

  it('실제 급여 내용을 고치면 차감이 따라 바뀐다', async () => {
    clock.set('2026-09-22', '11:00');
    await call('update_planned_meal', {
      idempotencyKey: nextKey(),
      date: '2026-09-22',
      slot: 'morning',
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['소고기'] },
    });

    await call('update_meal_actual_items', {
      idempotencyKey: nextKey(),
      date: '2026-09-22',
      slot: 'morning',
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['애호박'] },
    });

    const plan = await call('get_meal_plan', { from: '2026-09-22', to: '2026-09-22' });
    expect(plan.days[0].slots[0].meal.actual.toppingIngredientNames).toEqual(['애호박']);
    const status = await call('get_stock_status');
    expect(status.ingredients.find((row: any) => row.ingredientName === '소고기').total).toBe(10);
  });

  it('실제 급여 내용을 지우면 계획대로 돌아간다', async () => {
    clock.set('2026-09-22', '11:00');
    await call('update_meal_actual_items', {
      idempotencyKey: nextKey(),
      date: '2026-09-22',
      slot: 'morning',
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['애호박'] },
    });

    await call('update_meal_actual_items', {
      idempotencyKey: nextKey(),
      date: '2026-09-22',
      slot: 'morning',
      composition: null,
    });

    const plan = await call('get_meal_plan', { from: '2026-09-22', to: '2026-09-22' });
    expect(plan.days[0].slots[0].meal.actual).toBeNull();
    const status = await call('get_stock_status');
    expect(status.ingredients.find((row: any) => row.ingredientName === '소고기').total).toBe(9);
  });

  it('미급여를 취소하면 날짜가 당겨진다', async () => {
    const key = nextKey();
    await call('register_no_feed', {
      idempotencyKey: key,
      date: '2026-09-22',
      slot: 'morning',
      thawed: false,
      reason: null,
    });

    await call('cancel_no_feed', { idempotencyKey: nextKey(), date: '2026-09-22', slot: 'morning' });

    const plan = await call('get_meal_plan', { from: '2026-09-22', to: '2026-09-22' });
    expect(plan.days[0].slots[0].meal).not.toBeNull();
    expect(plan.days[0].dayNumber).toBe(1);
  });

  it('식단시간이 지난 뒤 반응을 기록하면 도입 상태가 올라간다', async () => {
    clock.set('2026-09-22', '11:00');
    // 정합화는 스케줄러의 몫이지만(4단계), 쓰기 도구가 같은 트랜잭션에서 돌린다.
    await call('update_planned_meal', {
      idempotencyKey: nextKey(),
      date: '2026-09-22',
      slot: 'morning',
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['소고기'] },
    });

    await call('record_feeding_reaction', {
      idempotencyKey: nextKey(),
      date: '2026-09-22',
      slot: 'morning',
      ingredientName: '소고기',
      result: 'clear',
    });

    const statuses = await call('get_ingredient_introduction_status');
    const beef = statuses.find((row: any) => row.ingredientName === '소고기');
    expect(beef.status).toEqual({ kind: 'verifying', clearCount: 1, unrecordedCount: 0 });
  });

  it('아직 먹이지 않은 식단에는 반응을 기록할 수 없다', async () => {
    const error = await callExpectingError('record_feeding_reaction', {
      idempotencyKey: nextKey(),
      date: '2026-09-22',
      slot: 'morning',
      ingredientName: '소고기',
      result: 'clear',
    });

    expect(error.code).toBe('MEAL_NOT_FED');
  });
});

describe('예측과 알람 설정', () => {
  beforeEach(seedMasters);

  it('식단을 재고에 대입해 부족해지는 날짜를 알려 준다', async () => {
    await call('register_cooked_batch', {
      idempotencyKey: nextKey(),
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: '2026-09-20',
      cubes: 2,
    });
    await call('import_meal_plan', {
      idempotencyKey: nextKey(),
      dryRun: false,
      slot: 'morning',
      meals: rows(4),
      fedThrough: null,
    });

    const forecast = await call('forecast_shortage', { until: null });
    const beef = forecast.find((row: any) => row.ingredientName === '소고기');
    expect(beef.plannedCubes).toBe(4);
    expect(beef.shortfallCubes).toBe(2);
    expect(beef.firstShortageDate).toBe('2026-09-24');
  });

  it('알람 설정은 읽은 모양 그대로 다시 쓸 수 있다', async () => {
    await call('update_alert_settings', {
      idempotencyKey: nextKey(),
      briefTime: '07:30',
      shelfLifeDays: 14,
      thresholds: [{ ingredientName: '소고기', thresholdCubes: 3 }],
    });

    const settings = await call('get_alert_settings');
    expect(settings).toEqual({
      briefTime: '07:30',
      shelfLifeDays: 14,
      thresholds: [{ ingredientName: '소고기', thresholdCubes: 3 }],
    });
  });

  it('임계일을 줄이면 재고현황의 임계 지남 판정이 따라 바뀐다', async () => {
    await call('register_cooked_batch', {
      idempotencyKey: nextKey(),
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: '2026-09-15',
      cubes: 4,
    });
    expect(
      (await call('get_stock_status')).ingredients.find((row: any) => row.ingredientName === '소고기')
        .overdue,
    ).toBe(0);

    await call('update_alert_settings', {
      idempotencyKey: nextKey(),
      briefTime: '07:30',
      shelfLifeDays: 3,
      thresholds: [],
    });

    expect(
      (await call('get_stock_status')).ingredients.find((row: any) => row.ingredientName === '소고기')
        .overdue,
    ).toBe(4);
  });
});

describe('입력 검증', () => {
  it('날짜 형식이 아니면 호출이 거부된다', async () => {
    await seedMasters();
    const result = await client.callTool({
      name: 'register_cooked_batch',
      arguments: {
        idempotencyKey: nextKey(),
        ingredientName: '소고기',
        cubeWeightGram: 10,
        cookedOn: '2026/09/20',
        cubes: 4,
      },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
  });

  it('빈 멱등키는 거부된다', async () => {
    await seedMasters();
    const result = await client.callTool({
      name: 'register_cooked_batch',
      arguments: {
        idempotencyKey: '',
        ingredientName: '소고기',
        cubeWeightGram: 10,
        cookedOn: '2026-09-20',
        cubes: 4,
      },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
  });
});
