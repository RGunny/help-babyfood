import { DomainError } from '../errors.js';
import { CubeNeed } from '../ingredient/ingredient.js';

/** A named base such as "쌀오트밀죽", made of ingredient cubes. */
export interface Menu {
  readonly id: string;
  readonly name: string;
  readonly components: readonly CubeNeed[];
}

/** What one meal is made of: an optional base menu plus toppings, one cube each. */
export interface MealComposition {
  readonly baseMenuId: string | null;
  readonly toppingIngredientIds: readonly string[];
}

/** Expands a meal into cubes per ingredient, merging an ingredient that appears more than once. */
export function expandToCubeNeeds(composition: MealComposition, menus: ReadonlyMap<string, Menu>): CubeNeed[] {
  const cubesByIngredient = new Map<string, number>();
  const add = (ingredientId: string, cubes: number) =>
    cubesByIngredient.set(ingredientId, (cubesByIngredient.get(ingredientId) ?? 0) + cubes);

  if (composition.baseMenuId !== null) {
    const menu = menus.get(composition.baseMenuId);
    if (!menu) {
      throw new DomainError('UNKNOWN_MENU', `등록되지 않은 메뉴입니다: ${composition.baseMenuId}`);
    }
    for (const component of menu.components) add(component.ingredientId, component.cubes);
  }
  for (const ingredientId of composition.toppingIngredientIds) add(ingredientId, 1);

  return [...cubesByIngredient].map(([ingredientId, cubes]) => ({ ingredientId, cubes }));
}
