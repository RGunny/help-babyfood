import { localDate } from '../../src/domain/shared/local-date.js';
import { Household, TestServices, at, buildServices, seedHousehold } from './setup/fixtures.js';

// 적재 범위를 좁힌 것이 결과를 바꾸면 재고가 조용히 틀어진다. 좁은 윈도와 사실상 무한한
// 윈도를 같은 이력에 대고 비교한다.

const NARROW_LOOKBACK_DAYS = 5;
const WIDE_LOOKBACK_DAYS = 3650;

let narrow: TestServices;
let wide: TestServices;

beforeAll(() => {
  narrow = buildServices(at('2026-08-17', '10:00'), NARROW_LOOKBACK_DAYS);
  wide = buildServices(at('2026-08-17', '10:00'), WIDE_LOOKBACK_DAYS);
});

afterAll(async () => {
  await narrow.prisma.$disconnect();
  await wide.prisma.$disconnect();
});

const SERVING_WEIGHT: Record<string, number> = { 쌀: 30, 오트밀: 10, 소고기: 10, 브로콜리: 15, 애호박: 15 };

async function stockAll(services: TestServices, house: Household, cubes: number, cookedOn: string): Promise<void> {
  for (const [name, weight] of Object.entries(SERVING_WEIGHT)) {
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: name,
      cubeWeightGram: weight,
      cookedOn: localDate(cookedOn),
      cubes,
    });
  }
}

/** 재료별 잔여 수량과 식단 상태. 두 윈도가 같은 상태에 도달했는지 비교할 값이다. */
async function snapshot(services: TestServices, house: Household) {
  const batches = await services.prisma.cookedBatch.findMany({
    where: { householdId: house.id },
    select: { ingredientId: true, remainingCubes: true },
  });
  const remaining = new Map<string, number>();
  for (const batch of batches) {
    remaining.set(batch.ingredientId, (remaining.get(batch.ingredientId) ?? 0) + batch.remainingCubes);
  }
  const meals = await services.prisma.meal.findMany({
    where: { householdId: house.id },
    select: { mealOrder: true, status: true },
    orderBy: { mealOrder: 'asc' },
  });
  return {
    remaining: [...remaining.values()].sort((a, b) => a - b),
    statuses: meals.map((meal) => `${meal.mealOrder}:${meal.status}`),
  };
}

// 7/1 시작이면 8/17이 48일차다. 식단을 48개 두면 마지막 식단이 오늘 10:00에 걸려,
// 하루만 밀려도 예정으로 돌아간다. 소급 미급여가 실제로 결과를 바꾸는 배치다.
const longHistory = { mealCount: 48, slotStartDate: '2026-07-01' };

