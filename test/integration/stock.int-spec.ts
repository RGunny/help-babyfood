import { DomainError } from '../../src/domain/errors.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { ApplicationError } from '../../src/application/errors.js';
import { TestServices, at, buildServices, seedHousehold } from './setup/fixtures.js';

let services: TestServices;

beforeAll(() => {
  services = buildServices(at('2026-08-17', '09:00'));
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

const household = () => seedHousehold(services, { mealCount: 3 });

const receive = async (
  house: Awaited<ReturnType<typeof household>>,
  ingredientName: string,
  cubes: number,
  overrides: { cookedOn?: string; cubeWeightGram?: number; idempotencyKey?: string } = {},
) =>
  await services.stock.registerCookedBatch({
    householdId: house.id,
    actor: house.actor,
    ingredientName,
    cubeWeightGram: overrides.cubeWeightGram ?? 15,
    cookedOn: localDate(overrides.cookedOn ?? '2026-08-15'),
    cubes,
    idempotencyKey: overrides.idempotencyKey,
  });

const remainingOf = async (batchId: string) =>
  (await services.prisma.cookedBatch.findUniqueOrThrow({ where: { id: batchId } })).remainingCubes;

const ledgerSum = async (batchId: string) =>
  (await services.prisma.stockLedgerEntry.aggregate({ where: { batchId }, _sum: { delta: true } }))._sum.delta ?? 0;

describe('입고', () => {
  it('배치와 입고 이벤트가 함께 기록되고 잔여 수량이 맞는다', async () => {
    const house = await household();
    const batch = await receive(house, '브로콜리', 12);

    expect(batch.cookedOn).toBe(localDate('2026-08-15'));
    expect(await remainingOf(batch.id)).toBe(12);
    expect(await ledgerSum(batch.id)).toBe(12);
  });

  it('별칭으로 입고해도 같은 재료의 배치가 된다', async () => {
    const house = await household();
    const batch = await receive(house, '브로컬리', 5);
    expect(batch.ingredientId).toBe(house.ingredientId('브로콜리'));
  });

  it('공백과 대소문자 차이를 무시하고 재료를 찾는다', async () => {
    const house = await household();
    const batch = await receive(house, ' 브로콜리 ', 5);
    expect(batch.ingredientId).toBe(house.ingredientId('브로콜리'));
  });

  it('마스터에 없는 재료명은 거부한다', async () => {
    const house = await household();
    await expect(receive(house, '파프리카', 5)).rejects.toThrow(DomainError);
  });

  it('거부된 입고는 배치도 원장도 남기지 않는다', async () => {
    const house = await household();
    await expect(receive(house, '파프리카', 5)).rejects.toThrow();
    expect(await services.prisma.cookedBatch.count({ where: { householdId: house.id } })).toBe(0);
    expect(await services.prisma.stockLedgerEntry.count({ where: { householdId: house.id } })).toBe(0);
  });

  it('입고한 수행자가 원장에 남는다', async () => {
    const house = await household();
    const batch = await receive(house, '브로콜리', 12);
    const entry = await services.prisma.stockLedgerEntry.findFirstOrThrow({ where: { batchId: batch.id } });
    expect(entry.actorSource).toBe('member');
    expect(entry.actorMemberId).toBe(house.memberId);
  });
});

describe('입고 멱등키', () => {
  it('같은 키로 두 번 부르면 배치는 하나고 응답이 같다', async () => {
    const house = await household();
    const first = await receive(house, '브로콜리', 12, { idempotencyKey: 'cook-001' });
    const second = await receive(house, '브로콜리', 12, { idempotencyKey: 'cook-001' });

    expect(second).toEqual(first);
    expect(await services.prisma.cookedBatch.count({ where: { householdId: house.id } })).toBe(1);
    expect(await remainingOf(first.id)).toBe(12);
  });

  it('키가 다르면 배치가 따로 생긴다', async () => {
    const house = await household();
    await receive(house, '브로콜리', 12, { idempotencyKey: 'cook-001' });
    await receive(house, '브로콜리', 12, { idempotencyKey: 'cook-002' });
    expect(await services.prisma.cookedBatch.count({ where: { householdId: house.id } })).toBe(2);
  });

  it('같은 키에 다른 내용이 오면 거부한다', async () => {
    const house = await household();
    await receive(house, '브로콜리', 12, { idempotencyKey: 'cook-001' });
    await expect(receive(house, '브로콜리', 6, { idempotencyKey: 'cook-001' })).rejects.toThrow(
      ApplicationError,
    );
  });

  it('멱등키는 가정마다 따로 센다', async () => {
    const one = await household();
    const two = await household();
    const first = await receive(one, '브로콜리', 12, { idempotencyKey: 'cook-001' });
    const second = await receive(two, '브로콜리', 12, { idempotencyKey: 'cook-001' });
    expect(second.id).not.toBe(first.id);
  });
});

describe('실사 조정', () => {
  it('세어 보니 적으면 차이만큼 줄인다', async () => {
    const house = await household();
    const batch = await receive(house, '브로콜리', 12);
    await services.stock.adjustStockByCount({
      householdId: house.id,
      actor: house.actor,
      batchId: batch.id,
      countedCubes: 9,
      reason: '떨어뜨림',
    });
    expect(await remainingOf(batch.id)).toBe(9);
    expect(await ledgerSum(batch.id)).toBe(9);
  });

  it('수량이 같으면 이벤트를 만들지 않는다', async () => {
    const house = await household();
    const batch = await receive(house, '브로콜리', 12);
    await services.stock.adjustStockByCount({
      householdId: house.id,
      actor: house.actor,
      batchId: batch.id,
      countedCubes: 12,
      reason: null,
    });
    expect(await services.prisma.stockLedgerEntry.count({ where: { batchId: batch.id } })).toBe(1);
  });

  it('폐기로 0이 된 배치도 다시 세어 되돌릴 수 있다', async () => {
    const house = await household();
    const batch = await receive(house, '브로콜리', 12);
    await services.stock.discardBatch({
      householdId: house.id,
      actor: house.actor,
      batchId: batch.id,
      reason: 'expired',
    });
    expect(await remainingOf(batch.id)).toBe(0);

    await services.stock.adjustStockByCount({
      householdId: house.id,
      actor: house.actor,
      batchId: batch.id,
      countedCubes: 3,
      reason: '아직 남아 있었다',
    });
    expect(await remainingOf(batch.id)).toBe(3);
    expect(await ledgerSum(batch.id)).toBe(3);
  });

  it('실사 수량이 음수면 거부한다', async () => {
    const house = await household();
    const batch = await receive(house, '브로콜리', 12);
    await expect(
      services.stock.adjustStockByCount({
        householdId: house.id,
        actor: house.actor,
        batchId: batch.id,
        countedCubes: -1,
        reason: null,
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe('폐기', () => {
  it('남은 수량만큼만 차감한다', async () => {
    const house = await household();
    const batch = await receive(house, '브로콜리', 12);
    await services.stock.adjustStockByCount({
      householdId: house.id,
      actor: house.actor,
      batchId: batch.id,
      countedCubes: 4,
      reason: null,
    });
    await services.stock.discardBatch({
      householdId: house.id,
      actor: house.actor,
      batchId: batch.id,
      reason: 'expired',
    });

    expect(await remainingOf(batch.id)).toBe(0);
    const discard = await services.prisma.stockLedgerEntry.findFirstOrThrow({
      where: { batchId: batch.id, type: 'discarded' },
    });
    expect(discard.delta).toBe(-4);
  });

  it('남은 큐브가 없으면 폐기할 수 없다', async () => {
    const house = await household();
    const batch = await receive(house, '브로콜리', 12);
    await services.stock.discardBatch({
      householdId: house.id,
      actor: house.actor,
      batchId: batch.id,
      reason: 'expired',
    });
    await expect(
      services.stock.discardBatch({
        householdId: house.id,
        actor: house.actor,
        batchId: batch.id,
        reason: 'expired',
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe('재고현황', () => {
  it('폐기 대기도 합계에 넣고 내역을 따로 보인다', async () => {
    const house = await household();
    // 임계일 14일. 2026-08-01 조리는 2026-08-15가 임계일이라 8/17에는 폐기 대기다.
    await receive(house, '브로콜리', 3, { cookedOn: '2026-08-01' });
    await receive(house, '브로콜리', 9, { cookedOn: '2026-08-15' });

    const status = await services.stock.getStockStatus(house.id);
    const broccoli = status.ingredients.find((row) => row.ingredientId === house.ingredientId('브로콜리'));
    expect(broccoli).toMatchObject({ total: 12, fresh: 9, overdue: 3 });
  });

  it('중량이 다른 배치는 합계에 들어가되 따로 센다', async () => {
    const house = await household();
    await receive(house, '브로콜리', 4, { cubeWeightGram: 20 });
    const status = await services.stock.getStockStatus(house.id);
    const broccoli = status.ingredients.find((row) => row.ingredientId === house.ingredientId('브로콜리'));
    expect(broccoli).toMatchObject({ total: 4, weightMismatched: 4 });
  });

  it('재고가 없는 재료도 0으로 나온다', async () => {
    const house = await household();
    const status = await services.stock.getStockStatus(house.id);
    expect(status.ingredients).toHaveLength(5);
    expect(status.ingredients.every((row) => row.total === 0)).toBe(true);
  });
});
