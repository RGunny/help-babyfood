export type IngredientCategory = 'base' | 'meat' | 'vegetable' | 'high_risk_allergen';

export interface Ingredient {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly category: IngredientCategory;
  /** Current weight of one serving. One serving is one cube. */
  readonly servingWeightGram: number;
}

/** Number of cubes of one ingredient. */
export interface CubeNeed {
  readonly ingredientId: string;
  readonly cubes: number;
}
