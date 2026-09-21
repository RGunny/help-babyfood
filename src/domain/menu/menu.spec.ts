import { DomainError } from '../errors.js';
import { Menu, expandToCubeNeeds } from './menu.js';

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
});
