export type IngredientCategory = 'base' | 'meat' | 'vegetable' | 'high_risk_allergen';

/** How stock of the ingredient is counted. Pantry ingredients are never cooked into cubes. */
export type StockTracking = 'cubes' | 'pantry';

export interface Ingredient {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly category: IngredientCategory;
  /** Current weight of one serving. One serving is one cube. */
  readonly servingWeightGram: number;
  /**
   * `pantry` ingredients (peanut butter, egg, flour) are always at hand, so meals never deduct
   * them, nothing is held for them, and they appear in no stock table or forecast.
   */
  readonly stockTracking: StockTracking;
  /**
   * Ingredients a blend cube is made of, such as 쌀 and 오트밀 for "쌀오트밀". Empty for a plain
   * ingredient. A blend is still one stock unit: batches, deduction and forecast use its own id.
   * Only what the baby ate is read through this list (ADR 0011).
   */
  readonly constituentIngredientIds: readonly string[];
}

/** A blend is an ingredient that has constituents. */
export function isBlend(ingredient: Ingredient): boolean {
  return ingredient.constituentIngredientIds.length > 0;
}

/** Number of cubes of one ingredient. */
export interface CubeNeed {
  readonly ingredientId: string;
  readonly cubes: number;
}
