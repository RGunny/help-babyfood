import { localDate } from '../../src/domain/shared/local-date.js';
import { Household, TestServices, at, buildServices, seedHousehold } from './setup/fixtures.js';

// 1단계 src/domain/deduction/deduction.spec.ts의 시나리오를 DB를 거쳐 다시 확인한다.
// 도메인이 이미 고정한 규칙이 영속화를 통과해도 그대로인지가 여기서 보는 것이다.

let services: TestServices;

beforeAll(() => {
  services = buildServices(at('2026-08-17', '09:00'));
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

const SERVING_WEIGHT: Record<string, number> = { 쌀: 30, 오트밀: 10, 소고기: 10, 브로콜리: 15, 애호박: 15 };

/** 모든 재료를 현재 1회분 중량으로 같은 날 입고한다. */
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

const statusOf = async (mealId: string): Promise<string> =>
  (await services.prisma.meal.findUniqueOrThrow({ where: { id: mealId } })).status;

/** 투영 칼럼이 원장의 합과 어긋나면 이후 예측이 전부 틀린다. 모든 시나리오 끝에 확인한다. */
async function expectProjectionMatchesLedger(house: Household): Promise<void> {
  const batches = await services.prisma.cookedBatch.findMany({ where: { householdId: house.id } });
  for (const batch of batches) {
    const sum =
      (await services.prisma.stockLedgerEntry.aggregate({
        where: { batchId: batch.id },
        _sum: { delta: true },
      }))._sum.delta ?? 0;
    expect({ batch: batch.id, remaining: batch.remainingCubes }).toEqual({ batch: batch.id, remaining: sum });
  }
}

describe('자동 차감', () => {
  it('식단시간 전에는 아무것도 바뀌지 않는다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '09:59');

    const report = await services.reconcile.run(house.id);

    expect(report.consumedMealIds).toEqual([]);
    expect(await remainingOf(house, '브로콜리')).toBe(10);
    await expectProjectionMatchesLedger(house);
  });

  it('식단시간이 지나면 급여 완료로 바꾸고 메뉴와 토핑의 큐브를 1개씩 차감한다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '10:00');

    const report = await services.reconcile.run(house.id);

    expect(report.consumedMealIds).toEqual([house.mealIds[0]]);
    expect(await statusOf(house.mealIds[0]!)).toBe('consumed');
    expect(await remainingOf(house, '쌀')).toBe(9);
    expect(await remainingOf(house, '오트밀')).toBe(9);
    expect(await remainingOf(house, '소고기')).toBe(9);
    expect(await remainingOf(house, '브로콜리')).toBe(9);
    expect(await remainingOf(house, '애호박')).toBe(10);
    await expectProjectionMatchesLedger(house);
  });

  it('같은 시각에 다시 돌려도 바뀌는 것이 없다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '10:00');

    await services.reconcile.run(house.id);
    const second = await services.reconcile.run(house.id);

    expect(second).toEqual({ consumedMealIds: [], revertedMealIds: [], held: [] });
    expect(await remainingOf(house, '브로콜리')).toBe(9);
    await expectProjectionMatchesLedger(house);
  });

  it('서버가 멈춰 있던 동안의 식단은 재기동 후 첫 정합화에서 소급해 차감한다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 10);
    services.clock.set('2026-08-20', '10:00');

    const report = await services.reconcile.run(house.id);

    expect(report.consumedMealIds).toHaveLength(4);
    expect(await remainingOf(house, '브로콜리')).toBe(6);
    await expectProjectionMatchesLedger(house);
  });

  it('먼저 먹인 식단이 더 오래된 배치의 큐브를 가져간다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 1, '2026-08-14');
    await stockAll(house, 5, '2026-08-15');
    services.clock.set('2026-08-18', '10:00');

    await services.reconcile.run(house.id);

    const older = await services.prisma.cookedBatch.findFirstOrThrow({
      where: { householdId: house.id, ingredientId: house.ingredientId('브로콜리'), cookedOn: new Date('2026-08-14') },
    });
    expect(older.remainingCubes).toBe(0);
    await expectProjectionMatchesLedger(house);
  });

  it('조리일이 식단 날짜보다 늦은 배치에서는 차감하지 않고 보류한다', async () => {
    const house = await seedHousehold(services, { mealCount: 1 });
    await stockAll(house, 10, '2026-08-18');
    services.clock.set('2026-08-17', '10:00');

    const report = await services.reconcile.run(house.id);

    expect(report.consumedMealIds).toEqual([house.mealIds[0]]);
    expect(report.held).toHaveLength(4);
    expect(await remainingOf(house, '브로콜리')).toBe(10);
    await expectProjectionMatchesLedger(house);
  });
});

