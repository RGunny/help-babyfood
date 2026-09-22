import { ApplicationError } from '../../src/application/errors.js';
import { DomainError } from '../../src/domain/errors.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { TestServices, at, buildServices, seedHouseholdOnly } from './setup/fixtures.js';

let services: TestServices;

beforeAll(() => {
  services = buildServices(at('2026-08-17', '09:00'));
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

const household = () => seedHouseholdOnly(services.prisma);

type Household = Awaited<ReturnType<typeof household>>;

const register = async (
  house: Household,
  name: string,
  overrides: { aliases?: string[]; servingWeightGram?: number; verifiedBeforeMigration?: boolean } = {},
) =>
  await services.ingredient.register({
    householdId: house.id,
    actor: house.actor,
    name,
    aliases: overrides.aliases,
    category: 'vegetable',
    servingWeightGram: overrides.servingWeightGram ?? 15,
    verifiedBeforeMigration: overrides.verifiedBeforeMigration,
  });

describe('재료 등록', () => {
  it('대표 이름이 라벨 0번으로 들어가고 별칭이 순서대로 이어진다', async () => {
    const house = await household();
    const ingredient = await register(house, '브로콜리', { aliases: ['브로컬리', '브로코리'] });

    const labels = await services.prisma.ingredientLabel.findMany({
      where: { ingredientId: ingredient.id },
      orderBy: { position: 'asc' },
    });
    expect(labels.map((label) => [label.label, label.isCanonical, label.position])).toEqual([
      ['브로콜리', true, 0],
      ['브로컬리', false, 1],
      ['브로코리', false, 2],
    ]);
  });

  it('정규화한 호칭을 함께 저장한다', async () => {
    const house = await household();
    const ingredient = await register(house, '브로 콜리');
    const label = await services.prisma.ingredientLabel.findFirstOrThrow({
      where: { ingredientId: ingredient.id },
    });
    expect(label.normalizedLabel).toBe('브로콜리');
  });

  it('등록한 재료는 이름으로도 별칭으로도 찾힌다', async () => {
    const house = await household();
    await register(house, '브로콜리', { aliases: ['브로컬리'] });
    const batch = await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: '브로컬리',
      cubeWeightGram: 15,
      cookedOn: localDate('2026-08-15'),
      cubes: 3,
    });
    expect(batch.id).toBeDefined();
  });

  it('같은 이름을 두 번 등록하면 거부한다', async () => {
    const house = await household();
    await register(house, '브로콜리');
    await expect(register(house, '브로콜리')).rejects.toThrow(DomainError);
  });

  it('다른 재료의 별칭과 겹치는 이름은 거부한다', async () => {
    const house = await household();
    await register(house, '브로콜리', { aliases: ['브로컬리'] });
    await expect(register(house, '브로컬리')).rejects.toThrow(DomainError);
  });

  it('공백만 다른 이름도 같은 호칭으로 보고 거부한다', async () => {
    const house = await household();
    await register(house, '브로콜리');
    await expect(register(house, '브로 콜리')).rejects.toThrow(DomainError);
  });

  it('거부된 등록은 재료도 라벨도 남기지 않는다', async () => {
    const house = await household();
    await register(house, '브로콜리');
    await expect(register(house, '브로콜리')).rejects.toThrow();
    expect(await services.prisma.ingredient.count({ where: { householdId: house.id } })).toBe(1);
    expect(await services.prisma.ingredientLabel.count({ where: { householdId: house.id } })).toBe(1);
  });

  it('1회분 중량이 0 이하면 거부한다', async () => {
    const house = await household();
    await expect(register(house, '브로콜리', { servingWeightGram: 0 })).rejects.toThrow(ApplicationError);
  });

  it('가정이 다르면 같은 이름을 쓸 수 있다', async () => {
    const one = await household();
    const two = await household();
    await register(one, '브로콜리');
    await expect(register(two, '브로콜리')).resolves.toBeDefined();
  });

  it('이관 때 검증완료로 등록한 재료는 급여 이력이 없어도 검증완료다', async () => {
    const house = await household();
    await register(house, '완두콩', { verifiedBeforeMigration: true });
    const statuses = await services.reaction.getIntroductionStatus(house.id);
    expect(statuses).toEqual([{ ingredientId: expect.any(String), name: '완두콩', status: { kind: 'verified' } }]);
  });
});

