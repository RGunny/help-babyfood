import { readEnv } from './env.js';

const DATABASE_URL = 'postgresql://babyfood:babyfood@localhost:55432/babyfood';

describe('환경 변수 읽기', () => {
  it('DATABASE_URL만 있으면 나머지는 기본값이다', () => {
    expect(readEnv({ DATABASE_URL })).toEqual({
      databaseUrl: DATABASE_URL,
      lookbackDays: 90,
      databasePoolSize: 10,
    });
  });

  it('DATABASE_URL이 없으면 거부한다', () => {
    expect(() => readEnv({})).toThrow(/DATABASE_URL/);
  });

  it('DATABASE_URL이 빈 문자열이면 거부한다', () => {
    expect(() => readEnv({ DATABASE_URL: '  ' })).toThrow(/DATABASE_URL/);
  });

  it('LOOKBACK_DAYS를 덮어쓸 수 있다', () => {
    expect(readEnv({ DATABASE_URL, LOOKBACK_DAYS: '30' }).lookbackDays).toBe(30);
  });

  it.each(['0', '-1', '1.5', 'many'])('LOOKBACK_DAYS가 "%s"이면 거부한다', (value) => {
    expect(() => readEnv({ DATABASE_URL, LOOKBACK_DAYS: value })).toThrow(/LOOKBACK_DAYS/);
  });

  it('빈 값은 지정하지 않은 것으로 본다', () => {
    expect(readEnv({ DATABASE_URL, LOOKBACK_DAYS: '' }).lookbackDays).toBe(90);
  });

  it('풀 크기도 같은 규칙으로 읽는다', () => {
    expect(readEnv({ DATABASE_URL, DATABASE_POOL_SIZE: '20' }).databasePoolSize).toBe(20);
    expect(() => readEnv({ DATABASE_URL, DATABASE_POOL_SIZE: '0' })).toThrow(/DATABASE_POOL_SIZE/);
  });
});
