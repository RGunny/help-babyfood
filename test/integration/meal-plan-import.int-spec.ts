import { ApplicationError } from '../../src/application/errors.js';
import { ImportMealPlanCommand } from '../../src/application/meal-plan-import.service.js';
import { DomainError } from '../../src/domain/errors.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { localTime } from '../../src/domain/shared/local-time.js';
import { MENU_NAME, TestServices, at, buildServices, seedHousehold } from './setup/fixtures.js';

let services: TestServices;

beforeAll(() => {
  services = buildServices(at('2026-09-22', '09:00'));
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

afterEach(() => {
  services.clock.set('2026-09-22', '09:00');
});

/** A household whose morning slot started on 8/17 and has no meals yet. */
const household = () => seedHousehold(services, { mealCount: 0, slotStartDate: '2026-08-17' });

type Household = Awaited<ReturnType<typeof household>>;

/** The spreadsheet rows: n days of "쌀오트밀죽 + 소고기". */
const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    composition: { baseMenuName: MENU_NAME, toppingIngredientNames: ['소고기'] },
    memo: index === 0 ? '(소량)' : null,
  }));

const command = (
  house: Household,
  overrides: Partial<ImportMealPlanCommand> = {},
): ImportMealPlanCommand => ({
  householdId: house.id,
  actor: house.actor,
  slot: 'morning',
  meals: rows(6),
  // 8/17부터 여섯 끼니는 8/17~8/22이므로 앞의 세 끼니가 이관 대상이다.
  fedThrough: localDate('2026-08-19'),
  ...overrides,
});

const ledgerCount = async (house: Household) =>
  await services.prisma.stockLedgerEntry.count({ where: { householdId: house.id } });

describe('식단표 가져오기 미리보기', () => {
  it('각 식단이 놓일 날짜와 이관 여부를 돌려준다', async () => {
    const house = await household();
    const preview = await services.mealPlanImport.preview(command(house));

    expect(preview.meals.map((meal) => [meal.order, meal.date, meal.migrated])).toEqual([
      [1, '2026-08-17', true],
      [2, '2026-08-18', true],
      [3, '2026-08-19', true],
      [4, '2026-08-20', false],
      [5, '2026-08-21', false],
      [6, '2026-08-22', false],
    ]);
  });

  it('식단을 하나도 만들지 않는다', async () => {
    const house = await household();
    await services.mealPlanImport.preview(command(house));

    expect(await services.prisma.meal.count({ where: { householdId: house.id } })).toBe(0);
    expect(await ledgerCount(house)).toBe(0);
  });

  it('제약 위반을 경고로 돌려준다', async () => {
    const house = await household();
    await services.rules.update({
      householdId: house.id,
      actor: house.actor,
      forbiddenPairings: [{ ingredientNames: ['소고기', '애호박'], scope: 'same_meal' }],
      maxFirstIntroductionsPerDay: null,
      firstIntroductionSlot: null,
      textGuidance: null,
    });

    const preview = await services.mealPlanImport.preview(
      command(house, {
        fedThrough: null,
        meals: [
          {
            composition: { baseMenuName: MENU_NAME, toppingIngredientNames: ['소고기', '애호박'] },
          },
        ],
      }),
    );

    expect(preview.warnings.map((warning) => warning.code)).toEqual(['FORBIDDEN_PAIRING']);
  });

  it('등록되지 않은 재료명은 미리보기에서 거부한다', async () => {
    const house = await household();
    await expect(
      services.mealPlanImport.preview(
        command(house, {
          meals: [{ composition: { baseMenuName: MENU_NAME, toppingIngredientNames: ['당근'] } }],
        }),
      ),
    ).rejects.toThrow(DomainError);
  });

  it('등록되지 않은 메뉴명도 거부한다', async () => {
    const house = await household();
    await expect(
      services.mealPlanImport.preview(
        command(house, {
          meals: [{ composition: { baseMenuName: '없는죽', toppingIngredientNames: [] } }],
        }),
      ),
    ).rejects.toThrow(DomainError);
  });
});

