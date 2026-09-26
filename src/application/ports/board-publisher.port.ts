import { HouseholdBoard } from '../household-board.js';

/**
 * What one publication came to. A failure is thrown, the way `BriefDeliveryPort` throws it, and
 * `skipped` means there is nowhere to publish: no channel linked, or a canvas somebody made by hand
 * that the server cannot take over. Content that did not change since the last publication counts
 * as published; the adapter decides that and calls nothing.
 */
export type BoardPublishResult =
  | { readonly kind: 'published'; readonly reference: string }
  | { readonly kind: 'skipped'; readonly reason: string };

/**
 * Where the board goes once it is built. The application hands over the read model and knows
 * neither the surface (a canvas, a pinned message) nor its markup (ADR 0008, "층별 결합").
 */
export interface BoardPublisherPort {
  publish(householdId: string, board: HouseholdBoard): Promise<BoardPublishResult>;
}