describe('재고 부족과 보류', () => {
  it('모자란 재료만 보류하고 나머지는 차감하며 식단은 급여 완료가 된다', async () => {
    const house = await seedHousehold(services, { mealCount: 1 });
    await stockAll(house, 10);
    // 브로콜리만 비운다.
    const broccoli = await services.prisma.cookedBatch.findFirstOrThrow({
      where: { householdId: house.id, ingredientId: house.ingredientId('브로콜리') },
    });
    await services.stock.discardBatch({
      householdId: house.id,
      actor: house.actor,
      batchId: broccoli.id,
      reason: 'other',
    });
    services.clock.set('2026-08-17', '10:00');

    const report = await services.reconcile.run(house.id);

    expect(await statusOf(house.mealIds[0]!)).toBe('consumed');
    expect(report.held.map((item) => item.ingredientId)).toEqual([house.ingredientId('브로콜리')]);
    expect(await remainingOf(house, '소고기')).toBe(9);
    await expectProjectionMatchesLedger(house);
  });

  it('입고를 늦게 등록하면 보류된 차감이 다음 정합화에서 처리된다', async () => {
    const house = await seedHousehold(services, { mealCount: 1 });
    await stockAll(house, 10);
    const broccoli = await services.prisma.cookedBatch.findFirstOrThrow({
      where: { householdId: house.id, ingredientId: house.ingredientId('브로콜리') },
    });
    await services.stock.discardBatch({
      householdId: house.id,
      actor: house.actor,
      batchId: broccoli.id,
      reason: 'other',
    });
    services.clock.set('2026-08-17', '10:00');
    await services.reconcile.run(house.id);

    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: '브로콜리',
      cubeWeightGram: 15,
      cookedOn: localDate('2026-08-16'),
      cubes: 5,
    });
    const report = await services.reconcile.run(house.id);

    expect(report.held).toEqual([]);
    expect(await remainingOf(house, '브로콜리')).toBe(4);
    await expectProjectionMatchesLedger(house);
  });

  it('재고는 음수로 내려가지 않는다: 2개뿐이면 두 식단만 차감하고 나머지는 보류한다', async () => {
    const house = await seedHousehold(services, { mealCount: 4 });
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
    services.clock.set('2026-08-20', '10:00');

    const report = await services.reconcile.run(house.id);

    expect(await remainingOf(house, '브로콜리')).toBe(0);
    expect(report.held).toHaveLength(2);
    await expectProjectionMatchesLedger(house);
  });
});

