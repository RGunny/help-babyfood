import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppModule } from '../../src/app.module.js';
import { AppEnv } from '../../src/config/env.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { APP_ENV } from '../../src/infrastructure/prisma/prisma.service.js';
import { RECONCILE_JOB } from '../../src/scheduler/reconcile.job.js';
import { Household, TestServices, at, buildServices, seedHousehold } from './setup/fixtures.js';
import { testDatabaseUrl } from './setup/database.js';

// 스케줄러가 부르는 것은 가정 전체를 한 바퀴 도는 정합화다. 가정 하나의 정합화 규칙은
// reconcile.int-spec.ts와 concurrency.int-spec.ts가 이미 고정하고 있고, 여기서 보는 것은
// "어느 가정이 도는가"다.

let services: TestServices;

beforeAll(() => {
  services = buildServices(at('2026-08-17', '09:00'));
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

const SERVING_WEIGHT: Record<string, number> = { 쌀: 30, 오트밀: 10, 소고기: 10, 브로콜리: 15, 애호박: 15 };

async function stockAll(house: Household, cubes: number): Promise<void> {
  for (const [name, weight] of Object.entries(SERVING_WEIGHT)) {
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: name,
      cubeWeightGram: weight,
      cookedOn: localDate('2026-08-15'),
      cubes,
    });
  }
}

const statusOf = async (mealId: string): Promise<string> =>
  (await services.prisma.meal.findUniqueOrThrow({ where: { id: mealId } })).status;

const remainingOf = async (house: Household, ingredientName: string): Promise<number> => {
  const batches = await services.prisma.cookedBatch.findMany({
    where: { householdId: house.id, ingredientId: house.ingredientId(ingredientName) },
  });
  return batches.reduce((sum, batch) => sum + batch.remainingCubes, 0);
};

describe('스케줄러의 정합화 쓸기', () => {
  it('가정이 둘이면 한 번의 쓸기로 양쪽 모두 차감된다', async () => {
    const first = await seedHousehold(services, { mealCount: 2 });
    const second = await seedHousehold(services, { mealCount: 2 });
    await stockAll(first, 10);
    await stockAll(second, 10);
    services.clock.set('2026-08-17', '10:30');

    const outcomes = await services.reconcile.runEveryHousehold();

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['reconciled', 'reconciled']);
    expect(await statusOf(first.mealIds[0])).toBe('consumed');
    expect(await statusOf(second.mealIds[0])).toBe('consumed');
    expect(await remainingOf(first, '소고기')).toBe(9);
    expect(await remainingOf(second, '소고기')).toBe(9);
  });

  it('쓸기를 다시 돌려도 두 번 차감하지 않는다', async () => {
    const house = await seedHousehold(services, { mealCount: 2 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '10:30');

    await services.reconcile.runEveryHousehold();
    const outcomes = await services.reconcile.runEveryHousehold();

    expect(outcomes[0]).toMatchObject({
      kind: 'reconciled',
      report: { consumedMealIds: [], revertedMealIds: [], held: [] },
    });
    expect(await remainingOf(house, '소고기')).toBe(9);
  });

  it('보류된 차감은 보고에 실려 나온다', async () => {
    const house = await seedHousehold(services, { mealCount: 1 });
    // 브로콜리만 빼고 입고한다. 오늘 식단의 브로콜리 차감이 보류된다.
    for (const [name, weight] of Object.entries(SERVING_WEIGHT)) {
      if (name === '브로콜리') continue;
      await services.stock.registerCookedBatch({
        householdId: house.id,
        actor: house.actor,
        ingredientName: name,
        cubeWeightGram: weight,
        cookedOn: localDate('2026-08-15'),
        cubes: 10,
      });
    }
    services.clock.set('2026-08-17', '10:30');

    const [outcome] = await services.reconcile.runEveryHousehold();

    expect(outcome).toMatchObject({
      kind: 'reconciled',
      report: {
        consumedMealIds: [house.mealIds[0]],
        held: [{ ingredientId: house.ingredientId('브로콜리'), cubes: 1 }],
      },
    });
  });

  it('정합화할 것이 없는 가정도 빈 보고로 지나간다', async () => {
    const house = await seedHousehold(services, { mealCount: 2 });
    await stockAll(house, 10);
    services.clock.set('2026-08-17', '09:00');

    const [outcome] = await services.reconcile.runEveryHousehold();

    expect(outcome).toEqual({
      kind: 'reconciled',
      householdId: house.id,
      report: { consumedMealIds: [], revertedMealIds: [], held: [] },
    });
  });

  it('가정이 하나도 없으면 아무 일도 하지 않는다', async () => {
    expect(await services.reconcile.runEveryHousehold()).toEqual([]);
  });
});

/** Only the environment is swapped: the module graph is the one `main.ts` boots. */
async function bootApp(schedulerEnabled: boolean) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_ENV)
    .useValue({
      databaseUrl: testDatabaseUrl(),
      lookbackDays: 90,
      databasePoolSize: 5,
      mcpAllowedHosts: ['localhost'],
      mcpAllowedOrigins: ['localhost'],
      schedulerEnabled,
    } satisfies AppEnv)
    .compile();
  await moduleRef.init();
  return moduleRef;
}

describe('스케줄러 배선', () => {
  it('서버를 띄우면 매분 도는 정합화 잡이 등록된다', async () => {
    const moduleRef = await bootApp(true);
    try {
      const registry = moduleRef.get(SchedulerRegistry);
      expect(registry.doesExist('cron', RECONCILE_JOB)).toBe(true);
      expect(registry.getCronJob(RECONCILE_JOB).cronTime.source).toBe('*/1 * * * *');
    } finally {
      await moduleRef.close();
    }
  });

  it('SCHEDULER_ENABLED가 false면 잡이 등록되지 않는다', async () => {
    const moduleRef = await bootApp(false);
    try {
      expect(moduleRef.get(SchedulerRegistry).getCronJobs().size).toBe(0);
    } finally {
      await moduleRef.close();
    }
  });

  it('등록된 잡을 발화시키면 실제로 차감이 일어난다', async () => {
    // 여기서만 진짜 시계를 쓴다. 등록된 콜백이 우리 tick이고 그것이 DB까지 닿는지가 이 테스트다.
    // 픽스처의 식단 날짜(2026-08-17부터)는 이 저장소의 다른 테스트와 같고, 지금은 이미 지났다.
    const house = await seedHousehold(services, { mealCount: 2 });
    await stockAll(house, 10);
    const moduleRef = await bootApp(true);

    try {
      await moduleRef.get(SchedulerRegistry).getCronJob(RECONCILE_JOB).fireOnTick();

      expect(await statusOf(house.mealIds[0])).toBe('consumed');
      expect(await remainingOf(house, '소고기')).toBe(8);
    } finally {
      await moduleRef.close();
    }
  });
});
