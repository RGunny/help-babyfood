import { BoardSyncClaim, BoardSyncDue } from '../../src/application/ports/board-sync-log.port.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { PrismaBoardSyncLog } from '../../src/infrastructure/prisma/board-sync-log.repository.js';
import { Household, TestServices, at, buildServices, seedHousehold, seedHouseholdOnly } from './setup/fixtures.js';

// 상태판 발행 기록과 판정 질의, 그리고 그 판정의 입력인 household.state_changed_at을 본다.
// 여기서 지키는 것은 "실제로 쓴 트랜잭션만 상태 시각을 올린다"와 "발행·건너뜀은 상태 시각을
// 전진시키고, 실패는 5분 뒤에야 다시 잡힌다"이다.

const TODAY = '2026-09-26';

let services: TestServices;
let log: PrismaBoardSyncLog;

beforeAll(() => {
  services = buildServices(at(TODAY, '09:00'));
  log = new PrismaBoardSyncLog(services.prisma);
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

/** 한 번의 쓸기가 보는 "지금". 기본 디바운스는 60초다. */
function due(time: string, overrides: Partial<BoardSyncDue> = {}): BoardSyncDue {
  return {
    today: localDate(TODAY),
    instant: new Date(`${TODAY}T${time}+09:00`),
    debounceSeconds: 60,
    ...overrides,
  };
}

const stateChangedAt = async (householdId: string): Promise<Date> =>
  (await services.prisma.household.findUniqueOrThrow({ where: { id: householdId } })).stateChangedAt;

const setStateChangedAt = async (householdId: string, at: Date): Promise<void> => {
  await services.prisma.household.update({ where: { id: householdId }, data: { stateChangedAt: at } });
};

const claimFor = async (householdId: string): Promise<BoardSyncClaim> => ({
  householdId,
  date: localDate(TODAY),
  stateChangedAt: await stateChangedAt(householdId),
  previousFailure: null,
});

/**
 * 가정 하나, 상태 시각은 09:00:00. 기본값 now()는 실제 벽시계라 테스트의 고정된 "지금"보다
 * 늦어질 수 있으므로 판정 테스트는 전부 이 값에서 시작한다.
 */
async function householdChangedAt(time = '09:00:00'): Promise<string> {
  const { id } = await seedHouseholdOnly(services.prisma);
  await setStateChangedAt(id, new Date(`${TODAY}T${time}+09:00`));
  return id;
}

const WEIGHTS: Record<string, number> = { 쌀: 30, 오트밀: 10, 소고기: 10, 브로콜리: 15, 애호박: 15 };

async function stockAll(house: Household, cubes: number): Promise<void> {
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: name,
      cubeWeightGram: weight,
      cookedOn: localDate('2026-09-20'),
      cubes,
    });
  }
}

describe('가정의 상태 시각', () => {
  it('입고를 등록하면 그 트랜잭션의 시각으로 올라간다', async () => {
    const house = await seedHousehold(services, { mealCount: 1, slotStartDate: TODAY });
    services.clock.set(TODAY, '09:10');

    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: localDate(TODAY),
      cubes: 3,
    });

    expect(await stateChangedAt(house.id)).toEqual(services.clock.instant());
  });

  it('차이가 없는 정합화는 올리지 않는다', async () => {
    const house = await seedHousehold(services, { mealCount: 2, slotStartDate: TODAY });
    await stockAll(house, 5);
    const before = await stateChangedAt(house.id);
    services.clock.set(TODAY, '09:30');

    // 식단시간(10:00) 전이라 바꿀 것이 없다.
    await services.reconcile.run(house.id);

    expect(await stateChangedAt(house.id)).toEqual(before);
  });

  it('차감이 일어난 정합화는 올린다', async () => {
    const house = await seedHousehold(services, { mealCount: 2, slotStartDate: TODAY });
    await stockAll(house, 5);
    services.clock.set(TODAY, '10:01');

    await services.reconcile.run(house.id);

    expect(await stateChangedAt(house.id)).toEqual(services.clock.instant());
  });

  it('행을 지우는 쓰기(미급여 취소, 임계개수 통째 교체)도 올린다', async () => {
    const house = await seedHousehold(services, { mealCount: 3, slotStartDate: TODAY });
    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-09-27'),
      slot: 'morning',
      thawed: false,
      reason: null,
    });
    services.clock.set(TODAY, '09:20');

    await services.noFeed.cancel({ householdId: house.id, actor: house.actor, date: localDate('2026-09-27'), slot: 'morning' });
    expect(await stateChangedAt(house.id)).toEqual(services.clock.instant());

    services.clock.set(TODAY, '09:21');
    await services.alertSettings.update({
      householdId: house.id,
      actor: house.actor,
      briefTime: services.clock.now().time,
      shelfLifeDays: 14,
      thresholds: [],
    });
    expect(await stateChangedAt(house.id)).toEqual(services.clock.instant());
  });

  it('같은 멱등키의 재시도는 올리지 않는다', async () => {
    const house = await seedHousehold(services, { mealCount: 1, slotStartDate: TODAY });
    const command = {
      householdId: house.id,
      actor: house.actor,
      idempotencyKey: 'receive-beef-once',
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: localDate(TODAY),
      cubes: 3,
    };
    services.clock.set(TODAY, '09:10');
    await services.stock.registerCookedBatch(command);
    const first = await stateChangedAt(house.id);

    services.clock.set(TODAY, '09:15');
    await services.stock.registerCookedBatch(command);

    expect(await stateChangedAt(house.id)).toEqual(first);
  });
});

