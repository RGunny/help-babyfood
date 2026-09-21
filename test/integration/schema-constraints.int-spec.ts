import { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from './setup/database.js';

const prisma: PrismaClient = createPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

const household = async () =>
  prisma.household.create({ data: { name: '재하네' }, select: { id: true } });

const ingredient = async (householdId: string, servingWeightGram = 15) =>
  prisma.ingredient.create({
    data: { householdId, name: '브로콜리', category: 'vegetable', servingWeightGram },
    select: { id: true },
  });

const batch = async (householdId: string, ingredientId: string, remainingCubes = 0) =>
  prisma.cookedBatch.create({
    data: { householdId, ingredientId, cubeWeightGram: 15, cookedOn: new Date('2026-09-20'), remainingCubes },
    select: { id: true },
  });

describe('스키마가 살아 있다', () => {
  it('마이그레이션이 적용된 빈 DB에서 시작한다', async () => {
    expect(await prisma.household.count()).toBe(0);
    expect(await prisma.stockLedgerEntry.count()).toBe(0);
  });

  it('앞 테스트가 만든 행은 다음 테스트에 남지 않는다', async () => {
    await household();
    expect(await prisma.household.count()).toBe(1);
  });

  it('앞 테스트의 가정이 비워져 있다', async () => {
    expect(await prisma.household.count()).toBe(0);
  });
});

describe('원장 제약', () => {
  it('입고의 증감이 음수이면 거부한다', async () => {
    const { id: householdId } = await household();
    const { id: ingredientId } = await ingredient(householdId);
    const { id: batchId } = await batch(householdId, ingredientId);
    await expect(
      prisma.stockLedgerEntry.create({
        data: { householdId, batchId, type: 'received', delta: -1, actorSource: 'scheduler' },
      }),
    ).rejects.toThrow(/delta_sign/);
  });

  it('식단 소비의 증감이 양수이면 거부한다', async () => {
    const { id: householdId } = await household();
    const { id: ingredientId } = await ingredient(householdId);
    const { id: batchId } = await batch(householdId, ingredientId);
    const { id: mealId } = await prisma.meal.create({
      data: { householdId, slot: 'morning', mealOrder: 1 },
      select: { id: true },
    });
    await expect(
      prisma.stockLedgerEntry.create({
        data: { householdId, batchId, mealId, type: 'meal_consumed', delta: 1, actorSource: 'scheduler' },
      }),
    ).rejects.toThrow(/delta_sign/);
  });

  it('실사 조정의 증감이 0이면 거부한다', async () => {
    const { id: householdId } = await household();
    const { id: ingredientId } = await ingredient(householdId);
    const { id: batchId } = await batch(householdId, ingredientId);
    await expect(
      prisma.stockLedgerEntry.create({
        data: { householdId, batchId, type: 'count_adjusted', delta: 0, actorSource: 'scheduler' },
      }),
    ).rejects.toThrow(/delta_sign/);
  });

  it('식단 없는 소비 이벤트는 거부한다', async () => {
    const { id: householdId } = await household();
    const { id: ingredientId } = await ingredient(householdId);
    const { id: batchId } = await batch(householdId, ingredientId);
    await expect(
      prisma.stockLedgerEntry.create({
        data: { householdId, batchId, type: 'meal_consumed', delta: -1, actorSource: 'scheduler' },
      }),
    ).rejects.toThrow(/meal_required/);
  });

  it('수행자가 구성원인데 구성원 id가 없으면 거부한다', async () => {
    const { id: householdId } = await household();
    const { id: ingredientId } = await ingredient(householdId);
    const { id: batchId } = await batch(householdId, ingredientId);
    await expect(
      prisma.stockLedgerEntry.create({
        data: { householdId, batchId, type: 'received', delta: 1, actorSource: 'member' },
      }),
    ).rejects.toThrow(/actor_check/);
  });

  it('스케줄러 수행자에 구성원 id가 붙으면 거부한다', async () => {
    const { id: householdId } = await household();
    const { id: ingredientId } = await ingredient(householdId);
    const { id: batchId } = await batch(householdId, ingredientId);
    const { id: memberId } = await prisma.member.create({
      data: { householdId, name: '엄마' },
      select: { id: true },
    });
    await expect(
      prisma.stockLedgerEntry.create({
        data: {
          householdId,
          batchId,
          type: 'received',
          delta: 1,
          actorSource: 'scheduler',
          actorMemberId: memberId,
        },
      }),
    ).rejects.toThrow(/actor_check/);
  });
});

describe('재고 하한', () => {
  it('배치의 잔여 수량은 음수가 될 수 없다', async () => {
    const { id: householdId } = await household();
    const { id: ingredientId } = await ingredient(householdId);
    const { id: batchId } = await batch(householdId, ingredientId, 1);
    await expect(
      prisma.cookedBatch.update({ where: { id: batchId }, data: { remainingCubes: { decrement: 2 } } }),
    ).rejects.toThrow(/remaining_cubes/);
  });

  it('큐브 중량과 1회분 중량은 0보다 커야 한다', async () => {
    const { id: householdId } = await household();
    await expect(
      prisma.ingredient.create({
        data: { householdId, name: '소고기', category: 'meat', servingWeightGram: 0 },
      }),
    ).rejects.toThrow(/serving_weight_gram/);
  });
});

describe('재료 이름과 별칭', () => {
  it('같은 가정에서 한 호칭은 한 재료에만 붙는다', async () => {
    const { id: householdId } = await household();
    const { id: broccoli } = await ingredient(householdId);
    const { id: zucchini } = await prisma.ingredient.create({
      data: { householdId, name: '애호박', category: 'vegetable', servingWeightGram: 15 },
      select: { id: true },
    });
    await prisma.ingredientLabel.create({
      data: { householdId, ingredientId: broccoli, label: '브로콜리', normalizedLabel: '브로콜리', isCanonical: true, position: 0 },
    });
    await expect(
      prisma.ingredientLabel.create({
        data: { householdId, ingredientId: zucchini, label: '브로콜리', normalizedLabel: '브로콜리', isCanonical: false, position: 1 },
      }),
    ).rejects.toThrow();
  });

  it('대표 이름은 position 0 하나다', async () => {
    const { id: householdId } = await household();
    const { id: ingredientId } = await ingredient(householdId);
    await expect(
      prisma.ingredientLabel.create({
        data: { householdId, ingredientId, label: '브로컬리', normalizedLabel: '브로컬리', isCanonical: true, position: 1 },
      }),
    ).rejects.toThrow(/canonical/);
  });
});

describe('미급여와 식단', () => {
  it('같은 날짜와 끼니를 두 번 등록할 수 없다', async () => {
    const { id: householdId } = await household();
    const data = { householdId, date: new Date('2026-08-20'), slot: 'morning' as const, thawed: false };
    await prisma.noFeedRecord.create({ data });
    await expect(prisma.noFeedRecord.create({ data })).rejects.toThrow();
  });

  it('식단 순서는 1 이상이다', async () => {
    const { id: householdId } = await household();
    await expect(
      prisma.meal.create({ data: { householdId, slot: 'morning', mealOrder: 0 } }),
    ).rejects.toThrow(/meal_order/);
  });

  it('같은 끼니에 순서가 겹칠 수 없다', async () => {
    const { id: householdId } = await household();
    await prisma.meal.create({ data: { householdId, slot: 'morning', mealOrder: 1 } });
    await expect(
      prisma.meal.create({ data: { householdId, slot: 'morning', mealOrder: 1 } }),
    ).rejects.toThrow();
  });

  it('식단시간 형식이 HH:mm이 아니면 거부한다', async () => {
    const { id: householdId } = await household();
    await expect(
      prisma.slotSchedule.create({
        data: { householdId, slot: 'morning', startDate: new Date('2026-08-17'), mealTime: '9:00' },
      }),
    ).rejects.toThrow(/meal_time/);
  });
});

describe('식단 규칙', () => {
  it('조합 금지 쌍은 재료 id 순서로 정규화해야 한다', async () => {
    const { id: householdId } = await household();
    const ids = await Promise.all([
      prisma.ingredient.create({ data: { householdId, name: '소고기', category: 'meat', servingWeightGram: 10 }, select: { id: true } }),
      prisma.ingredient.create({ data: { householdId, name: '고구마', category: 'vegetable', servingWeightGram: 15 }, select: { id: true } }),
    ]);
    const [low, high] = ids.map((row) => row.id).sort();
    await expect(
      prisma.forbiddenPairing.create({
        data: { householdId, ingredientAId: high, ingredientBId: low, scope: 'same_meal' },
      }),
    ).rejects.toThrow(/forbidden_pairing_order/);
  });
});