describe('식단표 확정', () => {
  it('이관 경계까지는 급여 완료로, 그 뒤는 예정으로 저장한다', async () => {
    const house = await household();
    await services.mealPlanImport.commit(command(house));

    const meals = await services.prisma.meal.findMany({
      where: { householdId: house.id },
      orderBy: { mealOrder: 'asc' },
      select: { mealOrder: true, status: true, migrated: true },
    });
    expect(meals).toEqual([
      { mealOrder: 1, status: 'consumed', migrated: true },
      { mealOrder: 2, status: 'consumed', migrated: true },
      { mealOrder: 3, status: 'consumed', migrated: true },
      { mealOrder: 4, status: 'planned', migrated: false },
      { mealOrder: 5, status: 'planned', migrated: false },
      { mealOrder: 6, status: 'planned', migrated: false },
    ]);
  });

  it('이관된 식단은 원장을 건드리지 않는다', async () => {
    const house = await household();
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: '쌀',
      cubeWeightGram: 30,
      cookedOn: localDate('2026-08-16'),
      cubes: 20,
    });
    const before = await ledgerCount(house);

    await services.mealPlanImport.commit(command(house));

    expect(await ledgerCount(house)).toBe(before);
  });

  it('정합화를 돌려도 이관된 식단은 다시 차감되지 않는다', async () => {
    const house = await household();
    for (const name of ['쌀', '오트밀', '소고기']) {
      await services.stock.registerCookedBatch({
        householdId: house.id,
        actor: house.actor,
        ingredientName: name,
        cubeWeightGram: name === '쌀' ? 30 : 10,
        cookedOn: localDate('2026-08-16'),
        cubes: 20,
      });
    }
    await services.mealPlanImport.commit(command(house));
    const beforeRemaining = await services.stock.getRemainingByBatch(house.id);

    const report = await services.reconcile.run(house.id);

    // 8/20~8/22 세 끼니만 식단시간이 지났다. 이관된 셋은 손대지 않는다.
    expect(report.consumedMealIds).toHaveLength(3);
    const afterRemaining = await services.stock.getRemainingByBatch(house.id);
    for (const [batchId, before] of beforeRemaining) {
      expect(before - afterRemaining.get(batchId)!).toBe(3);
    }
    const migrated = await services.prisma.meal.findMany({
      where: { householdId: house.id, migrated: true },
      select: { status: true, ledgerEntries: { select: { id: true } } },
    });
    expect(migrated.map((meal) => [meal.status, meal.ledgerEntries.length])).toEqual([
      ['consumed', 0],
      ['consumed', 0],
      ['consumed', 0],
    ]);
  });

  it('이관된 식단의 재료는 도입 상태에서 급여로 세어진다', async () => {
    const house = await household();
    await services.mealPlanImport.commit(command(house));

    const statuses = await services.reaction.getIntroductionStatus(house.id);
    const beef = statuses.find((status) => status.name === '소고기');
    // 이관된 세 끼니를 먹였지만 반응 기록은 없으므로 검증중 미기록이다.
    expect(beef?.status.kind).toBe('verifying');
    expect(statuses.find((status) => status.name === '애호박')?.status.kind).toBe('not_introduced');
  });

  it('이관 경계 다음 날 식단은 식단시간이 지나면 차감된다', async () => {
    const house = await household();
    for (const name of ['쌀', '오트밀', '소고기']) {
      await services.stock.registerCookedBatch({
        householdId: house.id,
        actor: house.actor,
        ingredientName: name,
        cubeWeightGram: name === '쌀' ? 30 : 10,
        cookedOn: localDate('2026-08-16'),
        cubes: 20,
      });
    }
    await services.mealPlanImport.commit(command(house));
    await services.reconcile.run(house.id);

    const fourth = await services.prisma.meal.findFirst({
      where: { householdId: house.id, mealOrder: 4 },
      select: { status: true, ledgerEntries: { select: { delta: true } } },
    });
    expect(fourth?.status).toBe('consumed');
    expect(fourth?.ledgerEntries.map((entry) => entry.delta)).toEqual([-1, -1, -1]);
  });

  it('이관 경계가 없으면 전부 예정으로 들어간다', async () => {
    const house = await household();
    await services.mealPlanImport.commit(command(house, { fedThrough: null }));

    const meals = await services.prisma.meal.findMany({
      where: { householdId: house.id },
      select: { status: true, migrated: true },
    });
    expect(meals.every((meal) => meal.status === 'planned' && !meal.migrated)).toBe(true);
  });

  it('식단이 이미 있는 끼니에는 이관할 수 없다', async () => {
    const house = await household();
    await services.mealPlan.appendMeals({
      householdId: house.id,
      actor: house.actor,
      slot: 'morning',
      meals: rows(1),
    });

    await expect(services.mealPlanImport.commit(command(house))).rejects.toThrow(ApplicationError);
    expect(await services.prisma.meal.count({ where: { householdId: house.id } })).toBe(1);
  });

  it('이관 경계가 없으면 이미 식단이 있어도 뒤에 이어 붙인다', async () => {
    const house = await household();
    await services.mealPlan.appendMeals({
      householdId: house.id,
      actor: house.actor,
      slot: 'morning',
      meals: rows(2),
    });

    const imported = await services.mealPlanImport.commit(
      command(house, { fedThrough: null, meals: rows(2) }),
    );

    expect(imported.map((meal) => meal.order)).toEqual([3, 4]);
  });

  it('미급여가 있으면 이관 판정의 날짜도 그것을 건너뛰며 계산된다', async () => {
    const house = await household();
    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate('2026-08-18'),
      slot: 'morning',
      thawed: false,
      reason: '감기',
    });

    const preview = await services.mealPlanImport.preview(command(house));

    // 8/18을 건너뛰므로 두 번째 식단은 8/19이고, 이관 대상은 두 개뿐이다.
    expect(preview.meals.map((meal) => meal.date)).toEqual([
      '2026-08-17',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
    ]);
    expect(preview.meals.filter((meal) => meal.migrated)).toHaveLength(2);
  });

  it('설정되지 않은 끼니는 거부한다', async () => {
    const house = await household();
    await expect(
      services.mealPlanImport.commit(command(house, { slot: 'afternoon' })),
    ).rejects.toThrow(DomainError);
  });

  it('등록되지 않은 재료명은 거부하고 아무 식단도 남기지 않는다', async () => {
    const house = await household();
    await expect(
      services.mealPlanImport.commit(
        command(house, {
          meals: [
            { composition: { baseMenuName: MENU_NAME, toppingIngredientNames: ['소고기'] } },
            { composition: { baseMenuName: MENU_NAME, toppingIngredientNames: ['당근'] } },
          ],
        }),
      ),
    ).rejects.toThrow(DomainError);

    expect(await services.prisma.meal.count({ where: { householdId: house.id } })).toBe(0);
  });

  it('같은 멱등키로 두 번 확정해도 식단이 한 번만 들어간다', async () => {
    const house = await household();
    const withKey = command(house, { idempotencyKey: 'import-1' });

    const first = await services.mealPlanImport.commit(withKey);
    const second = await services.mealPlanImport.commit(withKey);

    expect(second).toEqual(first);
    expect(await services.prisma.meal.count({ where: { householdId: house.id } })).toBe(6);
  });

  it('메모를 그대로 보관한다', async () => {
    const house = await household();
    await services.mealPlanImport.commit(command(house));

    const first = await services.prisma.meal.findFirst({
      where: { householdId: house.id, mealOrder: 1 },
      select: { memo: true },
    });
    expect(first?.memo).toBe('(소량)');
  });
});

