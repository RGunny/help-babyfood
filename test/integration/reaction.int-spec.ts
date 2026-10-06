import { ApplicationError } from '../../src/application/errors.js';
import { DomainError } from '../../src/domain/errors.js';
import { IngredientIntroduction } from '../../src/application/reaction.service.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { INGREDIENTS, TestServices, at, buildServices, seedHousehold } from './setup/fixtures.js';

let services: TestServices;

beforeAll(() => {
  services = buildServices(at('2026-08-17', '09:00'));
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

afterEach(() => {
  services.clock.set('2026-08-17', '09:00');
});

type Household = Awaited<ReturnType<typeof seedHousehold>>;

/** A row's status: an ingredient's introduction status, or a blend's constituents. */
type IntroductionStatus = IngredientIntroduction['status'];

/** Three morning meals fed on 8/17, 8/18 and 8/19, with stock for all of them. */
async function fedHousehold(): Promise<Household> {
  const house = await seedHousehold(services, { mealCount: 3 });
  for (const spec of INGREDIENTS) {
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: spec.name,
      cubeWeightGram: spec.servingWeightGram,
      cookedOn: localDate('2026-08-15'),
      cubes: 6,
    });
  }
  services.clock.set('2026-08-19', '11:00');
  await services.reconcile.run(house.id);
  return house;
}

const react = async (
  house: Household,
  date: string,
  ingredientName: string,
  result: 'clear' | 'reacted' = 'clear',
  symptomMemo: string | null = null,
) =>
  await services.reaction.record({
    householdId: house.id,
    actor: house.actor,
    date: localDate(date),
    slot: 'morning',
    ingredientName,
    result,
    symptomMemo,
  });

const statusOf = async (house: Household, name: string): Promise<IntroductionStatus | undefined> =>
  (await services.reaction.getIntroductionStatus(house.id)).find((row) => row.name === name)?.status;

describe('반응 기록', () => {
  it('이상 없음 한 번이면 검증중 1회다', async () => {
    const house = await fedHousehold();
    await react(house, '2026-08-17', '브로콜리');
    expect(await statusOf(house, '브로콜리')).toEqual({
      kind: 'verifying',
      clearCount: 1,
      unrecordedCount: 2,
    });
  });

  it('이상 없음 두 번이면 검증완료다', async () => {
    const house = await fedHousehold();
    await react(house, '2026-08-17', '브로콜리');
    await react(house, '2026-08-18', '브로콜리');
    expect(await statusOf(house, '브로콜리')).toEqual({ kind: 'verified' });
  });

  it('반응 있음이면 이상 없음 횟수와 무관하게 반응있음이다', async () => {
    const house = await fedHousehold();
    await react(house, '2026-08-17', '브로콜리');
    await react(house, '2026-08-18', '브로콜리');
    await react(house, '2026-08-19', '브로콜리', 'reacted', '두드러기');
    expect(await statusOf(house, '브로콜리')).toEqual({ kind: 'reacted' });
  });

  it('증상 메모와 수행자를 남긴다', async () => {
    const house = await fedHousehold();
    await react(house, '2026-08-17', '브로콜리', 'reacted', '두드러기');
    const row = await services.prisma.feedingReaction.findFirstOrThrow({
      where: { householdId: house.id },
    });
    expect(row).toMatchObject({ result: 'reacted', symptomMemo: '두드러기', createdByMemberId: house.memberId });
  });

  it('같은 식단과 재료를 다시 기록하면 정정이다', async () => {
    const house = await fedHousehold();
    await react(house, '2026-08-17', '브로콜리', 'reacted', '두드러기');
    await react(house, '2026-08-17', '브로콜리', 'clear', null);

    expect(await services.prisma.feedingReaction.count({ where: { householdId: house.id } })).toBe(1);
    expect(await statusOf(house, '브로콜리')).toEqual({
      kind: 'verifying',
      clearCount: 1,
      unrecordedCount: 2,
    });
  });

  it('베이스 메뉴의 재료에도 기록할 수 있다', async () => {
    const house = await fedHousehold();
    await react(house, '2026-08-17', '쌀');
    expect(await statusOf(house, '쌀')).toEqual({ kind: 'verifying', clearCount: 1, unrecordedCount: 2 });
  });

  it('별칭으로 가리켜도 같은 재료에 기록된다', async () => {
    const house = await fedHousehold();
    await react(house, '2026-08-17', '브로컬리');
    const row = await services.prisma.feedingReaction.findFirstOrThrow({ where: { householdId: house.id } });
    expect(row.ingredientId).toBe(house.ingredientId('브로콜리'));
  });

  it('아직 먹이지 않은 식단에는 기록할 수 없다', async () => {
    const house = await seedHousehold(services, { mealCount: 3 });
    await expect(react(house, '2026-08-17', '브로콜리')).rejects.toThrow(ApplicationError);
  });

  it('그 식단에 없는 재료는 거부한다', async () => {
    const house = await fedHousehold();
    await expect(react(house, '2026-08-17', '애호박')).rejects.toThrow(ApplicationError);
  });

  it('등록되지 않은 재료명은 거부한다', async () => {
    const house = await fedHousehold();
    await expect(react(house, '2026-08-17', '파프리카')).rejects.toThrow(DomainError);
  });

  it('식단이 없는 날짜는 거부한다', async () => {
    const house = await fedHousehold();
    await expect(react(house, '2026-09-01', '브로콜리')).rejects.toThrow(DomainError);
  });
});

