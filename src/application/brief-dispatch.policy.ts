/**
 * When a failed delivery is tried again (ADR 0006, "재시도 정책").
 *
 * The intervals and the ceiling live here and nowhere else. The claim query picks a row up again by
 * comparing the `next_attempt_at` this module computed, so the table of delays never gets a second
 * copy written in SQL.
 *
 * Spacing the tries out is the point. A failed row that the next minute's tick grabs straight away
 * burns all five attempts in five minutes, and a five-minute outage of the messenger costs that
 * day's brief outright. Four delays add up to about 81 minutes, which outlasts an outage that long.
 */

/** 실패한 시도 n번째 뒤 다음 시도까지의 분. 마지막 값은 그 뒤로도 쓰인다. */
export const RETRY_DELAY_MINUTES = [1, 5, 15, 60] as const;

/** 시도를 다섯 번까지만 한다. 다섯 번째가 실패하면 그날은 포기한다. */
export const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * How long a claim is the claimer's before anyone else may take it.
 *
 * A process that dies mid-delivery leaves the row claimed and nothing written. After this long the
 * next sweep takes it over, which makes delivery at-least-once: a send that succeeded just before
 * the crash goes out twice. Seeing the same brief twice is the better of the two.
 */
export const CLAIM_LEASE_SECONDS = 300;

const MS_PER_MINUTE = 60_000;

/**
 * Given that the attempt numbered `attempts` (1-based) has just failed, when to try next.
 *
 * Answers even for the last attempt, because the store's CHECK wants `next_attempt_at` on every
 * `failed` row. What stops a fifth failure from being retried is `attempts < MAX_DELIVERY_ATTEMPTS`
 * in the claim query, not this value; looking for the stop here is what leads to "we gave up, so
 * why is there a time in the column". Past the end of the table the last delay repeats.
 */
export function nextAttemptAt(attempts: number, now: Date): Date {
  const index = Math.min(Math.max(attempts, 1), RETRY_DELAY_MINUTES.length) - 1;
  return new Date(now.getTime() + RETRY_DELAY_MINUTES[index] * MS_PER_MINUTE);
}