describe('이관 뒤의 달력', () => {
  it('이관된 식단도 날짜와 일차가 붙어 보인다', async () => {
    const house = await household();
    await services.mealPlanImport.commit(command(house));

    const view = await services.mealPlan.getMealPlan(
      house.id,
      localDate('2026-08-17'),
      localDate('2026-08-19'),
    );

    expect(view.days.map((day) => [day.date, day.dayNumber])).toEqual([
      ['2026-08-17', 1],
      ['2026-08-18', 2],
      ['2026-08-19', 3],
    ]);
    expect(view.days.every((day) => day.slots[0]?.meal?.migrated === true)).toBe(true);
  });

  it('이관 시점의 재고는 입고로 따로 맞춘다', async () => {
    const house = await household();
    await services.mealPlanImport.commit(command(house));
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: localDate('2026-09-20'),
      cubes: 8,
    });

    const status = await services.stock.getStockStatus(house.id);
    const beef = status.ingredients.find(
      (stock) => stock.ingredientId === house.ingredientId('소고기'),
    );
    expect(beef?.total).toBe(8);
  });
});

describe('새로 시작한 끼니로의 이관', () => {
  it('오후 끼니를 열고 그 끼니에만 이관할 수 있다', async () => {
    const house = await household();
    await services.mealSlot.start({
      householdId: house.id,
      actor: house.actor,
      slot: 'afternoon',
      startDate: localDate('2026-09-01'),
      mealTime: localTime('17:00'),
    });

    const imported = await services.mealPlanImport.commit(
      command(house, {
        slot: 'afternoon',
        meals: rows(3),
        fedThrough: localDate('2026-09-02'),
      }),
    );

    expect(imported.map((meal) => [meal.date, meal.migrated])).toEqual([
      ['2026-09-01', true],
      ['2026-09-02', true],
      ['2026-09-03', false],
    ]);
  });
});
