import { ApplicationError } from '../../src/application/errors.js';
import { DomainError } from '../../src/domain/errors.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { localTime } from '../../src/domain/shared/local-time.js';
import { TestServices, at, buildServices, seedHousehold } from './setup/fixtures.js';

let services: TestServices;

beforeAll(() => {
  services = buildServices(at('2026-08-17', '09:00'));
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

type Household = Awaited<ReturnType<typeof seedHousehold>>;

const household = (mealCount = 0) => seedHousehold(services, { mealCount });

const updateRules = async (
  house: Household,
  pairings: [string, string, 'same_meal' | 'same_day'][],
  overrides: { max?: number | null; slot?: 'morning' | null; guidance?: string | null } = {},
) =>
  await services.rules.update({
    householdId: house.id,
    actor: house.actor,
    forbiddenPairings: pairings.map(([first, second, scope]) => ({
      ingredientNames: [first, second],
      scope,
    })),
    maxFirstIntroductionsPerDay: overrides.max === undefined ? 1 : overrides.max,
    firstIntroductionSlot: overrides.slot === undefined ? 'morning' : overrides.slot,
    textGuidance: overrides.guidance ?? null,
  });

describe('식단 규칙', () => {
  it('설정이 없으면 제약을 끈 상태로 읽힌다', async () => {
    const house = await household();
    expect(await services.rules.getRules(house.id)).toEqual({
      rules: { forbiddenPairings: [], maxFirstIntroductionsPerDay: null, firstIntroductionSlot: null },
      textGuidance: null,
    });
  });

  it('구조화된 제약과 텍스트 가이드가 함께 왕복한다', async () => {
    const house = await household();
    await updateRules(house, [['소고기', '애호박', 'same_day']], { guidance: '아침은 가볍게' });

    expect(await services.rules.getRules(house.id)).toEqual({
      rules: {
        forbiddenPairings: [
          {
            ingredientIds: expect.arrayContaining([house.ingredientId('소고기'), house.ingredientId('애호박')]),
            scope: 'same_day',
          },
        ],
        maxFirstIntroductionsPerDay: 1,
        firstIntroductionSlot: 'morning',
      },
      textGuidance: '아침은 가볍게',
    });
  });

  it('순서만 다른 같은 조합은 한 행으로 저장된다', async () => {
    const house = await household();
    await updateRules(house, [
      ['소고기', '애호박', 'same_day'],
      ['애호박', '소고기', 'same_day'],
    ]);
    expect(await services.prisma.forbiddenPairing.count({ where: { householdId: house.id } })).toBe(1);
  });

  it('두 번 저장해도 조합이 쌓이지 않는다', async () => {
    const house = await household();
    await updateRules(house, [['소고기', '애호박', 'same_day']]);
    await updateRules(house, [['소고기', '브로콜리', 'same_meal']]);

    const rows = await services.prisma.forbiddenPairing.findMany({ where: { householdId: house.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scope).toBe('same_meal');
  });

  it('제약을 모두 비울 수 있다', async () => {
    const house = await household();
    await updateRules(house, [['소고기', '애호박', 'same_day']]);
    await updateRules(house, [], { max: null, slot: null });

    expect(await services.rules.getRules(house.id)).toEqual({
      rules: { forbiddenPairings: [], maxFirstIntroductionsPerDay: null, firstIntroductionSlot: null },
      textGuidance: null,
    });
  });

  it('등록되지 않은 재료명은 거부하고 아무것도 저장하지 않는다', async () => {
    const house = await household();
    await expect(updateRules(house, [['소고기', '파프리카', 'same_day']])).rejects.toThrow(DomainError);
    expect(await services.prisma.mealPlanningRules.count({ where: { householdId: house.id } })).toBe(0);
  });

  it('같은 재료끼리의 조합은 거부한다', async () => {
    const house = await household();
    await expect(updateRules(house, [['소고기', '소고기', 'same_day']])).rejects.toThrow(ApplicationError);
  });
});

describe('알람 설정', () => {
  it('설정이 없으면 기본 브리프 시각과 임계일 14일로 읽힌다', async () => {
    const house = await household();
    expect(await services.alertSettings.getSettings(house.id)).toEqual({
      settings: { briefTime: localTime('07:30'), shelfLifeDays: 14 },
      thresholds: [],
    });
  });

  it('브리프 시각과 임계일, 재료별 임계개수가 왕복한다', async () => {
    const house = await household();
    await services.alertSettings.update({
      householdId: house.id,
      actor: house.actor,
      briefTime: localTime('06:45'),
      shelfLifeDays: 10,
      thresholds: [{ ingredientName: '소고기', thresholdCubes: 3 }],
    });

    expect(await services.alertSettings.getSettings(house.id)).toEqual({
      settings: { briefTime: localTime('06:45'), shelfLifeDays: 10 },
      thresholds: [{ ingredientName: '소고기', thresholdCubes: 3 }],
    });
  });

  it('임계개수는 통째로 갈아 끼운다', async () => {
    const house = await household();
    const update = (thresholds: { ingredientName: string; thresholdCubes: number }[]) =>
      services.alertSettings.update({
        householdId: house.id,
        actor: house.actor,
        briefTime: localTime('07:30'),
        shelfLifeDays: 14,
        thresholds,
      });

    await update([{ ingredientName: '소고기', thresholdCubes: 3 }]);
    await update([{ ingredientName: '브로콜리', thresholdCubes: 5 }]);

    expect((await services.alertSettings.getSettings(house.id)).thresholds).toEqual([
      { ingredientName: '브로콜리', thresholdCubes: 5 },
    ]);
  });

  it('바꾼 임계일이 폐기 대기 판정에 쓰인다', async () => {
    const house = await household();
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: '브로콜리',
      cubeWeightGram: 15,
      cookedOn: localDate('2026-08-10'),
      cubes: 4,
    });

    // 임계일 14일이면 8/24까지 가용이다.
    const before = await services.stock.getStockStatus(house.id);
    expect(before.ingredients.find((row) => row.ingredientId === house.ingredientId('브로콜리'))).toMatchObject({
      pendingDiscard: 0,
    });

    await services.alertSettings.update({
      householdId: house.id,
      actor: house.actor,
      briefTime: localTime('07:30'),
      shelfLifeDays: 5,
      thresholds: [],
    });

    const after = await services.stock.getStockStatus(house.id);
    expect(after.ingredients.find((row) => row.ingredientId === house.ingredientId('브로콜리'))).toMatchObject({
      pendingDiscard: 4,
    });
  });

  it('임계일이 0 이하면 거부한다', async () => {
    const house = await household();
    await expect(
      services.alertSettings.update({
        householdId: house.id,
        actor: house.actor,
        briefTime: localTime('07:30'),
        shelfLifeDays: 0,
        thresholds: [],
      }),
    ).rejects.toThrow(ApplicationError);
  });

  it('임계개수가 음수면 거부한다', async () => {
    const house = await household();
    await expect(
      services.alertSettings.update({
        householdId: house.id,
        actor: house.actor,
        briefTime: localTime('07:30'),
        shelfLifeDays: 14,
        thresholds: [{ ingredientName: '소고기', thresholdCubes: -1 }],
      }),
    ).rejects.toThrow(ApplicationError);
  });

  it('등록되지 않은 재료의 임계개수는 거부한다', async () => {
    const house = await household();
    await expect(
      services.alertSettings.update({
        householdId: house.id,
        actor: house.actor,
        briefTime: localTime('07:30'),
        shelfLifeDays: 14,
        thresholds: [{ ingredientName: '파프리카', thresholdCubes: 3 }],
      }),
    ).rejects.toThrow(DomainError);
  });
});
