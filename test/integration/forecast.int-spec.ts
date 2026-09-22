import { localDate } from '../../src/domain/shared/local-date.js';
import { TestServices, at, buildServices, seedHousehold } from './setup/fixtures.js';

let services: TestServices;

beforeAll(() => {
  services = buildServices(at('2026-08-17', '09:00'));
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

type Household = Awaited<ReturnType<typeof seedHousehold>>;

const household = (mealCount = 3) => seedHousehold(services, { mealCount });

const receive = async (house: Household, name: string, cubes: number, cookedOn = '2026-08-15') =>
  await services.stock.registerCookedBatch({
    householdId: house.id,
    actor: house.actor,
    ingredientName: name,
    cubeWeightGram: name === '쌀' ? 30 : name === '오트밀' || name === '소고기' ? 10 : 15,
    cookedOn: localDate(cookedOn),
    cubes,
  });

const forecastOf = async (house: Household, name: string, until: string | null = null) =>
  (await services.forecast.forecast(house.id, until === null ? null : localDate(until))).find(
    (row) => row.ingredientId === house.ingredientId(name),
  );

describe('소진 예측', () => {
  it('예정 식단이 쓸 큐브 수를 센다', async () => {
    const house = await household(3);
    await receive(house, '브로콜리', 10);
    expect(await forecastOf(house, '브로콜리')).toMatchObject({ plannedCubes: 3, shortfallCubes: 0 });
  });

  it('재고가 모자라면 첫 부족 날짜와 부족 수량을 알려 준다', async () => {
    const house = await household(3);
    await receive(house, '브로콜리', 1);
    // 1번 식단은 8/17, 2번은 8/18이다.
    expect(await forecastOf(house, '브로콜리')).toMatchObject({
      firstShortageDate: localDate('2026-08-18'),
      shortfallCubes: 2,
    });
  });

  it('마지막 큐브를 쓰는 날짜를 소진일로 잡는다', async () => {
    const house = await household(3);
    await receive(house, '브로콜리', 2);
    expect(await forecastOf(house, '브로콜리')).toMatchObject({
      depletionDate: localDate('2026-08-18'),
      firstShortageDate: localDate('2026-08-19'),
    });
  });

  it('입고가 들어오면 부족이 사라진다', async () => {
    const house = await household(3);
    await receive(house, '브로콜리', 1);
    expect((await forecastOf(house, '브로콜리'))?.shortfallCubes).toBe(2);

    await receive(house, '브로콜리', 5);
    expect(await forecastOf(house, '브로콜리')).toMatchObject({
      shortfallCubes: 0,
      firstShortageDate: null,
    });
  });

  it('조리일이 식단 날짜보다 늦은 배치는 예측에서 쓰지 않는다', async () => {
    const house = await household(3);
    await receive(house, '브로콜리', 10, '2026-08-25');
    expect(await forecastOf(house, '브로콜리')).toMatchObject({ shortfallCubes: 3 });
  });

  it('중량이 다른 배치는 예측에서 쓰지 않는다', async () => {
    const house = await household(3);
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: '브로콜리',
      cubeWeightGram: 20,
      cookedOn: localDate('2026-08-15'),
      cubes: 10,
    });
    expect(await forecastOf(house, '브로콜리')).toMatchObject({ shortfallCubes: 3 });
  });

  it('기한을 주면 그 날짜까지의 식단만 본다', async () => {
    const house = await household(3);
    await receive(house, '브로콜리', 10);
    expect(await forecastOf(house, '브로콜리', '2026-08-18')).toMatchObject({ plannedCubes: 2 });
  });

  it('급여 완료 식단은 다시 세지 않는다', async () => {
    const house = await household(3);
    await receive(house, '브로콜리', 10);
    await receive(house, '소고기', 10);
    await receive(house, '쌀', 10);
    await receive(house, '오트밀', 10);

    services.clock.set('2026-08-17', '11:00');
    await services.reconcile.run(house.id);
    try {
      expect(await forecastOf(house, '브로콜리')).toMatchObject({ plannedCubes: 2 });
    } finally {
      services.clock.set('2026-08-17', '09:00');
    }
  });

  it('식단이 없으면 모든 재료가 0으로 나온다', async () => {
    const house = await household(0);
    const forecasts = await services.forecast.forecast(house.id);
    expect(forecasts).toHaveLength(5);
    expect(forecasts.every((row) => row.plannedCubes === 0 && row.shortfallCubes === 0)).toBe(true);
  });
});
