import { localDate } from '../../src/domain/shared/local-date.js';
import { localTime } from '../../src/domain/shared/local-time.js';
import { MENU_NAME, TestServices, at, buildServices, seedHousehold } from './setup/fixtures.js';

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

/** Morning meals only, each "쌀오트밀죽 + 소고기 + 브로콜리", with the day-level rules switched on. */
async function household(mealCount = 3): Promise<Household> {
  const house = await seedHousehold(services, { mealCount });
  await services.rules.update({
    householdId: house.id,
    actor: house.actor,
    forbiddenPairings: [{ ingredientNames: ['소고기', '애호박'], scope: 'same_day' }],
    maxFirstIntroductionsPerDay: 1,
    firstIntroductionSlot: 'morning',
    textGuidance: null,
  });
  return house;
}

const warningsOf = async (house: Household, from: string, to: string) =>
  (await services.mealPlan.getMealPlan(house.id, localDate(from), localDate(to))).warnings;

describe('식단 경고', () => {
  it('식단표의 첫날은 새 재료가 넘쳐도 하루 한 개 제약에 걸린다', async () => {
    const house = await household(1);
    // 1번 식단에 쌀, 오트밀, 소고기, 브로콜리가 모두 처음 들어간다.
    const warnings = await warningsOf(house, '2026-08-17', '2026-08-17');
    expect(warnings.map((warning) => warning.code)).toEqual(['TOO_MANY_FIRST_INTRODUCTIONS']);
    expect(warnings[0]?.ingredientIds).toHaveLength(4);
  });

  it('이미 먹인 재료는 첫 도입으로 세지 않는다', async () => {
    const house = await household(3);
    for (const name of ['쌀', '오트밀', '소고기', '브로콜리']) {
      await services.stock.registerCookedBatch({
        householdId: house.id,
        actor: house.actor,
        ingredientName: name,
        cubeWeightGram: name === '쌀' ? 30 : name === '브로콜리' ? 15 : 10,
        cookedOn: localDate('2026-08-15'),
        cubes: 6,
      });
    }
    services.clock.set('2026-08-17', '11:00');
    await services.reconcile.run(house.id);

    // 8/18과 8/19 식단은 같은 재료뿐이라 첫 도입이 없다.
    expect(await warningsOf(house, '2026-08-18', '2026-08-19')).toEqual([]);
  });

  it('이관 때 검증완료로 등록한 재료도 첫 도입으로 세지 않는다', async () => {
    const house = await household(0);
    await services.ingredient.register({
      householdId: house.id,
      actor: house.actor,
      name: '완두콩',
      category: 'vegetable',
      servingWeightGram: 15,
      verifiedBeforeMigration: true,
    });
    // 완두콩은 이관 때 검증이 끝났으므로 이 식단의 첫 도입은 브로콜리 하나다.
    await services.mealPlan.appendMeals({
      householdId: house.id,
      actor: house.actor,
      slot: 'morning',
      meals: [{ composition: { baseMenuName: null, toppingIngredientNames: ['완두콩', '브로콜리'] } }],
    });

    expect(await warningsOf(house, '2026-08-17', '2026-08-17')).toEqual([]);
  });

  it('반응있음 재료가 예정 식단에 있으면 알린다', async () => {
    const house = await household(3);
    for (const name of ['쌀', '오트밀', '소고기', '브로콜리']) {
      await services.stock.registerCookedBatch({
        householdId: house.id,
        actor: house.actor,
        ingredientName: name,
        cubeWeightGram: name === '쌀' ? 30 : name === '브로콜리' ? 15 : 10,
        cookedOn: localDate('2026-08-15'),
        cubes: 6,
      });
    }
    services.clock.set('2026-08-17', '11:00');
    await services.reconcile.run(house.id);
    await services.reaction.record({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      ingredientName: '브로콜리',
      result: 'reacted',
      symptomMemo: '두드러기',
    });

    const warnings = await warningsOf(house, '2026-08-18', '2026-08-18');
    expect(warnings).toEqual([
      {
        code: 'REACTED_INGREDIENT_PLANNED',
        date: localDate('2026-08-18'),
        slot: 'morning',
        ingredientIds: [house.ingredientId('브로콜리')],
      },
    ]);
  });

  it('한쪽 끼니만 밀려 같은 날에 놓인 식단의 금지 조합을 잡는다', async () => {
    const house = await household(2);
    await services.mealSlot.start({
      householdId: house.id,
      actor: house.actor,
      slot: 'afternoon',
      startDate: localDate('2026-08-17'),
      mealTime: localTime('18:00'),
    });
    await services.mealPlan.appendMeals({
      householdId: house.id,
      actor: house.actor,
      slot: 'afternoon',
      meals: [
        { composition: { baseMenuName: null, toppingIngredientNames: ['애호박'] } },
        { composition: { baseMenuName: null, toppingIngredientNames: ['애호박'] } },
      ],
    });

    // 오전 1번(소고기)과 오후 1번(애호박)은 8/17에 함께 놓인다.
    const sameDay = await warningsOf(house, '2026-08-17', '2026-08-17');
    expect(sameDay.filter((warning) => warning.code === 'FORBIDDEN_PAIRING')).toEqual([
      {
        code: 'FORBIDDEN_PAIRING',
        date: localDate('2026-08-17'),
        slot: null,
        ingredientIds: expect.arrayContaining([house.ingredientId('소고기'), house.ingredientId('애호박')]),
      },
    ]);
  });

  it('한쪽 끼니만 밀려 새로 생긴 조합은 식단을 고치지 않아도 경고가 뜬다', async () => {
    const house = await household(3);
    await services.mealSlot.start({
      householdId: house.id,
      actor: house.actor,
      slot: 'afternoon',
      startDate: localDate('2026-08-17'),
      mealTime: localTime('18:00'),
    });
    // 오후 1~3번은 브로콜리, 4번만 애호박이다. 4번은 8/20이고 그날 오전 식단은 없다.
    await services.mealPlan.appendMeals({
      householdId: house.id,
      actor: house.actor,
      slot: 'afternoon',
      meals: [
        { composition: { baseMenuName: null, toppingIngredientNames: ['브로콜리'] } },
        { composition: { baseMenuName: null, toppingIngredientNames: ['브로콜리'] } },
        { composition: { baseMenuName: null, toppingIngredientNames: ['브로콜리'] } },
        { composition: { baseMenuName: null, toppingIngredientNames: ['애호박'] } },
      ],
    });

    const before = await warningsOf(house, '2026-08-17', '2026-08-20');
    expect(before.filter((warning) => warning.code === 'FORBIDDEN_PAIRING')).toEqual([]);

    // 오전만 하루 밀면 오전 3번(소고기)이 8/20으로 가서 오후 4번(애호박)과 같은 날이 된다.
    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      thawed: false,
      reason: '감기',
    });

    const after = await warningsOf(house, '2026-08-20', '2026-08-20');
    expect(after.filter((warning) => warning.code === 'FORBIDDEN_PAIRING')).toEqual([
      {
        code: 'FORBIDDEN_PAIRING',
        date: localDate('2026-08-20'),
        slot: null,
        ingredientIds: expect.arrayContaining([house.ingredientId('소고기'), house.ingredientId('애호박')]),
      },
    ]);
  });

  it('급여 완료 식단은 경고 대상이 아니다', async () => {
    const house = await household(1);
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: localDate('2026-08-15'),
      cubes: 6,
    });
    services.clock.set('2026-08-17', '11:00');
    await services.reconcile.run(house.id);

    expect(await warningsOf(house, '2026-08-17', '2026-08-17')).toEqual([]);
  });

  it('달력과 경고를 함께 돌려준다', async () => {
    const house = await household(1);
    const view = await services.mealPlan.getMealPlan(
      house.id,
      localDate('2026-08-17'),
      localDate('2026-08-17'),
    );
    expect(view.days).toHaveLength(1);
    expect(view.days[0]?.slots[0]?.meal?.planned.baseMenuId).toBe(house.menuId);
    expect(view.warnings).not.toHaveLength(0);
  });

  it('규칙을 끄면 경고가 사라진다', async () => {
    const house = await household(1);
    expect(await warningsOf(house, '2026-08-17', '2026-08-17')).not.toHaveLength(0);

    await services.rules.update({
      householdId: house.id,
      actor: house.actor,
      forbiddenPairings: [],
      maxFirstIntroductionsPerDay: null,
      firstIntroductionSlot: null,
      textGuidance: null,
    });
    expect(await warningsOf(house, '2026-08-17', '2026-08-17')).toEqual([]);
  });

  it('새 재료를 오후에 도입하면 알린다', async () => {
    const house = await household(0);
    await services.mealSlot.start({
      householdId: house.id,
      actor: house.actor,
      slot: 'afternoon',
      startDate: localDate('2026-08-17'),
      mealTime: localTime('18:00'),
    });
    await services.mealPlan.appendMeals({
      householdId: house.id,
      actor: house.actor,
      slot: 'afternoon',
      meals: [{ composition: { baseMenuName: MENU_NAME, toppingIngredientNames: [] } }],
    });

    const warnings = await warningsOf(house, '2026-08-17', '2026-08-17');
    expect(warnings.map((warning) => warning.code)).toContain('FIRST_INTRODUCTION_IN_WRONG_SLOT');
  });
});

