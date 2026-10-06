import { Ingredient, isBlend } from '../domain/ingredient/ingredient.js';
import { IngredientCatalog } from '../domain/ingredient/ingredient-catalog.js';
import {
  IngredientFeeding,
  IntroductionStatus,
  introductionStatus,
} from '../domain/ingredient/introduction-status.js';
import { Meal, effectiveComposition } from '../domain/meal-plan/meal.js';
import { MealCalendar } from '../domain/meal-plan/meal-calendar.js';
import { Menu, expandToEatenIngredientIds } from '../domain/menu/menu.js';
import { LocalDate } from '../domain/shared/local-date.js';
import { FeedingHistory } from './ports/feeding-history.port.js';

/**
 * Turns the feeding history into per-ingredient introduction status.
 *
 * A meal counts with what was really fed, not with what was planned: a meal corrected to a different
 * topping introduced that topping and not the planned one. `effectiveComposition` is the same rule
 * deduction uses, so the two cannot drift apart. A blend counts as its constituents and has no status
 * of its own, so it is left out of the result (ADR 0011).
 */
export function introductionStatuses(
  history: FeedingHistory,
  ingredients: readonly Ingredient[],
  menus: ReadonlyMap<string, Menu>,
  catalog: IngredientCatalog,
): Map<string, IntroductionStatus> {
  const feedingsByIngredient = new Map<string, IngredientFeeding[]>();
  for (const meal of history.consumedMeals) {
    for (const ingredientId of ingredientIdsOf(meal, menus, catalog)) {
      const reaction = history.reactions.find(
        (recorded) => recorded.mealId === meal.id && recorded.ingredientId === ingredientId,
      );
      const feedings = feedingsByIngredient.get(ingredientId) ?? [];
      feedings.push({ reaction: reaction?.result ?? null });
      feedingsByIngredient.set(ingredientId, feedings);
    }
  }

  return new Map(
    ingredients
      .filter((ingredient) => !isBlend(ingredient))
      .map((ingredient) => [
        ingredient.id,
        introductionStatus({
          feedings: feedingsByIngredient.get(ingredient.id) ?? [],
          verifiedBeforeMigration: history.verifiedBeforeMigrationIds.has(ingredient.id),
        }),
      ]),
  );
}

/**
 * Ingredients the baby had already eaten before `date`.
 *
 * `validateMealPlan` needs this to tell a first introduction from a repeat: without it, every
 * ingredient of the first day it looks at would count as new. Ingredients registered as verified at
 * migration belong here too, since they were fed before the service existed.
 */
export function fedIngredientIdsBefore(
  history: FeedingHistory,
  calendar: MealCalendar,
  menus: ReadonlyMap<string, Menu>,
  catalog: IngredientCatalog,
  date: LocalDate,
): Set<string> {
  const fed = new Set(history.verifiedBeforeMigrationIds);
  for (const meal of history.consumedMeals) {
    if (!calendar.hasSlot(meal.slot) || calendar.dateOf(meal.slot, meal.order) >= date) continue;
    for (const ingredientId of ingredientIdsOf(meal, menus, catalog)) fed.add(ingredientId);
  }
  return fed;
}

export function reactedIngredientIds(statuses: ReadonlyMap<string, IntroductionStatus>): Set<string> {
  return new Set(
    [...statuses].filter(([, status]) => status.kind === 'reacted').map(([ingredientId]) => ingredientId),
  );
}

/** Ingredients one meal fed, base menu and blends expanded. Cube counts do not matter for introduction. */
export function ingredientIdsOf(
  meal: Meal,
  menus: ReadonlyMap<string, Menu>,
  catalog: IngredientCatalog,
): string[] {
  return expandToEatenIngredientIds(effectiveComposition(meal), menus, catalog);
}
