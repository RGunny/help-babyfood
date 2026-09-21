export type FeedingReaction = 'clear' | 'reacted';

/** One consumed meal that contained the ingredient. `reaction` is null until a parent records it. */
export interface IngredientFeeding {
  readonly reaction: FeedingReaction | null;
}

export type IntroductionStatus =
  | { readonly kind: 'not_introduced' }
  | { readonly kind: 'verifying'; readonly clearCount: number; readonly unrecordedCount: number }
  | { readonly kind: 'verified' }
  | { readonly kind: 'reacted' };

export const CLEAR_FEEDINGS_TO_VERIFY = 2;

export interface IntroductionInput {
  readonly feedings: readonly IngredientFeeding[];
  /** Registered at migration as already verified before the service existed. */
  readonly verifiedBeforeMigration: boolean;
}

export function introductionStatus(input: IntroductionInput): IntroductionStatus {
  if (input.feedings.some((feeding) => feeding.reaction === 'reacted')) {
    return { kind: 'reacted' };
  }
  if (input.verifiedBeforeMigration) {
    return { kind: 'verified' };
  }
  if (input.feedings.length === 0) {
    return { kind: 'not_introduced' };
  }
  const clearCount = input.feedings.filter((feeding) => feeding.reaction === 'clear').length;
  if (clearCount >= CLEAR_FEEDINGS_TO_VERIFY) {
    return { kind: 'verified' };
  }
  return { kind: 'verifying', clearCount, unrecordedCount: input.feedings.length - clearCount };
}

/** Parents must watch the baby after a meal that contains an ingredient in this state. */
export function needsObservation(status: IntroductionStatus): boolean {
  return status.kind === 'not_introduced' || status.kind === 'verifying';
}

/** "1회차", "2회차" shown in the brief. Only feedings recorded as clear advance the number. */
export function nextExposureNumber(status: IntroductionStatus): number | null {
  if (status.kind === 'not_introduced') return 1;
  if (status.kind === 'verifying') return status.clearCount + 1;
  return null;
}