describe('미급여 등록', () => {
  it('식단시간 전에 등록하면 차감 없이 식단만 다음 날로 밀린다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '09:00');

    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      thawed: false,
      reason: '감기',
    });

    expect(await remainingOf(house, '브로콜리')).toBe(10);
    expect(await statusOf(house.mealIds[0]!)).toBe('planned');

    services.clock.set('2026-08-18', '10:00');
    await services.reconcile.run(house.id);
    expect(await statusOf(house.mealIds[0]!)).toBe('consumed');
    expect(await remainingOf(house, '브로콜리')).toBe(9);
    await expectProjectionMatchesLedger(house);
  });

  it('식단시간 후 해동 전에 등록하면 소비를 취소하고 식단은 예정으로 돌아간다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '10:00');
    await services.reconcile.run(house.id);
    expect(await remainingOf(house, '브로콜리')).toBe(9);

    services.clock.set('2026-08-17', '12:00');
    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      thawed: false,
      reason: null,
    });

    expect(await statusOf(house.mealIds[0]!)).toBe('planned');
    expect(await remainingOf(house, '브로콜리')).toBe(10);
    await expectProjectionMatchesLedger(house);
  });

  it('식단시간 후 해동 후에 등록하면 소비를 취소하고 같은 수량을 폐기로 기록한다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '10:00');
    await services.reconcile.run(house.id);

    services.clock.set('2026-08-17', '12:00');
    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      thawed: true,
      reason: null,
    });

    expect(await statusOf(house.mealIds[0]!)).toBe('planned');
    expect(await remainingOf(house, '브로콜리')).toBe(9);
    const discards = await services.prisma.stockLedgerEntry.findMany({
      where: { householdId: house.id, type: 'discarded', reason: 'thawed_not_fed' },
    });
    expect(discards).toHaveLength(4);
    expect(discards.every((entry) => entry.noFeedKey === '2026-08-17/morning')).toBe(true);
    await expectProjectionMatchesLedger(house);
  });

  it('미뤄진 식단을 실제로 먹이는 날에는 큐브가 다시 차감된다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '12:00');
    await services.reconcile.run(house.id);
    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      thawed: true,
      reason: null,
    });

    services.clock.set('2026-08-18', '10:00');
    await services.reconcile.run(house.id);

    // 해동 폐기로 1개, 미뤄진 식단을 먹여서 1개.
    expect(await remainingOf(house, '브로콜리')).toBe(8);
    expect(await statusOf(house.mealIds[0]!)).toBe('consumed');
    await expectProjectionMatchesLedger(house);
  });

  it('며칠 뒤 소급해 등록하면 마지막에 차감됐던 식단만 예정으로 돌아간다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 10);
    services.clock.set('2026-08-20', '12:00');
    await services.reconcile.run(house.id);
    expect(await remainingOf(house, '브로콜리')).toBe(6);

    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-18'),
      slot: 'morning',
      thawed: false,
      reason: '그저께 안 먹였어',
    });

    expect(await remainingOf(house, '브로콜리')).toBe(7);
    expect(await statusOf(house.mealIds[3]!)).toBe('planned');
    expect(await statusOf(house.mealIds[2]!)).toBe('consumed');
    await expectProjectionMatchesLedger(house);
  });

  it('같은 날짜와 끼니를 두 번 등록할 수 없다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 10);
    const command = {
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning' as const,
      thawed: false,
      reason: null,
    };
    await services.noFeed.register(command);
    await expect(services.noFeed.register(command)).rejects.toThrow();
  });

  it('같은 멱등키로 다시 부르면 미급여는 한 건이고 원장 변화도 한 번분이다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '12:00');
    await services.reconcile.run(house.id);

    const command = {
      householdId: house.id,
      actor: house.actor,
      idempotencyKey: 'no-feed-001',
      date: localDate('2026-08-17'),
      slot: 'morning' as const,
      thawed: true,
      reason: null,
    };
    await services.noFeed.register(command);
    await services.noFeed.register(command);

    expect(await services.prisma.noFeedRecord.count({ where: { householdId: house.id } })).toBe(1);
    expect(await remainingOf(house, '브로콜리')).toBe(9);
    await expectProjectionMatchesLedger(house);
  });
});

describe('미급여 취소', () => {
  it('잘못 등록한 미급여를 지우면 날짜가 당겨지고 식단시간이 지난 식단이 다시 차감된다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '12:00');
    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      thawed: false,
      reason: null,
    });
    expect(await remainingOf(house, '브로콜리')).toBe(10);

    await services.noFeed.cancel({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
    });

    expect(await remainingOf(house, '브로콜리')).toBe(9);
    expect(await statusOf(house.mealIds[0]!)).toBe('consumed');
    await expectProjectionMatchesLedger(house);
  });

  it('해동 후로 등록했던 미급여를 지우면 폐기했던 큐브도 되돌린다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '12:00');
    await services.reconcile.run(house.id);
    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      thawed: true,
      reason: null,
    });
    expect(await remainingOf(house, '브로콜리')).toBe(9);

    await services.noFeed.cancel({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
    });

    // 폐기 되돌림으로 10, 식단을 다시 먹여서 9.
    expect(await remainingOf(house, '브로콜리')).toBe(9);
    expect(await statusOf(house.mealIds[0]!)).toBe('consumed');
    await expectProjectionMatchesLedger(house);
  });

  it('없는 미급여 기록은 지울 수 없다', async () => {
    const house = await seedHousehold(services, { mealCount: 6 });
    await expect(
      services.noFeed.cancel({
        householdId: house.id,
        actor: house.actor,
        date: localDate('2026-08-17'),
        slot: 'morning',
      }),
    ).rejects.toThrow();
  });
});

