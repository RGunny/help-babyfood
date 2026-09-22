import { Client } from '@modelcontextprotocol/client';
import { localDate } from '../../src/domain/shared/local-date.js';
import { localTime } from '../../src/domain/shared/local-time.js';
import {
  Household,
  MutableClock,
  TestServices,
  at,
  buildServices,
  seedHousehold,
} from './setup/fixtures.js';
import { McpTestServer, connectClient, issueToken, startMcpServer, textOf } from './setup/mcp-server.js';

const TODAY = '2026-09-22';

let server: McpTestServer;
let services: TestServices;
let clock: MutableClock;
let client: Client;
let household: Household;

const WEIGHTS: Record<string, number> = { 쌀: 30, 오트밀: 10, 소고기: 10, 브로콜리: 15, 애호박: 15 };

async function receive(name: string, cubes: number, cookedOn = '2026-09-15'): Promise<string> {
  const batch = await services.stock.registerCookedBatch({
    householdId: household.id,
    actor: household.actor,
    ingredientName: name,
    cubeWeightGram: WEIGHTS[name],
    cookedOn: localDate(cookedOn),
    cubes,
  });
  return batch.id;
}

async function brief(): Promise<any> {
  const result = await client.callTool({ name: 'get_daily_brief', arguments: {} });
  if ((result as { isError?: boolean }).isError === true) {
    throw new Error(`브리프 도구가 오류를 돌려줬습니다: ${textOf(result)}`);
  }
  return JSON.parse(textOf(result));
}

/** Ingredient names of a brief section, sorted so that the assertion does not depend on id order. */
const names = (rows: { ingredientName: string }[]): string[] =>
  rows.map((row) => row.ingredientName).sort();

/** What the brief must not touch: the ledger and the meal statuses. */
async function ledgerSnapshot(): Promise<{ entries: number; statuses: string[] }> {
  const entries = await services.prisma.stockLedgerEntry.count({ where: { householdId: household.id } });
  const meals = await services.prisma.meal.findMany({
    where: { householdId: household.id },
    orderBy: { mealOrder: 'asc' },
    select: { status: true },
  });
  return { entries, statuses: meals.map((meal) => meal.status) };
}

beforeAll(async () => {
  clock = new MutableClock(at(TODAY, '09:00'));
  server = await startMcpServer(clock);
  services = buildServices(at(TODAY, '09:00'));
});

afterAll(async () => {
  await server.close();
  await services.prisma.$disconnect();
});

beforeEach(async () => {
  clock.set(TODAY, '09:00');
  services.clock.set(TODAY, '09:00');
  // 오늘이 이 끼니의 1일차다. 식단 다섯 개가 오늘부터 하루씩 놓인다.
  household = await seedHousehold(services, { mealCount: 5, slotStartDate: TODAY, mealTime: '10:00' });
  const { token } = await issueToken(services.prisma, household);
  client = await connectClient(server.url, token);
  // 브로콜리는 일부러 입고하지 않는다. 부족 예측과 보류된 차감이 여기서 나온다.
  await receive('쌀', 10);
  await receive('오트밀', 10);
  await receive('소고기', 10);
});

afterEach(async () => {
  await client.close();
});

