import { DomainError } from '../domain/errors.js';
import { isBlend } from '../domain/ingredient/ingredient.js';
import { MealComposition } from '../domain/menu/menu.js';
import { ApplicationError } from './errors.js';
import { HouseholdState } from './household-state.js';

/** What a parent says a meal is made of, in the names they use. */
export interface CompositionInput {
  readonly baseMenuName: string | null;
  readonly toppingIngredientNames: readonly string[];
}

/**
 * Turns the names a parent used into the ids a meal stores.
 *
 * Names come from the parent, so unknown ones are rejected here rather than at deduction time: a
 * meal naming an ingredient the master does not have can never be deducted, and the stock count
 * would silently stop matching the freezer. Editing a meal and importing a spreadsheet share this
 * so that the two paths cannot start accepting different names. A blend is only a menu component: a
 * topping cell on the board shows one ingredient and has no room for a blend's constituents (ADR 0011).
 */
export function resolveComposition(state: HouseholdState, input: CompositionInput): MealComposition {
  const baseMenuId =
    input.baseMenuName === null
      ? null
      : ([...state.menus.values()].find((menu) => menu.name === input.baseMenuName)?.id ??
        raise('UNKNOWN_MENU', `등록되지 않은 메뉴입니다: ${input.baseMenuName}`));

  return {
    baseMenuId,
    toppingIngredientIds: input.toppingIngredientNames.map((name) => {
      const ingredient =
        state.catalog.findByName(name) ?? raise('UNKNOWN_INGREDIENT', `등록되지 않은 재료입니다: ${name}`);
      if (isBlend(ingredient)) {
        throw new ApplicationError(
          'BLEND_AS_TOPPING',
          `합침 재료는 메뉴 구성으로만 쓸 수 있습니다: ${ingredient.name}`,
        );
      }
      return ingredient.id;
    }),
  };
}

function raise(code: 'UNKNOWN_MENU' | 'UNKNOWN_INGREDIENT', message: string): never {
  throw new DomainError(code, message);
}
