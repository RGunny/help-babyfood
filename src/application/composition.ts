import { DomainError } from '../domain/errors.js';
import { MealComposition } from '../domain/menu/menu.js';
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
 * so that the two paths cannot start accepting different names.
 */
export function resolveComposition(state: HouseholdState, input: CompositionInput): MealComposition {
  const baseMenuId =
    input.baseMenuName === null
      ? null
      : ([...state.menus.values()].find((menu) => menu.name === input.baseMenuName)?.id ??
        raise('UNKNOWN_MENU', `등록되지 않은 메뉴입니다: ${input.baseMenuName}`));

  return {
    baseMenuId,
    toppingIngredientIds: input.toppingIngredientNames.map(
      (name) =>
        state.catalog.findByName(name)?.id ?? raise('UNKNOWN_INGREDIENT', `등록되지 않은 재료입니다: ${name}`),
    ),
  };
}

function raise(code: 'UNKNOWN_MENU' | 'UNKNOWN_INGREDIENT', message: string): never {
  throw new DomainError(code, message);
}
