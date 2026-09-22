import { DomainError } from '../../src/domain/errors.js';
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

const household = (mealCount = 3) => seedHousehold(services, { mealCount });

type Household = Awaited<ReturnType<typeof household>>;

const append = async (house: Household, count: number, slot: 'morning' | 'afternoon' = 'morning') =>
  await services.mealPlan.appendMeals({
    householdId: house.id,
    actor: house.actor,
    slot,
    meals: Array.from({ length: count }, () => ({
      composition: { baseMenuName: MENU_NAME, toppingIngredientNames: ['소고기'] },
    })),
  });

describe('식단 추가', () => {
  it('마지막 순서 뒤에 이어 붙인다', async () => {
    const house = await household(3);
    const appended = await append(house, 2);

    expect(appended.map((meal) => meal.order)).toEqual([4, 5]);
    const rows = await services.prisma.meal.findMany({
      where: { householdId: house.id },
      orderBy: { mealOrder: 'asc' },
      select: { mealOrder: true },
    });
    expect(rows.map((row) => row.mealOrder)).toEqual([1, 2, 3, 4, 5]);
  });

  it('식단이 없는 끼니에서는 1번부터 시작한다', async () => {
    const house = await household(0);
    const appended = await append(house, 1);
    expect(appended[0]?.order).toBe(1);
  });

  it('계획 토핑과 메모를 그대로 저장한다', async () => {
    const house = await household(0);
    const appended = await services.mealPlan.appendMeals({
      householdId: house.id,
      actor: house.actor,
      slot: 'morning',
      meals: [
        {
          composition: { baseMenuName: MENU_NAME, toppingIngredientNames: ['소고기', '브로콜리'] },
          memo: '(소량)',
        },
      ],
    });

    expect(appended[0]).toMatchObject({
      planned: {
        baseMenuId: house.menuId,
        toppingIngredientIds: [house.ingredientId('소고기'), house.ingredientId('브로콜리')],
      },
      memo: '(소량)',
      status: 'planned',
      migrated: false,
      actual: null,
    });
  });

  it('베이스 없이 토핑만 있는 식단도 붙일 수 있다', async () => {
    const house = await household(0);
    const appended = await services.mealPlan.appendMeals({
      householdId: house.id,
      actor: house.actor,
      slot: 'morning',
      meals: [{ composition: { baseMenuName: null, toppingIngredientNames: ['브로콜리'] } }],
    });
    expect(appended[0]?.planned.baseMenuId).toBeNull();
  });

  it('끼니가 시작되지 않았으면 거부한다', async () => {
    const house = await household(0);
    await expect(append(house, 1, 'afternoon')).rejects.toThrow(DomainError);
  });

  it('등록되지 않은 재료명은 거부하고 아무 식단도 남기지 않는다', async () => {
    const house = await household(0);
    await expect(
      services.mealPlan.appendMeals({
        householdId: house.id,
        actor: house.actor,
        slot: 'morning',
        meals: [
          { composition: { baseMenuName: MENU_NAME, toppingIngredientNames: ['소고기'] } },
          { composition: { baseMenuName: MENU_NAME, toppingIngredientNames: ['파프리카'] } },
        ],
      }),
    ).rejects.toThrow(DomainError);
    expect(await services.prisma.meal.count({ where: { householdId: house.id } })).toBe(0);
  });

  it('같은 멱등키로 두 번 부르면 식단이 한 번만 붙는다', async () => {
    const house = await household(0);
    const command = {
      householdId: house.id,
      actor: house.actor,
      idempotencyKey: 'import-001',
      slot: 'morning' as const,
      meals: [{ composition: { baseMenuName: MENU_NAME, toppingIngredientNames: ['소고기'] } }],
    };
    const first = await services.mealPlan.appendMeals(command);
    const second = await services.mealPlan.appendMeals(command);

    expect(second).toEqual(first);
    expect(await services.prisma.meal.count({ where: { householdId: house.id } })).toBe(1);
  });

  /**
   * The order has to come from the store. If it came from the loaded state, a household whose feeding
   * stopped for longer than the read window would load no meals at all and restart at order 1.
   */
  it('모든 식단이 윈도 밖의 급여 완료 상태여도 순서가 겹치지 않는다', async () => {
    const narrow = buildServices(at('2026-08-17', '09:00'), 5);
    try {
      const house = await seedHousehold(narrow, { mealCount: 2 });
      narrow.clock.set('2026-08-19', '11:00');
      await narrow.reconcile.run(house.id);
      expect(
        await narrow.prisma.meal.count({ where: { householdId: house.id, status: 'consumed' } }),
      ).toBe(2);

      // 윈도(5일)를 훌쩍 지난 시점. 적재에는 식단이 하나도 들어오지 않는다.
      narrow.clock.set('2026-10-01', '09:00');
      const appended = await narrow.mealPlan.appendMeals({
        householdId: house.id,
        actor: house.actor,
        slot: 'morning',
        meals: [{ composition: { baseMenuName: MENU_NAME, toppingIngredientNames: ['소고기'] } }],
      });
      expect(appended[0]?.order).toBe(3);
    } finally {
      await narrow.prisma.$disconnect();
    }
  });

  it('붙인 식단은 식단시간이 지나면 정합화가 차감한다', async () => {
    const house = await household(0);
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: localDate('2026-08-15'),
      cubes: 3,
    });
    const appended = await services.mealPlan.appendMeals({
      householdId: house.id,
      actor: house.actor,
      slot: 'morning',
      meals: [{ composition: { baseMenuName: null, toppingIngredientNames: ['소고기'] } }],
    });

    // 붙이는 것만으로는 아무것도 차감되지 않는다.
    const beforeStatus = await services.stock.getStockStatus(house.id);
    expect(beforeStatus.ingredients.find((row) => row.ingredientId === house.ingredientId('소고기'))?.total).toBe(3);

    services.clock.set('2026-08-17', '11:00');
    const report = await services.reconcile.run(house.id);

    expect(report.consumedMealIds).toEqual([appended[0]?.id]);
    const afterStatus = await services.stock.getStockStatus(house.id);
    expect(afterStatus.ingredients.find((row) => row.ingredientId === house.ingredientId('소고기'))?.total).toBe(2);
  });

  it('붙인 식단의 날짜는 미급여를 건너뛰며 계산된다', async () => {
    const house = await household(1);
    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-17'),
      slot: 'morning',
      thawed: false,
      reason: '감기',
    });
    await append(house, 1);

    const { days } = await services.mealPlan.getMealPlan(
      house.id,
      localDate('2026-08-18'),
      localDate('2026-08-19'),
    );
    expect(days.map((day) => day.slots[0]?.meal?.order)).toEqual([1, 2]);
  });

  it('새로 시작한 끼니에도 붙일 수 있다', async () => {
    const house = await household(1);
    await services.mealSlot.start({
      householdId: house.id,
      actor: house.actor,
      slot: 'afternoon',
      startDate: localDate('2026-08-18'),
      mealTime: localTime('18:00'),
    });
    const appended = await append(house, 2, 'afternoon');

    expect(appended.map((meal) => meal.order)).toEqual([1, 2]);
  });
});
