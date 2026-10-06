import { IngredientDraft } from '../../src/application/ports/household-write.port.js';
import { PrismaHouseholdStateRepository } from '../../src/infrastructure/prisma/household-state.repository.js';
import { PrismaHouseholdWriter } from '../../src/infrastructure/prisma/household-writer.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { TestServices, at, buildServices, seedHouseholdOnly } from './setup/fixtures.js';

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
