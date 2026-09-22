import { LocalDate } from '../../domain/shared/local-date.js';
import { MealSlot } from '../../domain/shared/meal-slot.js';
import { DailyBrief } from '../daily-brief.js';

export interface ReactionPromptIngredient {
  readonly ingredientId: string;
  readonly name: string;
  readonly exposureNumber: number;
}

/** 4.6절의 후속 메시지. 그 끼니의 새 재료마다 반응 기록 버튼이 붙는다. */
export interface ReactionPrompt {
  readonly date: LocalDate;
  readonly slot: MealSlot;
  readonly ingredients: readonly ReactionPromptIngredient[];
}

/**
 * What one delivery came to.
 *
 * A failure is thrown, not returned: the caller has to write it down as failed and have it tried
 * again. `skipped` is the other thing, and it is not a failure. It means there is nowhere to send
 * this, the way a household with no channel linked has nowhere. Making that an exception would put
 * it in the retry queue and try it again every minute for a condition no retry can fix.
 */
export type DeliveryResult =
  { readonly kind: 'sent'; readonly reference: string } | { readonly kind: 'skipped'; readonly reason: string };

/**
 * Where a brief goes once it is built. This file does not know which messenger carries it.
 *
 * No channel, no message layout, no token appears here: the port says "deliver this brief" and
 * hands over the read model the application already has. Another way of reaching the parent is
 * another implementation, and the application does not change for it.
 *
 * `reference` is whatever points back at the message afterwards, so that a later message can refer
 * to the one that was sent.
 */
export interface BriefDeliveryPort {
  deliverDailyBrief(householdId: string, brief: DailyBrief): Promise<DeliveryResult>;
  deliverReactionPrompt(householdId: string, prompt: ReactionPrompt): Promise<DeliveryResult>;
}
