import { Ingredient } from '../ingredient/ingredient.js';
import { Meal, effectiveComposition } from '../meal-plan/meal.js';
import { MealCalendar } from '../meal-plan/meal-calendar.js';
import { Menu, expandToCubeNeeds } from '../menu/menu.js';
import { LocalDate } from '../shared/local-date.js';
import { compareDateTimes } from '../shared/local-time.js';
import { allocateOldestFirst, isDeductibleFor } from '../stock/allocation.js';
import { CookedBatch, LedgerEntry, remainingByBatch } from '../stock/ledger.js';

export interface IngredientForecast {
  readonly ingredientId: string;
  /** Cubes the planned meals will use within the horizon. */
  readonly plannedCubes: number;
  /** Date of the meal that uses the last deductible cube. Null when stock outlasts the plan. */
  readonly depletionDate: LocalDate | null;
  /** First meal date that stock cannot cover. Cooking must happen on or before this date. */
  readonly firstShortageDate: LocalDate | null;
  /** Cubes to cook so that every planned meal within the horizon is covered. */
  readonly shortfallCubes: number;
}

export interface ForecastInput {
  readonly ingredients: readonly Ingredient[];
  readonly meals: readonly Meal[];
  readonly calendar: MealCalendar;
  readonly menus: ReadonlyMap<string, Menu>;
  readonly batches: readonly CookedBatch[];
  readonly entries: readonly LedgerEntry[];
  /** Last date to look at. Null means the whole plan. */
  readonly until: LocalDate | null;
}

/**
 * Plays the planned meals against current stock with the same rules as real deduction.
 * A fixed threshold cannot tell beef used every day from cucumber used twice; the plan can.
 */
export function forecastShortage(input: ForecastInput): IngredientForecast[] {
  const ingredientById = new Map(input.ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const remaining = remainingByBatch(input.entries);
  const forecasts = new Map(
    input.ingredients.map((ingredient) => [
      ingredient.id,
      {
        ingredientId: ingredient.id,
        plannedCubes: 0,
        depletionDate: null as LocalDate | null,
        firstShortageDate: null as LocalDate | null,
        shortfallCubes: 0,
      },
    ]),
  );

  const upcoming = input.meals
    .filter((meal) => meal.status === 'planned' && !meal.migrated && input.calendar.hasSlot(meal.slot))
    .map((meal) => ({ meal, scheduledAt: input.calendar.scheduledAt(meal.slot, meal.order) }))
    .filter(({ scheduledAt }) => input.until === null || scheduledAt.date <= input.until)
    .sort((a, b) => compareDateTimes(a.scheduledAt, b.scheduledAt) || a.meal.id.localeCompare(b.meal.id));

  for (const { meal, scheduledAt } of upcoming) {
    for (const need of expandToCubeNeeds(effectiveComposition(meal), input.menus)) {
      const ingredient = ingredientById.get(need.ingredientId);
      const forecast = forecasts.get(need.ingredientId);
      if (!ingredient || !forecast) continue;

      forecast.plannedCubes += need.cubes;
      const allocations = allocateOldestFirst(ingredient, need.cubes, scheduledAt.date, input.batches, remaining);
      if (allocations === null) {
        forecast.firstShortageDate ??= scheduledAt.date;
        forecast.shortfallCubes += need.cubes;
        continue;
      }
      for (const allocation of allocations) {
        remaining.set(allocation.batchId, remaining.get(allocation.batchId)! - allocation.cubes);
      }
      const deductibleLeft = input.batches
        .filter((batch) => isDeductibleFor(batch, ingredient, scheduledAt.date, remaining.get(batch.id) ?? 0))
        .reduce((cubes, batch) => cubes + remaining.get(batch.id)!, 0);
      if (deductibleLeft === 0) forecast.depletionDate ??= scheduledAt.date;
    }
  }
  return [...forecasts.values()];
}
