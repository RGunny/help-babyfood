import { MAX_DELIVERY_ATTEMPTS, RETRY_DELAY_MINUTES, nextAttemptAt } from './brief-dispatch.policy.js';

const NOW = new Date('2026-09-23T07:30:00.000Z');

function minutesAfterNow(at: Date): number {
  return (at.getTime() - NOW.getTime()) / 60_000;
}

describe('발송 재시도 정책', () => {
  it('실패한 시도의 번호마다 다음 시도까지 1분, 5분, 15분, 60분을 둔다', () => {
    expect([1, 2, 3, 4].map((attempts) => minutesAfterNow(nextAttemptAt(attempts, NOW)))).toEqual([1, 5, 15, 60]);
  });

  it('마지막 시도가 실패해도 다음 시각을 돌려준다', () => {
    // 저장소의 CHECK가 status = 'failed'인 행에 next_attempt_at을 요구한다. 재시도를 막는 것은
    // 이 값이 아니라 클레임 질의의 attempts < MAX_DELIVERY_ATTEMPTS 조건이다.
    expect(minutesAfterNow(nextAttemptAt(MAX_DELIVERY_ATTEMPTS, NOW))).toBe(60);
  });

  it('표의 범위를 넘는 시도 번호에서도 던지지 않고 마지막 간격을 쓴다', () => {
    expect(minutesAfterNow(nextAttemptAt(MAX_DELIVERY_ATTEMPTS + 10, NOW))).toBe(60);
    expect(minutesAfterNow(nextAttemptAt(0, NOW))).toBe(1);
  });

  it('간격 표가 네 칸이고 시도 상한은 다섯이다', () => {
    // 네 번의 간격을 합치면 81분이고, 그 길이의 Slack 장애를 넘긴다.
    expect(RETRY_DELAY_MINUTES).toEqual([1, 5, 15, 60]);
    expect(RETRY_DELAY_MINUTES.length).toBe(MAX_DELIVERY_ATTEMPTS - 1);
    expect(RETRY_DELAY_MINUTES.reduce((sum, minutes) => sum + minutes, 0)).toBe(81);
  });

  it('기준 시각을 바꾸지 않는다', () => {
    const now = new Date(NOW);

    nextAttemptAt(1, now);

    expect(now.getTime()).toBe(NOW.getTime());
  });
});
