import { IngredientDraft } from '../../src/application/ports/household-write.port.js';
import { DomainError } from '../../src/domain/errors.js';
import { PrismaHouseholdStateRepository } from '../../src/infrastructure/prisma/household-state.repository.js';
import { PrismaHouseholdWriter } from '../../src/infrastructure/prisma/household-writer.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { TestServices, at, buildServices, seedHousehold, seedHouseholdOnly } from './setup/fixtures.js';

// registerBlend가 아직 없으므로 writer로 직접 넣는다. fixtures의 TestServices는 writer를
// 내놓지 않아, buildServices와 같은 방식으로 여기서 조립한다.
let services: TestServices;
let writer: PrismaHouseholdWriter;

beforeAll(() => {
  services = buildServices(at('2026-08-17', '09:00'));
  // buildServices가 만든 PrismaService를 PrismaClient 타입으로 내놓으므로 되돌려 받는다.
  const prisma = services.prisma as PrismaService;
  writer = new PrismaHouseholdWriter(prisma, new PrismaHouseholdStateRepository(90), services.clock);
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

const draft = (name: string, constituentIngredientIds: string[] = []): IngredientDraft => ({
  name,
  aliases: [],
  category: 'base',
  servingWeightGram: 30,
  stockTracking: 'cubes',
  constituentIngredientIds,
  verifiedBeforeMigration: false,
});

describe('합침 재료 영속화', () => {
  it('합침 재료를 넣고 다시 적재하면 구성 재료 id가 그대로 돌아온다', async () => {
    const house = await seedHouseholdOnly(services.prisma);
    const request = { householdId: house.id, actor: house.actor, operation: 'test' };

    const { blend, constituentIds } = await writer.write(request, async (context) => {
      const rice = await context.insertIngredient(draft('쌀'));
      const oatmeal = await context.insertIngredient(draft('오트밀'));
      const constituentIds = [rice.id, oatmeal.id];
      const blend = await context.insertIngredient(draft('쌀오트밀', constituentIds));
      return { blend, constituentIds };
    });
    expect(blend.constituentIngredientIds).toEqual(constituentIds);

    const loaded = await writer.write(request, async (context) => {
      const state = await context.load();
      return state.ingredients.find((ingredient) => ingredient.id === blend.id);
    });
    // 적재 순서는 id 순이고 uuid v7이라 등록 순서와 같다.
    expect(loaded?.constituentIngredientIds).toEqual(constituentIds);
    expect(
      await services.prisma.ingredientConstituent.count({ where: { blendIngredientId: blend.id } }),
    ).toBe(2);
  });

  it('구성 재료가 없는 재료는 빈 배열로 적재된다', async () => {
    const house = await seedHouseholdOnly(services.prisma);
    const request = { householdId: house.id, actor: house.actor, operation: 'test' };

    const rice = await writer.write(request, async (context) => await context.insertIngredient(draft('쌀')));

    const loaded = await writer.write(request, async (context) => {
      const state = await context.load();
      return state.ingredients.find((ingredient) => ingredient.id === rice.id);
    });
    expect(loaded?.constituentIngredientIds).toEqual([]);
  });
});

describe('합침 재료 등록', () => {
  type Household = Awaited<ReturnType<typeof seedHousehold>>;

  const registerBlend = async (house: Household, name: string, constituentNames: string[]) =>
    await services.ingredient.registerBlend({
      householdId: house.id,
      actor: house.actor,
      name,
      category: 'base',
      servingWeightGram: 40,
      constituentNames,
    });

  it('구성 재료 이름을 풀어 합침 재료를 등록한다', async () => {
    const house = await seedHousehold(services, { mealCount: 0 });

    const blend = await registerBlend(house, '쌀오트밀', ['쌀', '오트밀']);

    expect(blend).toMatchObject({
      name: '쌀오트밀',
      category: 'base',
      servingWeightGram: 40,
      stockTracking: 'cubes',
      constituentIngredientIds: [house.ingredientId('쌀'), house.ingredientId('오트밀')],
    });
    const constituents = await services.prisma.ingredientConstituent.findMany({
      where: { blendIngredientId: blend.id },
    });
    expect(constituents.map((row) => row.constituentIngredientId).sort()).toEqual(
      [house.ingredientId('쌀'), house.ingredientId('오트밀')].sort(),
    );
  });

  it('등록되지 않은 재료는 구성 재료가 될 수 없다', async () => {
    const house = await seedHousehold(services, { mealCount: 0 });

    await expect(registerBlend(house, '쌀현미', ['쌀', '현미'])).rejects.toMatchObject({
      code: 'UNKNOWN_INGREDIENT',
    });
    expect(await services.prisma.ingredient.count({ where: { householdId: house.id, name: '쌀현미' } })).toBe(0);
  });

  it('구성 재료가 하나뿐이면 등록할 수 없다', async () => {
    const house = await seedHousehold(services, { mealCount: 0 });

    await expect(registerBlend(house, '쌀만', ['쌀'])).rejects.toMatchObject({ code: 'INVALID_BLEND' });
    // 별칭으로 같은 재료를 두 번 가리켜도 구성 재료는 하나다.
    await expect(registerBlend(house, '브로콜리둘', ['브로콜리', '브로컬리'])).rejects.toMatchObject({
      code: 'INVALID_BLEND',
    });
    expect(
      await services.prisma.ingredient.count({
        where: { householdId: house.id, name: { in: ['쌀만', '브로콜리둘'] } },
      }),
    ).toBe(0);
  });

  it('합침 재료는 다른 합침 재료의 구성 재료가 될 수 없다', async () => {
    const house = await seedHousehold(services, { mealCount: 0 });
    await registerBlend(house, '쌀오트밀', ['쌀', '오트밀']);

    await expect(registerBlend(house, '쌀오트밀소고기', ['쌀오트밀', '소고기'])).rejects.toThrow(DomainError);
    await expect(registerBlend(house, '쌀오트밀소고기', ['쌀오트밀', '소고기'])).rejects.toMatchObject({
      code: 'INVALID_BLEND',
    });
  });

  it('이미 있는 이름으로는 합침 재료를 등록할 수 없다', async () => {
    const house = await seedHousehold(services, { mealCount: 0 });

    await expect(registerBlend(house, '브로컬리', ['쌀', '오트밀'])).rejects.toMatchObject({
      code: 'DUPLICATE_INGREDIENT_NAME',
    });
  });

  it('도입 상태 조회는 합침 재료를 구성 재료 이름과 함께 돌려준다', async () => {
    const house = await seedHousehold(services, { mealCount: 0 });
    const blend = await registerBlend(house, '쌀오트밀', ['쌀', '오트밀']);

    const rows = await services.reaction.getIntroductionStatus(house.id);

    expect(rows.find((row) => row.name === '쌀오트밀')).toEqual({
      ingredientId: blend.id,
      name: '쌀오트밀',
      status: { kind: 'blend', constituentNames: ['쌀', '오트밀'] },
      stockTracking: 'cubes',
    });
    expect(rows.find((row) => row.name === '쌀')?.status).toEqual({ kind: 'not_introduced' });
  });
});
