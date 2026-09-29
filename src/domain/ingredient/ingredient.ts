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
}

/** Number of cubes of one ingredient. */
export interface CubeNeed {
  readonly ingredientId: string;
  readonly cubes: number;
}