describe('합침 재료의 식단 경고', () => {
  it('합침 재료에 처음 먹는 구성 재료가 있으면 첫 도입 경고는 그 구성 재료를 가리킨다', async () => {
    const house = await household(0);
    const oat = await services.ingredient.register({
      householdId: house.id,
      actor: house.actor,
      name: '귀리',
      category: 'base',
      servingWeightGram: 10,
      verifiedBeforeMigration: true,
    });
    const brownRice = await services.ingredient.register({
      householdId: house.id,
      actor: house.actor,
      name: '현미',
      category: 'base',
      servingWeightGram: 10,
    });
    const blend = await services.ingredient.registerBlend({
      householdId: house.id,
      actor: house.actor,
      name: '귀리현미',
      category: 'base',
      servingWeightGram: 20,
      constituentNames: ['귀리', '현미'],
    });
    await services.menu.register({
      householdId: house.id,
      actor: house.actor,
      name: '귀리현미죽',
      components: [{ ingredientName: '귀리현미', cubes: 1 }],
    });
    await services.mealSlot.start({
      householdId: house.id,
      actor: house.actor,
      slot: 'afternoon',
      startDate: localDate('2026-08-17'),
      mealTime: localTime('18:00'),
    });
    await services.mealPlan.appendMeals({
      householdId: house.id,
      actor: house.actor,
      slot: 'afternoon',
      meals: [{ composition: { baseMenuName: '귀리현미죽', toppingIngredientNames: [] } }],
    });

    const warnings = await warningsOf(house, '2026-08-17', '2026-08-17');

    // 귀리는 이관 때 검증이 끝났고, 합침 재료 자체는 먹인 재료가 아니다.
    expect(warnings).toEqual([
      {
        code: 'FIRST_INTRODUCTION_IN_WRONG_SLOT',
        date: localDate('2026-08-17'),
        slot: 'afternoon',
        ingredientIds: [brownRice.id],
      },
    ]);
    expect(warnings[0]?.ingredientIds).not.toContain(blend.id);
    expect(warnings[0]?.ingredientIds).not.toContain(oat.id);
  });
});
