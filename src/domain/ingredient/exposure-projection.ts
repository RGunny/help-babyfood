import {
  CLEAR_FEEDINGS_TO_VERIFY,
  FeedingReaction,
  IntroductionStatus,
  nextExposureNumber,
} from './introduction-status.js';

/** One meal of the window, in feeding order, with what is known about it. */
export interface ExposureMeal {
  readonly mealId: string;
  /** Every ingredient the meal is made of, base menu expanded. */
  readonly ingredientIds: readonly string[];
  /** True when the meal has been fed. A planned meal is assumed to go well. */
  readonly fed: boolean;
  /** Reactions a parent recorded for this meal, by ingredient. Empty for a planned meal. */
  readonly reactions: ReadonlyMap<string, FeedingReaction>;
}

export interface ExposureProjectionInput {
  /** Status of each ingredient at the start of the window. An ingredient not listed is not introduced. */
  readonly initialStatuses: ReadonlyMap<string, IntroductionStatus>;
  /** Meals in date order; on one date the morning meal comes first. */
  readonly meals: readonly ExposureMeal[];
}

/** Ingredient id → exposure number, for the ingredients of one meal that still need watching. */
export type MealExposures = ReadonlyMap<string, number>;

/**
 * The "1회차", "2회차" the calendar shows on every meal of a window, past and future.
 *
 * `nextExposureNumber` answers for today only, from the recorded history. Walking forward needs one
 * more rule, and it is a rule rather than a rendering choice: a meal not yet fed is taken to go
 * well and moves the count on, while a meal already fed with no reaction recorded does not, since
 * chapter 4.6 counts only feedings recorded as clear. A recorded reaction ends the count.
 *
 * What comes back is the exposure number each ingredient has at each meal, only for the ingredients
 * that need observation there. A verified or reacted ingredient never appears.
 */
export function projectExposures(input: ExposureProjectionInput): Map<string, MealExposures> {
  const statuses = new Map(input.initialStatuses);
  const result = new Map<string, MealExposures>();

  for (const meal of input.meals) {
    const exposures = new Map<string, number>();
    for (const ingredientId of meal.ingredientIds) {
      const status = statuses.get(ingredientId) ?? { kind: 'not_introduced' };
      const exposureNumber = nextExposureNumber(status);
      if (exposureNumber !== null) exposures.set(ingredientId, exposureNumber);
      statuses.set(ingredientId, advanceIntroduction(status, outcomeOf(meal, ingredientId)));
    }
    result.set(meal.mealId, exposures);
  }
  return result;
}

/** What one feeding did for the ingredient's introduction. */
export type FeedingOutcome = 'clear' | 'reacted' | 'unrecorded';

function outcomeOf(meal: ExposureMeal, ingredientId: string): FeedingOutcome {
  if (!meal.fed) return 'clear';
  return meal.reactions.get(ingredientId) ?? 'unrecorded';
}

/**
 * The status after one more feeding with the given outcome. The same rule as `introductionStatus`,
 * applied one feeding at a time instead of over the whole list.
 */
export function advanceIntroduction(status: IntroductionStatus, outcome: FeedingOutcome): IntroductionStatus {
  if (outcome === 'reacted') return { kind: 'reacted' };
  if (status.kind === 'verified' || status.kind === 'reacted') return status;

  const clearCount = (status.kind === 'verifying' ? status.clearCount : 0) + (outcome === 'clear' ? 1 : 0);
  const unrecordedCount =
    (status.kind === 'verifying' ? status.unrecordedCount : 0) + (outcome === 'unrecorded' ? 1 : 0);
  if (clearCount >= CLEAR_FEEDINGS_TO_VERIFY) return { kind: 'verified' };
  return { kind: 'verifying', clearCount, unrecordedCount };
}
