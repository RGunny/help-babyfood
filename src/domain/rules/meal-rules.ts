import { IngredientCatalog } from '../ingredient/ingredient-catalog.js';
import { CalendarDay } from '../meal-plan/calendar-projection.js';
import { Meal, effectiveComposition } from '../meal-plan/meal.js';
import { Menu, expandToEatenIngredientIds } from '../menu/menu.js';
import { LocalDate } from '../shared/local-date.js';
import { MealSlot } from '../shared/meal-slot.js';

export interface ForbiddenPairing {
  readonly ingredientIds: readonly [string, string];
  /** `same_meal`: never in one meal. `same_day`: never on one date, even in different slots. */
  readonly scope: 'same_meal' | 'same_day';
}

/** Constraints the server checks. Free-text guidance for the agent lives outside the domain. */
export interface MealPlanningRules {
  readonly forbiddenPairings: readonly ForbiddenPairing[];
  readonly maxFirstIntroductionsPerDay: number | null;
  /** New ingredients go in this slot so that parents can watch the baby during the day. */
  readonly firstIntroductionSlot: MealSlot | null;
}

export type RuleWarningCode =
  | 'FORBIDDEN_PAIRING'
  | 'TOO_MANY_FIRST_INTRODUCTIONS'
  | 'FIRST_INTRODUCTION_IN_WRONG_SLOT'
  | 'REACTED_INGREDIENT_PLANNED';

/** Warnings never block: parents may confirm a plan as it is. */
export interface RuleWarning {
  readonly code: RuleWarningCode;
  readonly date: LocalDate;
  /** Null when the warning is about the whole date. */
  readonly slot: MealSlot | null;
  readonly ingredientIds: readonly string[];
}

export interface ValidateMealPlanInput {
  /** Consecutive dates in ascending order, as `projectCalendar` returns them. */
  readonly days: readonly CalendarDay[];
  readonly menus: ReadonlyMap<string, Menu>;
  /** Resolves a blend to its constituents: every check below is about what the baby eats. */
  readonly catalog: IngredientCatalog;
  readonly rules: MealPlanningRules;
  /** Ingredients fed before the first day, including those registered as verified at migration. */
  readonly alreadyFedIngredientIds: ReadonlySet<string>;
  readonly reactedIngredientIds: ReadonlySet<string>;
}

/**
 * Checks planned meals against date-level constraints. Must run again after every shift:
 * when only one slot is postponed, meals that were never on the same date end up together.
 */
export function validateMealPlan(input: ValidateMealPlanInput): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  const fed = new Set(input.alreadyFedIngredientIds);

  for (const day of input.days) {
    const mealsOfDay = day.slots
      .filter((entry): entry is typeof entry & { meal: Meal } => entry.meal !== null)
      .map((entry) => ({
        slot: entry.slot,
        meal: entry.meal,
        ingredientIds: expandToEatenIngredientIds(effectiveComposition(entry.meal), input.menus, input.catalog),
      }));
    const hasPlannedMeal = mealsOfDay.some(({ meal }) => meal.status === 'planned');

    const firstIntroductionsOfDay: string[] = [];
    for (const { slot, meal, ingredientIds } of mealsOfDay) {
      const firstIntroductions = ingredientIds.filter((ingredientId) => !fed.has(ingredientId));
      ingredientIds.forEach((ingredientId) => fed.add(ingredientId));
      if (meal.status !== 'planned') continue;

      firstIntroductionsOfDay.push(...firstIntroductions);
      const expectedSlot = input.rules.firstIntroductionSlot;
      if (expectedSlot !== null && slot !== expectedSlot && firstIntroductions.length > 0) {
        warnings.push({
          code: 'FIRST_INTRODUCTION_IN_WRONG_SLOT',
          date: day.date,
          slot,
          ingredientIds: firstIntroductions,
        });
      }
      const reacted = ingredientIds.filter((ingredientId) => input.reactedIngredientIds.has(ingredientId));
      if (reacted.length > 0) {
        warnings.push({ code: 'REACTED_INGREDIENT_PLANNED', date: day.date, slot, ingredientIds: reacted });
      }
      for (const pairing of input.rules.forbiddenPairings) {
        if (pairing.scope === 'same_meal' && pairing.ingredientIds.every((id) => ingredientIds.includes(id))) {
          warnings.push({ code: 'FORBIDDEN_PAIRING', date: day.date, slot, ingredientIds: [...pairing.ingredientIds] });
        }
      }
    }

    const limit = input.rules.maxFirstIntroductionsPerDay;
    if (limit !== null && firstIntroductionsOfDay.length > limit) {
      warnings.push({
        code: 'TOO_MANY_FIRST_INTRODUCTIONS',
        date: day.date,
        slot: null,
        ingredientIds: firstIntroductionsOfDay,
      });
    }
    if (hasPlannedMeal) {
      const ingredientsOfDay = new Set(mealsOfDay.flatMap(({ ingredientIds }) => ingredientIds));
      for (const pairing of input.rules.forbiddenPairings) {
        if (pairing.scope === 'same_day' && pairing.ingredientIds.every((id) => ingredientsOfDay.has(id))) {
          warnings.push({
            code: 'FORBIDDEN_PAIRING',
            date: day.date,
            slot: null,
            ingredientIds: [...pairing.ingredientIds],
          });
        }
      }
    }
  }
  return warnings;
}
