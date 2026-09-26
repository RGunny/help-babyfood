import { FeedingReaction } from '../../domain/ingredient/introduction-status.js';
import { LocalDate } from '../../domain/shared/local-date.js';
import { MealSlot } from '../../domain/shared/meal-slot.js';
import { SLOT_LABEL } from './labels.js';

/**
 * The sentences a tapped button answers with on `response_url`, visible only to the parent who
 * tapped. Plain text, not Block Kit, and so not a `MessageTemplate`; they live beside the
 * templates because they are the other half of what the parent reads.
 */
export const UNKNOWN_SLACK_USER = '등록되지 않은 Slack 사용자입니다';
export const UNKNOWN_BUTTON = '알 수 없는 버튼입니다. 최신 브리프의 버튼을 눌러 주세요';
export const UNKNOWN_INGREDIENT = '버튼이 가리키는 재료를 찾을 수 없습니다';
export const PROCESSING_FAILED = '처리하지 못했습니다. 잠시 뒤 다시 눌러 주세요';
export const BATCH_DISCARDED = '배치를 폐기했습니다';

const REACTION_LABEL: Record<FeedingReaction, string> = { clear: '이상 없음', reacted: '반응 있음' };

export function noFeedRecorded(date: LocalDate, slot: MealSlot, thawed: boolean): string {
  return `${date} ${SLOT_LABEL[slot]} 미급여(${thawed ? '해동 후' : '해동 전'})를 기록했습니다`;
}

export function reactionRecorded(
  date: LocalDate,
  slot: MealSlot,
  ingredientName: string,
  result: FeedingReaction,
): string {
  return `${date} ${SLOT_LABEL[slot]} ${ingredientName}: ${REACTION_LABEL[result]}으로 기록했습니다`;
}

/** A rule the use case refused on, in its own words. The parent can act on these. */
export function refused(reason: string): string {
  return `처리하지 못했습니다: ${reason}`;
}