describe('별칭 추가', () => {
  it('저장된 라벨 뒤에 이어 붙인다', async () => {
    const house = await household();
    const ingredient = await register(house, '브로콜리', { aliases: ['브로컬리'] });
    const updated = await services.ingredient.addAlias({
      householdId: house.id,
      actor: house.actor,
      name: '브로콜리',
      alias: '브로코리',
    });

    expect(updated.aliases).toEqual(['브로컬리', '브로코리']);
    const labels = await services.prisma.ingredientLabel.findMany({
      where: { ingredientId: ingredient.id },
      orderBy: { position: 'asc' },
    });
    expect(labels.map((label) => label.position)).toEqual([0, 1, 2]);
  });

  it('별칭으로 가리켜도 같은 재료에 붙는다', async () => {
    const house = await household();
    const ingredient = await register(house, '브로콜리', { aliases: ['브로컬리'] });
    const updated = await services.ingredient.addAlias({
      householdId: house.id,
      actor: house.actor,
      name: '브로컬리',
      alias: '브로코리',
    });
    expect(updated.id).toBe(ingredient.id);
  });

  it('다른 재료가 이미 쓰는 호칭은 거부한다', async () => {
    const house = await household();
    await register(house, '브로콜리');
    await register(house, '애호박');
    await expect(
      services.ingredient.addAlias({
        householdId: house.id,
        actor: house.actor,
        name: '애호박',
        alias: '브로콜리',
      }),
    ).rejects.toThrow(DomainError);
  });

  it('등록되지 않은 재료에는 붙일 수 없다', async () => {
    const house = await household();
    await expect(
      services.ingredient.addAlias({
        householdId: house.id,
        actor: house.actor,
        name: '파프리카',
        alias: '파프리까',
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe('1회분 중량 변경', () => {
  it('바꾼 중량이 저장된다', async () => {
    const house = await household();
    const ingredient = await register(house, '브로콜리', { servingWeightGram: 15 });
    const updated = await services.ingredient.updateServingWeight({
      householdId: house.id,
      actor: house.actor,
      name: '브로콜리',
      servingWeightGram: 20,
    });

    expect(updated.servingWeightGram).toBe(20);
    const row = await services.prisma.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } });
    expect(row.servingWeightGram).toBe(20);
  });

  it('중량이 바뀌면 옛 배치가 재고현황에서 중량 불일치로 잡힌다', async () => {
    const house = await household();
    const ingredient = await register(house, '브로콜리', { servingWeightGram: 15 });
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: '브로콜리',
      cubeWeightGram: 15,
      cookedOn: localDate('2026-08-15'),
      cubes: 6,
    });

    const before = await services.stock.getStockStatus(house.id);
    expect(before.ingredients[0]).toMatchObject({ total: 6, weightMismatched: 0 });

    await services.ingredient.updateServingWeight({
      householdId: house.id,
      actor: house.actor,
      name: '브로콜리',
      servingWeightGram: 20,
    });

    const after = await services.stock.getStockStatus(house.id);
    expect(after.ingredients[0]).toMatchObject({
      ingredientId: ingredient.id,
      total: 6,
      weightMismatched: 6,
    });
  });

  it('0 이하의 중량은 거부한다', async () => {
    const house = await household();
    await register(house, '브로콜리');
    await expect(
      services.ingredient.updateServingWeight({
        householdId: house.id,
        actor: house.actor,
        name: '브로콜리',
        servingWeightGram: -1,
      }),
    ).rejects.toThrow(ApplicationError);
  });
});
