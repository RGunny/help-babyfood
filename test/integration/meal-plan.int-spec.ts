import { ApplicationError } from '../../src/application/errors.js';
import { DomainError } from '../../src/domain/errors.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { Household, TestServices, at, buildServices, seedHousehold } from './setup/fixtures.js';

// "계획과 다르게 먹였다"는 정정은 기존 소비 취소와 새 내용으로의 재차감이 함께 기록돼야 한다.
// 한쪽만 남으면 재고가 조용히 틀어진다. 한 트랜잭션에서 끝나는지 본다.

let services: TestServices;

beforeAll(() => {
  services = buildServices(at('2026-08-17', '12:00'));
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

const remainingOf = async (house: Household, ingredientName: string): Promise<number> => {
  const batches = await services.prisma.cookedBatch.findMany({
    where: { householdId: house.id, ingredientId: house.ingredientId(ingredientName) },
  });
  return batches.reduce((sum, batch) => sum + batch.remainingCubes, 0);
};

async function expectProjectionMatchesLedger(house: Household): Promise<void> {
  const batches = await services.prisma.cookedBatch.findMany({ where: { householdId: house.id } });
  for (const batch of batches) {
    const sum =
      (await services.prisma.stockLedgerEntry.aggregate({
        where: { batchId: batch.id },
        _sum: { delta: true },
      }))._sum.delta ?? 0;
    expect({ id: batch.id, remaining: batch.remainingCubes }).toEqual({ id: batch.id, remaining: sum });
  }
}

const settled = async () => {
  const house = await seedHousehold(services, { mealCount: 3 });
  await stockAll(house, 10);
  services.clock.set('2026-08-17', '12:00');
  await services.reconcile.run(house.id);
  return house;
};

describe('실제 급여 내용 변경', () => {
  it('브로콜리 대신 애호박을 먹였다고 고치면 브로콜리 소비를 취소하고 애호박을 차감한다', async () => {
    const house = await settled();
    expect(await remainingOf(house, '브로콜리')).toBe(9);
    expect(await remainingOf(house, '애호박')).toBe(10);

    await services.mealPlan.updateMealActualItems({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['소고기', '애호박'] },
    });

    expect(await remainingOf(house, '브로콜리')).toBe(10);
    expect(await remainingOf(house, '애호박')).toBe(9);
    expect(await remainingOf(house, '소고기')).toBe(9);
    await expectProjectionMatchesLedger(house);
  });

  it('취소와 재차감이 모두 원장에 남는다', async () => {
    const house = await settled();
    await services.mealPlan.updateMealActualItems({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['소고기', '애호박'] },
    });

    const reverted = await services.prisma.stockLedgerEntry.count({
      where: { householdId: house.id, type: 'consumption_reverted' },
    });
    const consumed = await services.prisma.stockLedgerEntry.count({
      where: { householdId: house.id, type: 'meal_consumed' },
    });
    expect(reverted).toBe(1);
    expect(consumed).toBe(5);
  });

  it('실제 급여 내용을 지우면 계획대로 돌아간다', async () => {
    const house = await settled();
    const command = {
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning' as const,
    };
    await services.mealPlan.updateMealActualItems({
      ...command,
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['소고기', '애호박'] },
    });
    await services.mealPlan.updateMealActualItems({ ...command, composition: null });

    expect(await remainingOf(house, '브로콜리')).toBe(9);
    expect(await remainingOf(house, '애호박')).toBe(10);
    await expectProjectionMatchesLedger(house);
  });

  it('토핑 없이 먹였다고 고치면 토핑 소비가 모두 취소된다', async () => {
    const house = await settled();
    await services.mealPlan.updateMealActualItems({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: [] },
    });

    expect(await remainingOf(house, '소고기')).toBe(10);
    expect(await remainingOf(house, '브로콜리')).toBe(10);
    expect(await remainingOf(house, '쌀')).toBe(9);
    await expectProjectionMatchesLedger(house);
  });

  it('실제 급여 내용이 저장돼 다시 읽어도 남아 있다', async () => {
    const house = await settled();
    await services.mealPlan.updateMealActualItems({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      composition: { baseMenuName: null, toppingIngredientNames: ['애호박', '애호박'] },
    });

    const { days } = await services.mealPlan.getMealPlan(
      house.id,
      localDate('2026-08-17'),
      localDate('2026-08-17'),
    );
    expect(days[0]?.slots[0]?.meal?.actual).toEqual({
      baseMenuId: null,
      // 같은 재료가 두 번 들어간 실제 급여도 순서 그대로 왕복한다.
      toppingIngredientIds: [house.ingredientId('애호박'), house.ingredientId('애호박')],
    });
  });

  it('등록되지 않은 재료명은 거부하고 아무것도 바꾸지 않는다', async () => {
    const house = await settled();
    await expect(
      services.mealPlan.updateMealActualItems({
        householdId: house.id,
        actor: house.actor,
        date: localDate('2026-08-17'),
        slot: 'morning',
        composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['파프리카'] },
      }),
    ).rejects.toThrow(DomainError);

    expect(await remainingOf(house, '브로콜리')).toBe(9);
    expect(await services.prisma.mealActual.count()).toBe(0);
  });

  it('등록되지 않은 메뉴명도 거부한다', async () => {
    const house = await settled();
    await expect(
      services.mealPlan.updateMealActualItems({
        householdId: house.id,
        actor: house.actor,
        date: localDate('2026-08-17'),
        slot: 'morning',
        composition: { baseMenuName: '없는죽', toppingIngredientNames: [] },
      }),
    ).rejects.toThrow(DomainError);
  });

  it('그 날짜에 식단이 없으면 거부한다', async () => {
    const house = await settled();
    await expect(
      services.mealPlan.updateMealActualItems({
        householdId: house.id,
        actor: house.actor,
        date: localDate('2026-09-30'),
        slot: 'morning',
        composition: { baseMenuName: null, toppingIngredientNames: [] },
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe('계획 수정', () => {
  it('아직 안 먹인 식단의 계획을 바꾸면 그날 차감 내용이 바뀐다', async () => {
    const house = await settled();
    await services.mealPlan.updatePlannedMeal({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-18'),
      slot: 'morning',
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['애호박'] },
      memo: '(소량)',
    });

    services.clock.set('2026-08-18', '12:00');
    await services.reconcile.run(house.id);

    expect(await remainingOf(house, '애호박')).toBe(9);
    // 8/17에 한 번, 8/18은 계획이 바뀌어 안 쓴다.
    expect(await remainingOf(house, '브로콜리')).toBe(9);
    await expectProjectionMatchesLedger(house);
  });

  it('메모를 보관하고 달력에 실어 준다', async () => {
    const house = await settled();
    await services.mealPlan.updatePlannedMeal({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-18'),
      slot: 'morning',
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['소고기'] },
      memo: '(+10g)',
    });

    const { days } = await services.mealPlan.getMealPlan(
      house.id,
      localDate('2026-08-18'),
      localDate('2026-08-18'),
    );
    expect(days[0]?.slots[0]?.meal?.memo).toBe('(+10g)');
  });

  it('메모를 넘기지 않으면 기존 메모를 지우지 않는다', async () => {
    const house = await settled();
    const command = {
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-18'),
      slot: 'morning' as const,
      composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['소고기'] },
    };
    await services.mealPlan.updatePlannedMeal({ ...command, memo: '(+10g)' });
    await services.mealPlan.updatePlannedMeal(command);

    const { days } = await services.mealPlan.getMealPlan(
      house.id,
      localDate('2026-08-18'),
      localDate('2026-08-18'),
    );
    expect(days[0]?.slots[0]?.meal?.memo).toBe('(+10g)');
  });
});

describe('달력 조회', () => {
  it('날짜마다 일차와 끼니별 식단을 돌려준다', async () => {
    const house = await settled();
    const { days } = await services.mealPlan.getMealPlan(
      house.id,
      localDate('2026-08-17'),
      localDate('2026-08-19'),
    );

    expect(days.map((day) => day.dayNumber)).toEqual([1, 2, 3]);
    expect(days.map((day) => day.slots[0]?.meal?.id)).toEqual(house.mealIds);
  });

  it('미급여를 등록하면 그 날짜에는 식단이 없고 이후가 밀린다', async () => {
    const house = await settled();
    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-18'),
      slot: 'morning',
      thawed: false,
      reason: '감기',
    });

    const { days } = await services.mealPlan.getMealPlan(
      house.id,
      localDate('2026-08-17'),
      localDate('2026-08-19'),
    );
    expect(days[1]?.slots[0]?.meal).toBeNull();
    expect(days[1]?.slots[0]?.noFeed?.reason).toBe('감기');
    expect(days[1]?.dayNumber).toBeNull();
    expect(days[2]?.slots[0]?.meal?.id).toBe(house.mealIds[1]);
  });

  it('식단표가 끝난 뒤의 날짜는 식단이 비어 있다', async () => {
    const house = await settled();
    const { days } = await services.mealPlan.getMealPlan(
      house.id,
      localDate('2026-08-20'),
      localDate('2026-08-20'),
    );
    expect(days[0]?.slots[0]?.meal).toBeNull();
  });
});

