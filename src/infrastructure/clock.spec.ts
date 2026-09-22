import { localDate } from '../domain/shared/local-date.js';
import { localTime } from '../domain/shared/local-time.js';
import { FixedClock, SeoulClock } from './clock.js';

const at = (iso: string) => new SeoulClock(() => new Date(iso)).now();

describe('Asia/Seoul 시계', () => {
  it('UTC 인스턴트를 9시간 앞선 서울 날짜와 시각으로 읽는다', () => {
    expect(at('2026-09-21T01:00:00Z')).toEqual({ date: localDate('2026-09-21'), time: localTime('10:00') });
  });

  it('서울 자정 직전은 아직 전날이다', () => {
    expect(at('2026-09-21T14:59:59Z')).toEqual({ date: localDate('2026-09-21'), time: localTime('23:59') });
  });

  it('서울 자정은 다음 날 00:00이다 (24:00이 아니다)', () => {
    expect(at('2026-09-21T15:00:00Z')).toEqual({ date: localDate('2026-09-22'), time: localTime('00:00') });
  });

  it('달과 해를 넘기는 경계도 서울 기준으로 센다', () => {
    expect(at('2026-12-31T15:00:00Z')).toEqual({ date: localDate('2027-01-01'), time: localTime('00:00') });
  });

  it('한국에는 서머타임이 없어 여름과 겨울의 시차가 같다', () => {
    expect(at('2026-07-15T03:30:00Z').time).toBe(localTime('12:30'));
    expect(at('2026-01-15T03:30:00Z').time).toBe(localTime('12:30'));
  });

  it('프로세스 시간대가 서울이 아니어도 같은 값을 준다', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      expect(at('2026-09-21T15:00:00Z')).toEqual({ date: localDate('2026-09-22'), time: localTime('00:00') });
    } finally {
      process.env.TZ = original;
    }
  });

  it('today는 now의 날짜다', () => {
    const clock = new SeoulClock(() => new Date('2026-09-21T15:00:00Z'));
    expect(clock.today()).toBe(clock.now().date);
  });

  it('instant는 시간대를 거치지 않은 인스턴트 그대로다', () => {
    const moment = new Date('2026-09-21T15:00:00Z');
    expect(new SeoulClock(() => moment).instant()).toBe(moment);
  });
});

describe('고정 시계', () => {
  it('주어진 시각을 그대로 돌려준다', () => {
    const fixed = { date: localDate('2026-08-17'), time: localTime('10:00') };
    const clock = new FixedClock(fixed);
    expect(clock.now()).toEqual(fixed);
    expect(clock.today()).toBe(localDate('2026-08-17'));
  });

  it('인스턴트는 그 벽시계 값을 서울 기준으로 읽은 것이다', () => {
    const clock = new FixedClock({ date: localDate('2026-08-17'), time: localTime('10:00') });
    expect(clock.instant().toISOString()).toBe('2026-08-17T01:00:00.000Z');
  });
});
