import { localDate } from '../../src/domain/shared/local-date.js';
import { Household, TestServices, at, buildServices, seedHousehold } from './setup/fixtures.js';

// 부모 두 명과 스케줄러가 같은 배치를 동시에 건드릴 수 있다. 도메인의 allocateOldestFirst는
// "모자라면 null"로 음수를 막지만, 두 트랜잭션이 같은 스냅샷을 읽으면 둘 다 성공해 버린다.
// 가정 행 잠금이 그것을 막는지, 그리고 막지 못했을 때 CHECK 제약이 마지막으로 잡는지 본다.

let services: TestServices;

beforeAll(() => {
  services = buildServices(at('2026-08-17', '10:00'));
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

const SERVING_WEIGHT: Record<string, number> = { 쌀: 30, 오트밀: 10, 소고기: 10, 브로콜리: 15, 애호박: 15 };

async function stockAll(house: Household, cubes: number, cookedOn = '2026-08-15'): Promise<void> {
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

const remainingOf = async (house: Household, ingredientName: string): Promise<number> => {
  const batches = await services.prisma.cookedBatch.findMany({
    where: { householdId: house.id, ingredientId: house.ingredientId(ingredientName) },
  });
  return batches.reduce((sum, batch) => sum + batch.remainingCubes, 0);
};

const consumedCount = async (house: Household, ingredientName: string): Promise<number> =>
  await services.prisma.stockLedgerEntry.count({
    where: { householdId: house.id, type: 'meal_consumed', batch: { ingredientId: house.ingredientId(ingredientName) } },
  });

describe('동시 차감', () => {
  it('마지막 큐브 1개를 두 정합화가 동시에 노려도 한 번만 차감된다', async () => {
    const house = await seedHousehold(services.prisma, { mealCount: 1 });
    await stockAll(house, 1);
    services.clock.set('2026-08-17', '10:00');

    await Promise.all([services.reconcile.run(house.id), services.reconcile.run(house.id)]);

    expect(await remainingOf(house, '브로콜리')).toBe(0);
    expect(await consumedCount(house, '브로콜리')).toBe(1);
  });

  it('다섯 개가 동시에 들어와도 차감은 한 번이다', async () => {
    const house = await seedHousehold(services.prisma, { mealCount: 1 });
    await stockAll(house, 1);
    services.clock.set('2026-08-17', '10:00');

    await Promise.all(Array.from({ length: 5 }, () => services.reconcile.run(house.id)));

    expect(await remainingOf(house, '브로콜리')).toBe(0);
    expect(await consumedCount(house, '브로콜리')).toBe(1);
  });

  it('재고 2개에 식단 3개가 동시에 정합화돼도 음수가 되지 않고 하나는 보류다', async () => {
    const house = await seedHousehold(services.prisma, { mealCount: 3 });
    await stockAll(house, 10);
    const broccoli = await services.prisma.cookedBatch.findFirstOrThrow({
      where: { householdId: house.id, ingredientId: house.ingredientId('브로콜리') },
    });
    await services.stock.adjustStockByCount({
      householdId: house.id,
      actor: house.actor,
      batchId: broccoli.id,
      countedCubes: 2,
      reason: null,
    });
    services.clock.set('2026-08-19', '10:00');

    const reports = await Promise.all([
      services.reconcile.run(house.id),
      services.reconcile.run(house.id),
      services.reconcile.run(house.id),
    ]);

    expect(await remainingOf(house, '브로콜리')).toBe(0);
    expect(await consumedCount(house, '브로콜리')).toBe(2);
    // 잠금이 순서를 정하므로 보류는 마지막으로 도는 쪽에서만 한 번 보고된다.
    expect(reports.flatMap((report) => report.held).length).toBeGreaterThanOrEqual(1);
  });

  it('정합화와 폐기가 동시에 들어와도 잔여 수량이 음수가 되지 않는다', async () => {
    const house = await seedHousehold(services.prisma, { mealCount: 1 });
    await stockAll(house, 1);
    const broccoli = await services.prisma.cookedBatch.findFirstOrThrow({
      where: { householdId: house.id, ingredientId: house.ingredientId('브로콜리') },
    });
    services.clock.set('2026-08-17', '10:00');

    const results = await Promise.allSettled([
      services.reconcile.run(house.id),
      services.stock.discardBatch({
        householdId: house.id,
        actor: house.actor,
        batchId: broccoli.id,
        reason: 'expired',
      }),
    ]);

    // 폐기가 먼저면 차감은 보류되고, 차감이 먼저면 폐기할 큐브가 없어 거부된다.
    // 어느 쪽이든 큐브 하나가 두 번 쓰이지는 않는다.
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect(await remainingOf(house, '브로콜리')).toBe(0);
    const spent = await services.prisma.stockLedgerEntry.count({
      where: { householdId: house.id, batchId: broccoli.id, delta: { lt: 0 } },
    });
    expect(spent).toBe(1);
  });

  it('같은 멱등키의 입고가 동시에 들어와도 배치는 하나다', async () => {
    const house = await seedHousehold(services.prisma, { mealCount: 1 });
    const command = {
      householdId: house.id,
      actor: house.actor,
      idempotencyKey: 'cook-race',
      ingredientName: '브로콜리',
      cubeWeightGram: 15,
      cookedOn: localDate('2026-08-15'),
      cubes: 10,
    };

    const results = await Promise.allSettled([
      services.stock.registerCookedBatch(command),
      services.stock.registerCookedBatch(command),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(await services.prisma.cookedBatch.count({ where: { householdId: house.id } })).toBe(1);
    expect(await remainingOf(house, '브로콜리')).toBe(10);
  });

  it('가정이 다르면 서로 막지 않는다', async () => {
    const one = await seedHousehold(services.prisma, { mealCount: 1 });
    const two = await seedHousehold(services.prisma, { mealCount: 1 });
    await stockAll(one, 1);
    await stockAll(two, 1);
    services.clock.set('2026-08-17', '10:00');

    await Promise.all([services.reconcile.run(one.id), services.reconcile.run(two.id)]);

    expect(await remainingOf(one, '브로콜리')).toBe(0);
    expect(await remainingOf(two, '브로콜리')).toBe(0);
  });
});

describe('없는 가정', () => {
  it('가정이 없으면 쓰기를 거부한다', async () => {
    await expect(services.reconcile.run('00000000-0000-7000-8000-000000000000')).rejects.toThrow(
      /가정을 찾을 수 없습니다/,
    );
  });
});
