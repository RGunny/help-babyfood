import { ApplicationError } from '../../src/application/errors.js';
import { DomainError } from '../../src/domain/errors.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { localTime } from '../../src/domain/shared/local-time.js';
import { TestServices, at, buildServices, seedHousehold } from './setup/fixtures.js';

let services: TestServices;

beforeAll(() => {
  services = buildServices(at('2026-08-17', '09:00'));
});

// 시각을 옮기는 테스트가 있으므로 매번 되돌린다.
afterEach(() => {
  services.clock.set('2026-08-17', '09:00');
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

const household = () => seedHousehold(services, { mealCount: 0 });

type Household = Awaited<ReturnType<typeof household>>;

const register = async (house: Household, name: string, components: [string, number][]) =>
  await services.menu.register({
    householdId: house.id,
    actor: house.actor,
    name,
    components: components.map(([ingredientName, cubes]) => ({ ingredientName, cubes })),
  });

const componentsOf = async (menuId: string) =>
  (
    await services.prisma.menuComponent.findMany({ where: { menuId }, orderBy: { cubes: 'desc' } })
  ).map((component) => [component.ingredientId, component.cubes]);

describe('메뉴 등록', () => {
  it('이름과 구성 큐브가 그대로 왕복한다', async () => {
    const house = await household();
    const menu = await register(house, '쌀밀가루죽', [['쌀', 1]]);

    const menus = await services.menu.getMenus(house.id);
    expect(menus.find((candidate) => candidate.id === menu.id)).toEqual({
      id: menu.id,
      name: '쌀밀가루죽',
      components: [{ ingredientId: house.ingredientId('쌀'), cubes: 1 }],
    });
  });

  it('같은 재료를 두 번 적으면 큐브 수를 합친다', async () => {
    const house = await household();
    const menu = await register(house, '쌀곱빼기죽', [
      ['쌀', 1],
      ['쌀', 2],
    ]);
    expect(menu.components).toEqual([{ ingredientId: house.ingredientId('쌀'), cubes: 3 }]);
    expect(await componentsOf(menu.id)).toEqual([[house.ingredientId('쌀'), 3]]);
  });

  it('별칭으로 적어도 같은 재료를 가리킨다', async () => {
    const house = await household();
    const menu = await register(house, '브로콜리죽', [['브로컬리', 1]]);
    expect(menu.components).toEqual([{ ingredientId: house.ingredientId('브로콜리'), cubes: 1 }]);
  });

  it('이미 있는 이름은 거부한다', async () => {
    const house = await household();
    await expect(register(house, '쌀오트밀죽', [['쌀', 1]])).rejects.toThrow(ApplicationError);
  });

  it('등록되지 않은 재료명은 거부한다', async () => {
    const house = await household();
    await expect(register(house, '파프리카죽', [['파프리카', 1]])).rejects.toThrow(DomainError);
  });

  it('큐브 수가 0 이하면 거부한다', async () => {
    const house = await household();
    await expect(register(house, '빈죽', [['쌀', 0]])).rejects.toThrow(ApplicationError);
  });

  it('거부된 등록은 메뉴도 구성도 남기지 않는다', async () => {
    const house = await household();
    const before = await services.prisma.menu.count({ where: { householdId: house.id } });
    await expect(register(house, '파프리카죽', [['파프리카', 1]])).rejects.toThrow();
    expect(await services.prisma.menu.count({ where: { householdId: house.id } })).toBe(before);
  });
});

describe('메뉴 수정', () => {
  it('구성을 통째로 갈아 끼우고 남은 행이 없다', async () => {
    const house = await household();
    const menu = await register(house, '쌀밀가루죽', [
      ['쌀', 1],
      ['오트밀', 2],
    ]);

    const updated = await services.menu.update({
      householdId: house.id,
      actor: house.actor,
      currentName: '쌀밀가루죽',
      name: '쌀밀가루죽',
      components: [{ ingredientName: '쌀', cubes: 1 }],
    });

    expect(updated.components).toEqual([{ ingredientId: house.ingredientId('쌀'), cubes: 1 }]);
    expect(await componentsOf(menu.id)).toEqual([[house.ingredientId('쌀'), 1]]);
  });

  it('이름을 바꿀 수 있다', async () => {
    const house = await household();
    const menu = await register(house, '쌀밀가루죽', [['쌀', 1]]);
    await services.menu.update({
      householdId: house.id,
      actor: house.actor,
      currentName: '쌀밀가루죽',
      name: '쌀밀죽',
      components: [{ ingredientName: '쌀', cubes: 1 }],
    });

    const menus = await services.menu.getMenus(house.id);
    expect(menus.find((candidate) => candidate.id === menu.id)?.name).toBe('쌀밀죽');
  });

  it('다른 메뉴가 쓰는 이름으로는 바꿀 수 없다', async () => {
    const house = await household();
    await register(house, '쌀밀가루죽', [['쌀', 1]]);
    await expect(
      services.menu.update({
        householdId: house.id,
        actor: house.actor,
        currentName: '쌀밀가루죽',
        name: '쌀오트밀죽',
        components: [{ ingredientName: '쌀', cubes: 1 }],
      }),
    ).rejects.toThrow(ApplicationError);
  });

  it('등록되지 않은 메뉴는 거부한다', async () => {
    const house = await household();
    await expect(
      services.menu.update({
        householdId: house.id,
        actor: house.actor,
        currentName: '없는죽',
        name: '없는죽',
        components: [{ ingredientName: '쌀', cubes: 1 }],
      }),
    ).rejects.toThrow(DomainError);
  });

  it('구성이 바뀌면 이후 차감 수량도 바뀐다', async () => {
    const house = await household();
    await services.menu.update({
      householdId: house.id,
      actor: house.actor,
      currentName: '쌀오트밀죽',
      name: '쌀오트밀죽',
      components: [
        { ingredientName: '쌀', cubes: 2 },
        { ingredientName: '오트밀', cubes: 1 },
      ],
    });
    for (const name of ['쌀', '오트밀']) {
      await services.stock.registerCookedBatch({
        householdId: house.id,
        actor: house.actor,
        ingredientName: name,
        cubeWeightGram: name === '쌀' ? 30 : 10,
        cookedOn: localDate('2026-08-15'),
        cubes: 5,
      });
    }
    await services.mealPlan.appendMeals({
      householdId: house.id,
      actor: house.actor,
      slot: 'morning',
      meals: [{ composition: { baseMenuName: '쌀오트밀죽', toppingIngredientNames: [] } }],
    });

    services.clock.set('2026-08-17', '11:00');
    await services.reconcile.run(house.id);

    const status = await services.stock.getStockStatus(house.id);
    const remaining = (name: string) =>
      status.ingredients.find((row) => row.ingredientId === house.ingredientId(name))?.total;
    expect(remaining('쌀')).toBe(3);
    expect(remaining('오트밀')).toBe(4);
  });
});

describe('끼니 시작', () => {
  it('시작하면 그 날짜부터 식단이 배치된다', async () => {
    const house = await household();
    await services.mealSlot.start({
      householdId: house.id,
      actor: house.actor,
      slot: 'afternoon',
      startDate: localDate('2026-08-20'),
      mealTime: localTime('18:00'),
    });

    const schedules = await services.mealSlot.getSchedules(house.id);
    expect(schedules).toEqual([
      { slot: 'morning', startDate: localDate('2026-08-17'), mealTime: localTime('10:00') },
      { slot: 'afternoon', startDate: localDate('2026-08-20'), mealTime: localTime('18:00') },
    ]);
  });

  it('이미 시작한 끼니는 거부한다', async () => {
    const house = await household();
    await expect(
      services.mealSlot.start({
        householdId: house.id,
        actor: house.actor,
        slot: 'morning',
        startDate: localDate('2026-09-01'),
        mealTime: localTime('10:00'),
      }),
    ).rejects.toThrow(DomainError);
  });

  it('거부된 시작은 설정을 바꾸지 않는다', async () => {
    const house = await household();
    await expect(
      services.mealSlot.start({
        householdId: house.id,
        actor: house.actor,
        slot: 'morning',
        startDate: localDate('2026-09-01'),
        mealTime: localTime('07:00'),
      }),
    ).rejects.toThrow();
    const schedules = await services.mealSlot.getSchedules(house.id);
    expect(schedules).toEqual([
      { slot: 'morning', startDate: localDate('2026-08-17'), mealTime: localTime('10:00') },
    ]);
  });
});
