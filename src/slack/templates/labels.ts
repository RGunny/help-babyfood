import { LocalDate } from '../../domain/shared/local-date.js';
import { MealSlot } from '../../domain/shared/meal-slot.js';
import { RuleWarningCode } from '../../domain/rules/meal-rules.js';

/** The Korean words the templates and the button replies share. */
export const SLOT_LABEL: Record<MealSlot, string> = { morning: '오전', afternoon: '오후' };

export const RULE_WARNING_LABEL: Record<RuleWarningCode, string> = {
  FORBIDDEN_PAIRING: '금지 조합',
  TOO_MANY_FIRST_INTRODUCTIONS: '하루 첫 도입 재료가 너무 많음',
  FIRST_INTRODUCTION_IN_WRONG_SLOT: '첫 도입이 오전 끼니가 아님',
  REACTED_INGREDIENT_PLANNED: '반응 있었던 재료가 식단에 있음',
};

/** `2026-09-28` as `09-28`, for table cells. The year is in the brief's title. */
export function shortDate(date: LocalDate): string {
  return date.slice(5);
}

const WEEKDAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'];

/** `2026-09-26` is `토`. The date is a calendar date, so UTC midnight is the day itself. */
export function weekdayLabel(date: LocalDate): string {
  return WEEKDAY_LABEL[new Date(`${date}T00:00:00.000Z`).getUTCDay()];
}