describe('수행자 기록', () => {
  it('스케줄러가 돌린 정합화는 구성원 없이 남는다', async () => {
    const house = await seedHousehold(services, { mealCount: 1 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '10:00');
    await services.reconcile.run(house.id);

    const consumed = await services.prisma.stockLedgerEntry.findMany({
      where: { householdId: house.id, type: 'meal_consumed' },
    });
    expect(consumed).toHaveLength(4);
    expect(consumed.every((entry) => entry.actorSource === 'scheduler' && entry.actorMemberId === null)).toBe(true);
  });

  it('모든 원장 이벤트에 수행자가 있다', async () => {
    const house = await seedHousehold(services, { mealCount: 1 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '10:00');
    await services.reconcile.run(house.id, house.actor);

    const entries = await services.prisma.stockLedgerEntry.findMany({ where: { householdId: house.id } });
    expect(entries.length).toBeGreaterThan(0);
    expect(
      entries.every(
        (entry) =>
          (entry.actorSource === 'member' && entry.actorMemberId !== null) ||
          (entry.actorSource === 'scheduler' && entry.actorMemberId === null),
      ),
    ).toBe(true);
  });
});

describe('합침 재료의 차감', () => {
  it('합침 재료 메뉴의 끼니는 합침 큐브를 차감하고 구성 재료의 큐브는 건드리지 않는다', async () => {
    const house = await seedHousehold(services, { mealCount: 0 });
    await services.ingredient.registerBlend({
      householdId: house.id,
      actor: house.actor,
      name: '쌀오트밀',
      category: 'base',
      servingWeightGram: 40,
      constituentNames: ['쌀', '오트밀'],
    });
    await services.menu.register({
      householdId: house.id,
      actor: house.actor,
      name: '쌀오트밀합침죽',
      components: [{ ingredientName: '쌀오트밀', cubes: 1 }],
    });
    await services.mealPlan.appendMeals({
      householdId: house.id,
      actor: house.actor,
      slot: 'morning',
      meals: [{ composition: { baseMenuName: '쌀오트밀합침죽', toppingIngredientNames: [] } }],
    });
    const weights: [string, number][] = [
      ['쌀', 30],
      ['오트밀', 10],
      ['쌀오트밀', 40],
    ];
    for (const [name, weight] of weights) {
      await services.stock.registerCookedBatch({
        householdId: house.id,
        actor: house.actor,
        ingredientName: name,
        cubeWeightGram: weight,
        cookedOn: localDate('2026-08-15'),
        cubes: 10,
      });
    }
    const blendId = (await services.prisma.ingredient.findFirstOrThrow({
      where: { householdId: house.id, name: '쌀오트밀' },
    })).id;
    services.clock.set('2026-08-17', '10:00');

    const report = await services.reconcile.run(house.id);

    expect(report.consumedMealIds).toHaveLength(1);
    expect(report.held).toEqual([]);
    const blendBatches = await services.prisma.cookedBatch.findMany({
      where: { householdId: house.id, ingredientId: blendId },
    });
    expect(blendBatches.map((batch) => batch.remainingCubes)).toEqual([9]);
    expect(await remainingOf(house, '쌀')).toBe(10);
    expect(await remainingOf(house, '오트밀')).toBe(10);
    await expectProjectionMatchesLedger(house);
  });
});