describe('상태판 판정', () => {
  it('한 번도 발행하지 않은 가정은 디바운스와 무관하게 바로 잡힌다', async () => {
    const id = await householdChangedAt();

    const claims = await log.claimDue(due('09:00:10'));

    expect(claims).toEqual([
      { householdId: id, date: localDate(TODAY), stateChangedAt: new Date(`${TODAY}T09:00:00+09:00`), previousFailure: null },
    ]);
  });

  it('발행하면 그 상태 시각까지 맞춘 것이 되어 다시 잡히지 않는다', async () => {
    const id = await householdChangedAt();
    const [claim] = await log.claimDue(due('09:00:10'));

    await log.recordPublished(claim, due('09:00:11').instant);

    expect(await log.claimDue(due('09:05:00'))).toEqual([]);
    expect(await services.prisma.boardPublication.findUniqueOrThrow({ where: { householdId: id } })).toMatchObject({
      status: 'published',
      syncedStateAt: claim.stateChangedAt,
      attempts: 0,
      nextAttemptAt: null,
      outcomeReason: null,
    });
  });

  it('상태가 바뀌면 60초가 지난 뒤에야 잡힌다', async () => {
    const id = await householdChangedAt();
    const [claim] = await log.claimDue(due('09:00:10'));
    await log.recordPublished(claim, due('09:00:11').instant);

    await setStateChangedAt(id, new Date(`${TODAY}T09:10:00+09:00`));

    expect(await log.claimDue(due('09:10:30'))).toEqual([]);
    expect(await log.claimDue(due('09:11:00'))).toMatchObject([{ householdId: id }]);
  });

  it('기록되는 상태 시각은 클레임이 읽은 값이라, 발행 중 들어온 변경은 다음에 다시 잡힌다', async () => {
    const id = await householdChangedAt();
    const [claim] = await log.claimDue(due('09:00:10'));
    // 발행이 진행되는 동안 누가 또 썼다.
    await setStateChangedAt(id, new Date(`${TODAY}T09:00:20+09:00`));

    await log.recordPublished(claim, due('09:00:30').instant);

    expect(await log.claimDue(due('09:02:00'))).toMatchObject([{ householdId: id }]);
  });

  it('날이 바뀌면 쓰기가 없어도 다시 잡힌다', async () => {
    const id = await householdChangedAt();
    const [claim] = await log.claimDue(due('09:00:10'));
    await log.recordPublished(claim, due('09:00:11').instant);

    const tomorrow = due('00:01:00', { today: localDate('2026-09-27'), instant: new Date('2026-09-27T00:01:00+09:00') });
    expect(await log.claimDue(tomorrow)).toMatchObject([{ householdId: id, date: localDate('2026-09-27') }]);
  });

  it('건너뛴 가정도 상태 시각이 전진해 매분 다시 잡히지 않는다', async () => {
    const id = await householdChangedAt();
    const [claim] = await log.claimDue(due('09:00:10'));

    await log.recordSkipped(claim, 'not_linked', due('09:00:11').instant);

    expect(await log.claimDue(due('09:05:00'))).toEqual([]);
    expect(await services.prisma.boardPublication.findUniqueOrThrow({ where: { householdId: id } })).toMatchObject({
      status: 'skipped',
      outcomeReason: 'not_linked',
    });
  });

  it('실패한 가정은 다음 시도 시각이 지나야 다시 잡히고, 그때 지난 사유가 실린다', async () => {
    const id = await householdChangedAt();
    const [claim] = await log.claimDue(due('09:00:10'));

    await log.recordFailed(claim, 'missing_scope', due('09:00:11').instant, new Date(`${TODAY}T09:05:11+09:00`));

    expect(await log.claimDue(due('09:03:00'))).toEqual([]);
    expect(await log.claimDue(due('09:05:11'))).toMatchObject([{ householdId: id, previousFailure: 'missing_scope' }]);
    expect(await services.prisma.boardPublication.findUniqueOrThrow({ where: { householdId: id } })).toMatchObject({
      status: 'failed',
      attempts: 1,
      syncedStateAt: null,
    });
  });

  it('실패가 이어지면 시도 횟수가 쌓이고, 성공하면 0으로 돌아온다', async () => {
    const id = await householdChangedAt();
    const claim = await claimFor(id);
    await log.recordFailed(claim, 'missing_scope', due('09:00:11').instant, new Date(`${TODAY}T09:05:11+09:00`));
    await log.recordFailed(claim, 'missing_scope', due('09:05:11').instant, new Date(`${TODAY}T09:10:11+09:00`));
    expect((await services.prisma.boardPublication.findUniqueOrThrow({ where: { householdId: id } })).attempts).toBe(2);

    await log.recordPublished(claim, due('09:10:12').instant);

    expect(await services.prisma.boardPublication.findUniqueOrThrow({ where: { householdId: id } })).toMatchObject({
      status: 'published',
      attempts: 0,
      nextAttemptAt: null,
    });
  });

  it('가정이 여럿이면 만든 순서대로 돌아온다', async () => {
    const first = await householdChangedAt();
    const second = await householdChangedAt();

    expect((await log.claimDue(due('09:00:10'))).map((claim) => claim.householdId)).toEqual([first, second]);
  });
});
