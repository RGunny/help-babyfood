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
    data: { householdId, name: '브로콜리', category: 'vegetable', servingWeightGram, stockTracking: 'cubes' },
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
        data: { householdId, name: '소고기', category: 'meat', servingWeightGram: 0, stockTracking: 'cubes' },
      }),
    ).rejects.toThrow(/serving_weight_gram/);
  });
});

describe('재료 이름과 별칭', () => {
  it('같은 가정에서 한 호칭은 한 재료에만 붙는다', async () => {
    const { id: householdId } = await household();
    const { id: broccoli } = await ingredient(householdId);
    const { id: zucchini } = await prisma.ingredient.create({
      data: { householdId, name: '애호박', category: 'vegetable', servingWeightGram: 15, stockTracking: 'cubes' },
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
      prisma.ingredient.create({ data: { householdId, name: '소고기', category: 'meat', servingWeightGram: 10, stockTracking: 'cubes' }, select: { id: true } }),
      prisma.ingredient.create({ data: { householdId, name: '고구마', category: 'vegetable', servingWeightGram: 15, stockTracking: 'cubes' }, select: { id: true } }),
    ]);
    const [low, high] = ids.map((row) => row.id).sort();
    await expect(
      prisma.forbiddenPairing.create({
        data: { householdId, ingredientAId: high, ingredientBId: low, scope: 'same_meal' },
      }),
    ).rejects.toThrow(/forbidden_pairing_order/);
  });
});

describe('구성원 토큰의 가정 일치', () => {
  const constraintExists = async (name: string) =>
    (
      await prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint WHERE conname = ${name}
      `
    ).length === 1;

  it('토큰의 구성원과 가정을 한 쌍으로 묶는 FK가 있다', async () => {
    expect(await constraintExists('member_token_member_household_fkey')).toBe(true);
  });

  it('복합 FK가 참조하는 구성원의 (id, 가정) 유니크가 있다', async () => {
    expect(await constraintExists('member_id_household_id_key')).toBe(true);
  });

  it('다른 가정의 구성원으로 토큰을 만들면 거부한다', async () => {
    const { id: ours } = await household();
    const { id: theirs } = await household();
    await prisma.member.create({ data: { householdId: ours, name: '엄마' } });
    const { id: stranger } = await prisma.member.create({
      data: { householdId: theirs, name: '아빠' },
      select: { id: true },
    });
    await expect(
      prisma.memberToken.create({
        data: {
          householdId: ours,
          memberId: stranger,
          tokenHash: 'a'.repeat(64),
          label: '엄마 노트북',
          expiresAt: new Date('2027-03-01T00:00:00Z'),
        },
      }),
    ).rejects.toThrow(/member_token_member_household_fkey/);
  });
});

describe('재고 알람 발송 이력', () => {
  const constraintNames = async (table: string) =>
    (
      await prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint WHERE conrelid = ${table}::regclass
      `
    ).map(({ conname }) => conname);

  it('재고 알람 발송 이력에 네 제약과 가정 FK가 걸려 있다', async () => {
    expect(await constraintNames('stock_alert_delivery')).toEqual(
      expect.arrayContaining([
        'stock_alert_delivery_attempts_check',
        'stock_alert_delivery_sent_check',
        'stock_alert_delivery_failed_check',
        'stock_alert_delivery_skipped_check',
        'stock_alert_delivery_household_id_fkey',
      ]),
    );
  });
});

describe('합침 재료의 구성', () => {
  const constraintNames = async (table: string) =>
    (
      await prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint WHERE conrelid = ${table}::regclass
      `
    ).map(({ conname }) => conname);

  const riceAndOatmeal = async () => {
    const { id: householdId } = await household();
    const [blend, rice, oatmeal] = await Promise.all(
      ['쌀오트밀', '쌀', '오트밀'].map((name) =>
        prisma.ingredient.create({
          data: { householdId, name, category: 'base', servingWeightGram: 20, stockTracking: 'cubes' },
          select: { id: true },
        }),
      ),
    );
    return { blend: blend.id, rice: rice.id, oatmeal: oatmeal.id };
  };

  it('합침 재료의 구성에 자기 자신 금지 제약과 두 FK가 걸려 있다', async () => {
    expect(await constraintNames('ingredient_constituent')).toEqual(
      expect.arrayContaining([
        'ingredient_constituent_not_self_check',
        'ingredient_constituent_blend_ingredient_id_fkey',
        'ingredient_constituent_constituent_ingredient_id_fkey',
      ]),
    );
  });

  it('합침 재료는 자기 자신을 구성 재료로 가질 수 없다', async () => {
    const { blend } = await riceAndOatmeal();
    await expect(
      prisma.ingredientConstituent.create({
        data: { blendIngredientId: blend, constituentIngredientId: blend },
      }),
    ).rejects.toThrow(/ingredient_constituent_not_self_check/);
  });

  it('같은 구성 재료를 두 번 넣을 수 없다', async () => {
    const { blend, rice } = await riceAndOatmeal();
    await prisma.ingredientConstituent.create({ data: { blendIngredientId: blend, constituentIngredientId: rice } });
    await expect(
      prisma.ingredientConstituent.create({ data: { blendIngredientId: blend, constituentIngredientId: rice } }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it('구성 재료로 쓰이는 재료는 지울 수 없고, 합침 재료를 지우면 구성 행도 지워진다', async () => {
    const { blend, rice, oatmeal } = await riceAndOatmeal();
    await prisma.ingredientConstituent.createMany({
      data: [
        { blendIngredientId: blend, constituentIngredientId: rice },
        { blendIngredientId: blend, constituentIngredientId: oatmeal },
      ],
    });

    await expect(prisma.ingredient.delete({ where: { id: rice } })).rejects.toThrow(
      /ingredient_constituent_constituent_ingredient_id_fkey/,
    );

    await prisma.ingredient.delete({ where: { id: blend } });
    expect(await prisma.ingredientConstituent.count({ where: { blendIngredientId: blend } })).toBe(0);
    expect(await prisma.ingredient.count({ where: { id: { in: [rice, oatmeal] } } })).toBe(2);
  });
});