describe('데일리 브리프 도구', () => {
  it('오늘 날짜와 일차, 끼니별 식단을 돌려준다', async () => {
    const today = await brief();

    expect(today).toMatchObject({ date: TODAY, dayNumber: 1 });
    expect(today.slots).toMatchObject([
      {
        slot: 'morning',
        mealTime: '10:00',
        meal: { menuName: '쌀오트밀죽', toppingNames: ['소고기', '브로콜리'], fed: false },
        noFeed: null,
      },
    ]);
  });

  it('오늘 식단의 재료를 회차와 함께 새 재료로 알린다', async () => {
    const today = await brief();

    // 메뉴 구성의 순서는 재료 id가 정하므로 이름만 집합으로 비교한다.
    expect(names(today.newIngredients)).toEqual(['브로콜리', '소고기', '쌀', '오트밀']);
    expect(today.newIngredients.every((entry: any) => entry.exposureNumber === 1)).toBe(true);
    expect(today.newIngredients.every((entry: any) => entry.slot === 'morning')).toBe(true);
  });

  it('재고현황과 부족 예측, 임계개수와 임계일 알람을 함께 준다', async () => {
    // 9/8에 만든 큐브의 임계일은 9/22, 바로 오늘이다.
    await receive('소고기', 2, '2026-09-08');
    await services.alertSettings.update({
      householdId: household.id,
      actor: household.actor,
      briefTime: localTime('07:30'),
      shelfLifeDays: 14,
      thresholds: [{ ingredientName: '브로콜리', thresholdCubes: 3 }],
    });

    const today = await brief();

    expect(today.stock).toHaveLength(5);
    expect(today.stock.find((row: any) => row.ingredientName === '소고기')).toMatchObject({
      total: 12,
      fresh: 12,
      pendingDiscard: 0,
    });
    expect(today.shortages).toMatchObject([
      { ingredientName: '브로콜리', firstShortageDate: TODAY, shortfallCubes: 5, plannedCubes: 5 },
    ]);
    expect(today.thresholdAlerts).toMatchObject([{ ingredientName: '브로콜리', total: 0, thresholdCubes: 3 }]);
    expect(today.expiryAlerts).toMatchObject([
      { ingredientName: '소고기', cookedOn: '2026-09-08', expiryDate: TODAY, remaining: 2, expiry: { kind: 'due_today' } },
    ]);
  });

  it('식단시간이 지나면 재고가 없는 재료의 차감이 확인 필요에 오른다', async () => {
    clock.set(TODAY, '12:00');

    const today = await brief();

    expect(today.needsAttention.heldDeductions).toMatchObject([
      { ingredientName: '브로콜리', cubes: 1, date: TODAY, slot: 'morning' },
    ]);
  });

  it('브리프를 불러도 원장과 식단 상태는 바뀌지 않는다', async () => {
    // 식단시간이 지난 상태다. 정합화가 돌면 차감이 일어나는데, 읽기 도구는 그것을 하지 않는다.
    clock.set(TODAY, '12:00');
    const before = await ledgerSnapshot();

    await brief();
    await brief();

    expect(await ledgerSnapshot()).toEqual(before);
    expect(before.statuses).toEqual(['planned', 'planned', 'planned', 'planned', 'planned']);
  });

  it('정합화가 돈 뒤에는 급여 완료로 보이고 반응 미기록이 올라온다', async () => {
    clock.set(TODAY, '12:00');
    services.clock.set(TODAY, '12:00');
    await services.reconcile.runEveryHousehold();

    const today = await brief();

    expect(today.slots[0].meal).toMatchObject({ fed: true });
    expect(names(today.needsAttention.unrecordedReactions)).toEqual([
      '브로콜리',
      '소고기',
      '쌀',
      '오트밀',
    ]);
    // 보류된 차감은 입고가 들어올 때까지 남는다.
    expect(today.needsAttention.heldDeductions).toMatchObject([{ ingredientName: '브로콜리' }]);
  });

  it('반응을 기록한 재료는 미기록에서 빠지고 회차가 올라간다', async () => {
    clock.set(TODAY, '12:00');
    services.clock.set(TODAY, '12:00');
    await services.reconcile.runEveryHousehold();
    await services.reaction.record({
      householdId: household.id,
      actor: household.actor,
      date: localDate(TODAY),
      slot: 'morning',
      ingredientName: '소고기',
      result: 'clear',
      symptomMemo: null,
    });

    const today = await brief();

    expect(names(today.needsAttention.unrecordedReactions)).toEqual(['브로콜리', '쌀', '오트밀']);
    expect(today.newIngredients.find((entry: any) => entry.ingredientName === '소고기')).toMatchObject({
      exposureNumber: 2,
    });
  });

  it('식단 잔여 일수를 알려 준다', async () => {
    const today = await brief();

    // 다섯 번째 식단이 9/26이다.
    expect(today.needsAttention).toMatchObject({ planRunwayDays: 4, planRunwayShort: true });
  });
});