describe('도입 상태 조회', () => {
  it('등록된 모든 재료가 한 줄씩 나오고 안 먹인 재료는 미도입이다', async () => {
    const house = await seedHousehold(services, { mealCount: 3 });
    const statuses = await services.reaction.getIntroductionStatus(house.id);

    expect(statuses.map((row) => row.name)).toEqual(INGREDIENTS.map((spec) => spec.name));
    expect(statuses.every((row) => row.status.kind === 'not_introduced')).toBe(true);
  });

  it('먹였지만 반응을 기록하지 않으면 미기록으로 센다', async () => {
    const house = await fedHousehold();
    expect(await statusOf(house, '소고기')).toEqual({
      kind: 'verifying',
      clearCount: 0,
      unrecordedCount: 3,
    });
  });

  it('실제 급여 내용으로 고치면 고친 재료가 도입된 것으로 센다', async () => {
    const house = await fedHousehold();
    await services.mealPlan.updateMealActualItems({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      composition: { baseMenuName: null, toppingIngredientNames: ['애호박'] },
    });

    expect(await statusOf(house, '애호박')).toEqual({
      kind: 'verifying',
      clearCount: 0,
      unrecordedCount: 1,
    });
    expect(await statusOf(house, '브로콜리')).toEqual({
      kind: 'verifying',
      clearCount: 0,
      unrecordedCount: 2,
    });
  });

  it('미급여로 밀린 식단은 급여 이력에 들지 않는다', async () => {
    const house = await fedHousehold();
    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-19'),
      slot: 'morning',
      thawed: false,
      reason: '감기',
    });

    expect(await statusOf(house, '소고기')).toEqual({
      kind: 'verifying',
      clearCount: 0,
      unrecordedCount: 2,
    });
  });
});

describe('합침 재료의 반응 기록', () => {
  /** 8/17 오전에 쌀오트밀합침죽을 먹인 집. 합침 큐브는 쌀과 오트밀로 만들었다. */
  async function blendFedHousehold(): Promise<Household> {
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
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: '쌀오트밀',
      cubeWeightGram: 40,
      cookedOn: localDate('2026-08-15'),
      cubes: 6,
    });
    services.clock.set('2026-08-17', '11:00');
    await services.reconcile.run(house.id);
    return house;
  }

  it('합침 재료를 먹인 끼니에 구성 재료의 반응을 기록할 수 있다', async () => {
    const house = await blendFedHousehold();

    await react(house, '2026-08-17', '오트밀');

    expect(await statusOf(house, '오트밀')).toEqual({ kind: 'verifying', clearCount: 1, unrecordedCount: 0 });
    expect(await statusOf(house, '쌀')).toEqual({ kind: 'verifying', clearCount: 0, unrecordedCount: 1 });
  });

  it('합침 재료 이름으로는 반응을 기록할 수 없다', async () => {
    const house = await blendFedHousehold();

    await expect(react(house, '2026-08-17', '쌀오트밀')).rejects.toMatchObject({
      code: 'BLEND_HAS_NO_REACTION',
      message: '합침 재료에는 반응을 기록하지 않습니다. 구성 재료로 기록하세요: 쌀, 오트밀',
    });
    await expect(react(house, '2026-08-17', '쌀오트밀')).rejects.toThrow(ApplicationError);
    expect(await services.prisma.feedingReaction.count({ where: { householdId: house.id } })).toBe(0);
  });
});
