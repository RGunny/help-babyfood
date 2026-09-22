import { FeedingReaction } from '../../domain/ingredient/introduction-status.js';
import { Meal } from '../../domain/meal-plan/meal.js';

/** One reaction a parent recorded for an ingredient of a meal. */
export interface RecordedReaction {
  readonly mealId: string;
  readonly ingredientId: string;
  readonly result: FeedingReaction;
}

/**
 * Everything ever fed, which is what introduction status is computed from.
 *
 * This is the one read that grows with history: the third clear feeding of an ingredient may sit
 * anywhere in the past, so the window the write path uses cannot answer it. It is a read-only path
 * (introduction status, meal plan warnings, the daily brief), never part of a write transaction.
 */
export interface FeedingHistory {
  /** Meals already fed, including the ones migrated from the spreadsheet. */
  readonly consumedMeals: readonly Meal[];
  readonly reactions: readonly RecordedReaction[];
  /** Registered at migration as verified before the service existed, with no feeding recorded. */
  readonly verifiedBeforeMigrationIds: ReadonlySet<string>;
}

export interface FeedingHistoryPort {
  load(householdId: string): Promise<FeedingHistory>;
}