describe('좁은 윈도와 전체 적재', () => {
  it('오래된 이력을 한꺼번에 정합화해도 같은 결과에 도달한다', async () => {
    const one = await seedHousehold(narrow.prisma, longHistory);
    const two = await seedHousehold(wide.prisma, longHistory);
    await stockAll(narrow, one, 60, '2026-06-30');
    await stockAll(wide, two, 60, '2026-06-30');

    await narrow.reconcile.run(one.id);
    await wide.reconcile.run(two.id);

    expect(await snapshot(narrow, one)).toEqual(await snapshot(wide, two));
  });

  it('윈도보다 오래 멈춰 있던 뒤에도 예정 식단이 빠짐없이 차감된다', async () => {
    const house = await seedHousehold(narrow.prisma, longHistory);
    await stockAll(narrow, house, 60, '2026-06-30');

    // 7/1 시작, 8/17까지 48일. 식단은 40개뿐이라 전부 식단시간이 지났다.
    await narrow.reconcile.run(house.id);

    const planned = await narrow.prisma.meal.count({ where: { householdId: house.id, status: 'planned' } });
    expect(planned).toBe(0);
    const consumed = await narrow.prisma.stockLedgerEntry.count({
      where: { householdId: house.id, type: 'meal_consumed' },
    });
    expect(consumed).toBe(longHistory.mealCount * 4);
  });

  it('윈도보다 과거를 지목한 소급 미급여도 같은 결과를 낸다', async () => {
    const one = await seedHousehold(narrow.prisma, longHistory);
    const two = await seedHousehold(wide.prisma, longHistory);
    await stockAll(narrow, one, 60, '2026-06-30');
    await stockAll(wide, two, 60, '2026-06-30');
    await narrow.reconcile.run(one.id);
    await wide.reconcile.run(two.id);

    // 윈도(8/12 이후)보다 훨씬 과거다.
    for (const [services, house] of [
      [narrow, one],
      [wide, two],
    ] as const) {
      await services.noFeed.register({
        householdId: house.id,
        actor: house.actor,
        date: localDate('2026-07-05'),
        slot: 'morning',
        thawed: false,
        reason: '여행',
      });
    }

    expect(await snapshot(narrow, one)).toEqual(await snapshot(wide, two));
    // 하루가 밀렸으니 마지막 식단 하나가 예정으로 돌아간다.
    const planned = await narrow.prisma.meal.count({ where: { householdId: one.id, status: 'planned' } });
    expect(planned).toBe(1);
  });

  it('윈도 밖 소급 미급여가 해동 후였다면 그 날짜 식단의 큐브를 폐기한다', async () => {
    const house = await seedHousehold(narrow.prisma, longHistory);
    await stockAll(narrow, house, 60, '2026-06-30');
    await narrow.reconcile.run(house.id);

    // 7/5는 윈도(8/12 이후) 훨씬 밖이다. 그 날짜의 식단을 찾지 못하면 폐기가 통째로
    // 일어나지 않고, 냉동고에 없는 큐브가 장부에만 남는다.
    await narrow.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-07-05'),
      slot: 'morning',
      thawed: true,
      reason: '해동해 뒀는데 못 먹였다',
    });

    const discards = await narrow.prisma.stockLedgerEntry.findMany({
      where: { householdId: house.id, type: 'discarded', reason: 'thawed_not_fed' },
    });
    expect(discards).toHaveLength(4);
    expect(discards.every((entry) => entry.noFeedKey === '2026-07-05/morning')).toBe(true);
  });

  it('윈도 밖 소급 미급여를 취소하면 다시 원래대로 돌아온다', async () => {
    const house = await seedHousehold(narrow.prisma, longHistory);
    await stockAll(narrow, house, 60, '2026-06-30');
    await narrow.reconcile.run(house.id);
    const before = await snapshot(narrow, house);

    await narrow.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-07-05'),
      slot: 'morning',
      thawed: false,
      reason: null,
    });
    await narrow.noFeed.cancel({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-07-05'),
      slot: 'morning',
    });

    expect(await snapshot(narrow, house)).toEqual(before);
  });
});

describe('닫힌 배치를 지목하는 요청', () => {
  it('해동 폐기로 비워진 배치도 미급여를 취소하면 되돌아온다', async () => {
    const house = await seedHousehold(narrow.prisma, { mealCount: 3 });
    // 브로콜리만 딱 1개. 식단을 먹이면 0이 되어 기본 적재 범위에서 빠진다.
    for (const [name, weight] of Object.entries(SERVING_WEIGHT)) {
      await narrow.stock.registerCookedBatch({
        householdId: house.id,
        actor: house.actor,
        ingredientName: name,
        cubeWeightGram: weight,
        cookedOn: localDate('2026-08-15'),
        cubes: name === '브로콜리' ? 1 : 10,
      });
    }
    narrow.clock.set('2026-08-17', '12:00');
    await narrow.reconcile.run(house.id);

    const broccoli = await narrow.prisma.cookedBatch.findFirstOrThrow({
      where: { householdId: house.id, ingredientId: house.ingredientId('브로콜리') },
    });
    expect(broccoli.remainingCubes).toBe(0);

    // 해동 후 미급여: 소비를 되돌려 1개가 돌아오고, 곧바로 폐기되어 다시 0이 된다.
    await narrow.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      thawed: true,
      reason: null,
    });
    expect(
      (await narrow.prisma.cookedBatch.findUniqueOrThrow({ where: { id: broccoli.id } })).remainingCubes,
    ).toBe(0);

    // 취소하면 폐기가 되돌아오고, 식단시간이 지났으므로 다시 차감된다: 최종 0.
    await narrow.noFeed.cancel({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
    });

    const after = await narrow.prisma.cookedBatch.findUniqueOrThrow({ where: { id: broccoli.id } });
    const sum =
      (await narrow.prisma.stockLedgerEntry.aggregate({
        where: { batchId: broccoli.id },
        _sum: { delta: true },
      }))._sum.delta ?? 0;
    expect(after.remainingCubes).toBe(sum);
    expect(after.remainingCubes).toBe(0);

    // 되돌림 이벤트가 실제로 기록됐다: 폐기를 그냥 무시한 것이 아니다.
    // 식단은 쌀·오트밀·소고기·브로콜리 네 재료를 쓰므로 폐기도 되돌림도 네 건이다.
    expect(
      await narrow.prisma.stockLedgerEntry.count({
        where: { batchId: broccoli.id, reason: 'no_feed_cancelled' },
      }),
    ).toBe(1);
    expect(
      await narrow.prisma.stockLedgerEntry.count({
        where: { householdId: house.id, reason: 'no_feed_cancelled' },
      }),
    ).toBe(4);
  });
});
