import { DomainError } from '../errors.js';
import { MealComposition } from '../menu/menu.js';
import { MealSlot } from '../shared/meal-slot.js';

export type MealStatus = 'planned' | 'consumed';

/**
 * One entry of the meal plan. Its identity is the position in the slot (`order`), not a date:
 * the date is derived from the slot start date and the no-feed records.
 */
export interface Meal {
  readonly id: string;
  readonly slot: MealSlot;
  /** 1-based position within the slot. */
  readonly order: number;
  readonly planned: MealComposition;
  /** What was really fed, when it differs from the plan. */
  readonly actual: MealComposition | null;
  readonly memo: string | null;
  readonly status: MealStatus;
  /** Fed before the service existed. Counts as feeding history but never touches the ledger. */
  readonly migrated: boolean;
}

export function effectiveComposition(meal: Meal): MealComposition {
  return meal.actual ?? meal.planned;
}

/** Indexes meals by slot and order, rejecting duplicates and invalid orders. */
export function indexMealsBySlotOrder(meals: readonly Meal[]): Map<string, Meal> {
  const index = new Map<string, Meal>();
  for (const meal of meals) {
    if (!Number.isInteger(meal.order) || meal.order < 1) {
      throw new DomainError('INVALID_MEAL_ORDER', `식단 순서는 1 이상의 정수여야 합니다: ${meal.id}`);
    }
    const key = slotOrderKey(meal.slot, meal.order);
    if (index.has(key)) {
      throw new DomainError('INVALID_MEAL_ORDER', `같은 끼니에 순서가 겹칩니다: ${meal.slot} ${meal.order}`);
    }
    index.set(key, meal);
  }
  return index;
}

export function slotOrderKey(slot: MealSlot, order: number): string {
  return `${slot}#${order}`;
}