describe('합침 재료와 토핑', () => {
  it('합침 재료는 토핑으로 넣을 수 없다', async () => {
    const house = await settled();
    await services.ingredient.registerBlend({
      householdId: house.id,
      actor: house.actor,
      name: '쌀오트밀',
      category: 'base',
      servingWeightGram: 40,
      constituentNames: ['쌀', '오트밀'],
    });
    const composition = { baseMenuName: '쌀오트밀죽', toppingIngredientNames: ['소고기', '쌀오트밀'] };

    await expect(
      services.mealPlan.updatePlannedMeal({
        householdId: house.id,
        actor: house.actor,
        date: localDate('2026-08-18'),
        slot: 'morning',
        composition,
      }),
    ).rejects.toMatchObject({
      code: 'BLEND_AS_TOPPING',
      message: '합침 재료는 메뉴 구성으로만 쓸 수 있습니다: 쌀오트밀',
    });
    await expect(
      services.mealPlan.updateMealActualItems({
        householdId: house.id,
        actor: house.actor,
        date: localDate('2026-08-17'),
        slot: 'morning',
        composition,
      }),
    ).rejects.toThrow(ApplicationError);

    expect(await services.prisma.mealActual.count({ where: { meal: { householdId: house.id } } })).toBe(0);
    expect(await remainingOf(house, '소고기')).toBe(9);
    await expectProjectionMatchesLedger(house);
  });
});
