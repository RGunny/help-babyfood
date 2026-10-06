import { DomainError } from '../errors.js';
import { Ingredient, isBlend } from './ingredient.js';

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
    // Every ingredient is in `byId` by now, so a blend may be listed before its constituents.
    for (const ingredient of ingredients) {
      if (isBlend(ingredient)) this.assertValidBlend(ingredient);
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

  /** What feeding one cube of the ingredient fed: a blend's constituents, or the ingredient itself. */
  eatenIngredientIds(id: string): readonly string[] {
    const ingredient = this.getById(id);
    return isBlend(ingredient) ? ingredient.constituentIngredientIds : [ingredient.id];
  }

  /** Names that cannot be resolved. An import must be rejected while this is non-empty. */
  findUnknownNames(names: readonly string[]): string[] {
    return [...new Set(names.filter((name) => this.findByName(name) === null))];
  }

  /** A blend that passes is one level deep, so `eatenIngredientIds` never has to recurse. */
  private assertValidBlend(blend: Ingredient): void {
    const constituentIds = blend.constituentIngredientIds;
    if (constituentIds.length < 2) {
      throw new DomainError('INVALID_BLEND', `합침 재료 "${blend.name}"의 구성 재료는 둘 이상이어야 합니다`);
    }
    if (new Set(constituentIds).size !== constituentIds.length) {
      throw new DomainError('INVALID_BLEND', `합침 재료 "${blend.name}"의 구성 재료에 같은 재료가 두 번 있습니다`);
    }
    for (const constituentId of constituentIds) {
      if (constituentId === blend.id) {
        throw new DomainError('INVALID_BLEND', `합침 재료 "${blend.name}"은 자기 자신을 구성 재료로 가질 수 없습니다`);
      }
      const constituent = this.byId.get(constituentId);
      if (!constituent) {
        throw new DomainError(
          'INVALID_BLEND',
          `합침 재료 "${blend.name}"의 구성 재료가 등록되지 않은 재료입니다: ${constituentId}`,
        );
      }
      if (isBlend(constituent)) {
        throw new DomainError(
          'INVALID_BLEND',
          `합침 재료 "${blend.name}"의 구성 재료 "${constituent.name}"은 합침 재료입니다`,
        );
      }
    }
  }
}

export function normalizeIngredientName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}
