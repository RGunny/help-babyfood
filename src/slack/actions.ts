import { FeedingReaction } from '../domain/ingredient/introduction-status.js';
import { LocalDate } from '../domain/shared/local-date.js';
import { MealSlot } from '../domain/shared/meal-slot.js';

/**
 * What a button is, written into the button and read back when it is tapped.
 *
 * Delivery encodes and the interaction handler decodes, and both go through this file only. Two
 * copies of the format drift apart the day one of them changes, and the symptom is a tap that
 * silently does nothing.
 */
export type SlackAction =
  | { readonly kind: 'no_feed'; readonly date: LocalDate; readonly slot: MealSlot; readonly thawed: boolean }
  | {
      readonly kind: 'reaction';
      readonly date: LocalDate;
      readonly slot: MealSlot;
      readonly ingredientId: string;
      readonly result: FeedingReaction;
    }
  | { readonly kind: 'discard'; readonly batchId: string };

export type SlackActionKind = SlackAction['kind'];

// 날짜는 2026-09-22, 끼니는 morning/afternoon, 재료와 배치 id는 UUID라 `-`와 영숫자만 나온다.
// `|`는 그 어디에도 나타나지 않으므로 나눈 조각이 값과 섞이지 않는다. `:`는 피했다. 버튼 응답의
// 멱등키가 `slack:{ts}:{action_id}:{value}`로 `:`를 구분자로 쓰기 때문이다.
const SEPARATOR = '|';

// action_id 뒤에 붙는 블록 안 순번의 구분자. Slack은 action_id가 "containing block" 안에서
// 유일하기를 요구하는데, 한 블록에 미급여 버튼 둘, 폐기 버튼 여럿이 함께 달린다.
const ORDINAL_SEPARATOR = '.';

const THAWED = 'thawed';
const FROZEN = 'frozen';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOTS: readonly string[] = ['morning', 'afternoon'] satisfies MealSlot[];
const RESULTS: readonly string[] = ['clear', 'reacted'] satisfies FeedingReaction[];

/**
 * The `action_id` of the `ordinal`-th button of its kind within one block.
 *
 * The kind alone is not enough, because Slack wants action ids unique within their block. The
 * ordinal carries nothing: the value already names the button, and `decodeAction` reads only the
 * kind in front of it.
 */
export function actionId(kind: SlackActionKind, ordinal: number): string {
  return `${kind}${ORDINAL_SEPARATOR}${ordinal}`;
}

export function encodeNoFeed(date: LocalDate, slot: MealSlot, thawed: boolean): string {
  return [date, slot, thawed ? THAWED : FROZEN].join(SEPARATOR);
}

export function encodeReaction(date: LocalDate, slot: MealSlot, ingredientId: string, result: FeedingReaction): string {
  return [date, slot, ingredientId, result].join(SEPARATOR);
}

export function encodeDiscard(batchId: string): string {
  return batchId;
}

/**
 * Reads a tapped button back. Null for an action id this server did not make or a value that does
 * not parse, never an exception: the handler has to turn that into a sentence for the parent.
 *
 * The date is checked for shape only. Whether it is a real day is the use case's call, which
 * already answers it with an error the parent can read.
 */
export function decodeAction(actionIdValue: string, value: string): SlackAction | null {
  const [kind] = actionIdValue.split(ORDINAL_SEPARATOR);
  const parts = value.split(SEPARATOR);

  if (kind === 'no_feed' && parts.length === 3) {
    const [date, slot, thawed] = parts;
    if (!isDate(date) || !isSlot(slot) || (thawed !== THAWED && thawed !== FROZEN)) return null;
    return { kind, date, slot, thawed: thawed === THAWED };
  }
  if (kind === 'reaction' && parts.length === 4) {
    const [date, slot, ingredientId, result] = parts;
    if (!isDate(date) || !isSlot(slot) || !UUID.test(ingredientId) || !isResult(result)) return null;
    return { kind, date, slot, ingredientId, result };
  }
  if (kind === 'discard' && parts.length === 1) {
    const [batchId] = parts;
    return UUID.test(batchId) ? { kind, batchId } : null;
  }
  return null;
}

function isDate(value: string): value is LocalDate {
  return ISO_DATE.test(value);
}

function isSlot(value: string): value is MealSlot {
  return SLOTS.includes(value);
}

function isResult(value: string): value is FeedingReaction {
  return RESULTS.includes(value);
}
