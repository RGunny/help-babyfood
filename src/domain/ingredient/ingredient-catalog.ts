import { DomainError } from '../errors.js';
import { Ingredient } from './ingredient.js';

/** Resolves ingredient names and aliases so that "브로컬리" and "브로콜리" are one ingredient. */
export class IngredientCatalog {
  private readonly byId = new Map<string, Ingredient>();
  private readonly byKey = new Map<string, Ingredient>();

  constructor(ingredients: readonly Ingredient[]) {
    for (const ingredient of ingredients) {
      this.byId.set(ingredient.id, ingredient);
      for (const label of [ingredient.name, ...ingredient.aliases]) {
        const key = normalizeIngredientName(label);
        const owner = this.byKey.get(key);
        if (owner && owner.id !== ingredient.id) {
          throw new DomainError(
            'DUPLICATE_INGREDIENT_NAME',
            `"${label}"은 이미 "${owner.name}"의 이름 또는 별칭입니다`,
          );
        }
        this.byKey.set(key, ingredient);
      }
    }
  }

  findByName(nameOrAlias: string): Ingredient | null {
    return this.byKey.get(normalizeIngredientName(nameOrAlias)) ?? null;
  }

  getById(id: string): Ingredient {
    const ingredient = this.byId.get(id);
    if (!ingredient) {
      throw new DomainError('UNKNOWN_INGREDIENT', `등록되지 않은 재료입니다: ${id}`);
    }
    return ingredient;
  }

  /** Names that cannot be resolved. An import must be rejected while this is non-empty. */
  findUnknownNames(names: readonly string[]): string[] {
    return [...new Set(names.filter((name) => this.findByName(name) === null))];
  }
}

export function normalizeIngredientName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}
