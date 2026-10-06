import { DomainError } from '../errors.js';
import { Ingredient } from '../ingredient/ingredient.js';
import { IngredientCatalog } from '../ingredient/ingredient-catalog.js';
import { Menu, expandToCubeNeeds, expandToEatenIngredientIds } from './menu.js';

const menus = new Map<string, Menu>([
  ['rice-porridge', { id: 'rice-porridge', name: '쌀죽', components: [{ ingredientId: 'rice', cubes: 1 }] }],
  [
    'rice-oatmeal-porridge',
    {
      id: 'rice-oatmeal-porridge',
      name: '쌀오트밀죽',
      components: [
        { ingredientId: 'rice', cubes: 1 },
        { ingredientId: 'oatmeal', cubes: 1 },
      ],
    },
  ],
  [
    'rice-flour-porridge',
    {
      id: 'rice-flour-porridge',
      name: '쌀밀가루죽',
      components: [
        { ingredientId: 'rice', cubes: 1 },
        { ingredientId: 'flour', cubes: 1 },
      ],
    },
  ],
  [
    'rice-oatmeal-blend-porridge',
    {
      id: 'rice-oatmeal-blend-porridge',
      name: '쌀오트밀합침죽',
      components: [{ ingredientId: 'rice-oatmeal', cubes: 1 }],
    },
  ],
  [
    'oatmeal-blend-porridge',
    {
      id: 'oatmeal-blend-porridge',
      name: '오트밀합침죽',
      components: [
        { ingredientId: 'oatmeal', cubes: 1 },
        { ingredientId: 'rice-oatmeal', cubes: 1 },
      ],
    },
  ],
]);

const ingredient = (id: string, constituentIngredientIds: string[] = []): Ingredient => ({
  id,
  name: id,
  aliases: [],
  category: 'base',
  servingWeightGram: 30,
  stockTracking: 'cubes',
  constituentIngredientIds,
});
const catalog = new IngredientCatalog([
  ingredient('rice'),
  ingredient('oatmeal'),
  ingredient('beef'),
  ingredient('rice-oatmeal', ['rice', 'oatmeal']),
]);

describe('식단을 큐브 필요량으로 풀기', () => {
  it('베이스도 토핑도 없으면 필요한 큐브가 없다', () => {
    expect(expandToCubeNeeds({ baseMenuId: null, toppingIngredientIds: [] }, menus)).toEqual([]);
  });

  it('쌀죽은 쌀 큐브 1개다', () => {
    expect(expandToCubeNeeds({ baseMenuId: 'rice-porridge', toppingIngredientIds: [] }, menus)).toEqual([
      { ingredientId: 'rice', cubes: 1 },
    ]);
  });

  it('쌀오트밀죽은 쌀 큐브 1개와 오트밀 큐브 1개다', () => {
    expect(expandToCubeNeeds({ baseMenuId: 'rice-oatmeal-porridge', toppingIngredientIds: [] }, menus)).toEqual([
      { ingredientId: 'rice', cubes: 1 },
      { ingredientId: 'oatmeal', cubes: 1 },
    ]);
  });

  it('토핑은 재료마다 큐브 1개씩 더한다', () => {
    expect(
      expandToCubeNeeds(
        { baseMenuId: 'rice-oatmeal-porridge', toppingIngredientIds: ['beef', 'broccoli', 'cabbage'] },
        menus,
      ),
    ).toEqual([
      { ingredientId: 'rice', cubes: 1 },
      { ingredientId: 'oatmeal', cubes: 1 },
      { ingredientId: 'beef', cubes: 1 },
      { ingredientId: 'broccoli', cubes: 1 },
      { ingredientId: 'cabbage', cubes: 1 },
    ]);
  });

  it('쌀밀가루죽에 밀가루 토핑을 더하면 밀가루는 2개로 합쳐진다', () => {
    expect(expandToCubeNeeds({ baseMenuId: 'rice-flour-porridge', toppingIngredientIds: ['flour'] }, menus)).toEqual([
      { ingredientId: 'rice', cubes: 1 },
      { ingredientId: 'flour', cubes: 2 },
    ]);
  });

  it('베이스 없이 토핑만 있는 식단도 풀 수 있다', () => {
    expect(expandToCubeNeeds({ baseMenuId: null, toppingIngredientIds: ['beef'] }, menus)).toEqual([
      { ingredientId: 'beef', cubes: 1 },
    ]);
  });

  it('등록되지 않은 메뉴는 오류다', () => {
    expect(() => expandToCubeNeeds({ baseMenuId: 'unknown', toppingIngredientIds: [] }, menus)).toThrow(DomainError);
  });

  it('합침 재료가 든 메뉴의 큐브 필요량은 합침 재료 그대로다', () => {
    expect(expandToCubeNeeds({ baseMenuId: 'rice-oatmeal-blend-porridge', toppingIngredientIds: [] }, menus)).toEqual([
      { ingredientId: 'rice-oatmeal', cubes: 1 },
    ]);
  });
});

describe('식단을 먹인 재료로 풀기', () => {
  const eaten = (baseMenuId: string | null, toppingIngredientIds: string[] = []) =>
    expandToEatenIngredientIds({ baseMenuId, toppingIngredientIds }, menus, catalog);

  it('합침 재료가 없는 식단은 큐브 필요량의 재료 그대로다', () => {
    expect(eaten('rice-oatmeal-porridge', ['beef'])).toEqual(['rice', 'oatmeal', 'beef']);
    expect(eaten(null)).toEqual([]);
  });

  it('합침 재료가 든 메뉴를 먹이면 구성 재료를 먹인 것이다', () => {
    expect(eaten('rice-oatmeal-blend-porridge', ['beef'])).toEqual(['rice', 'oatmeal', 'beef']);
  });

  it('한 끼에 합침 재료와 그 구성 재료가 함께 있어도 구성 재료의 급여는 한 번으로 센다', () => {
    expect(eaten('rice-oatmeal-blend-porridge', ['rice'])).toEqual(['rice', 'oatmeal']);
    expect(eaten('oatmeal-blend-porridge')).toEqual(['oatmeal', 'rice']);
  });

  it('카탈로그에 없는 재료가 든 식단은 오류다', () => {
    expect(() => eaten('rice-porridge', ['pumpkin'])).toThrow(DomainError);
  });
});
