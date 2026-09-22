import { readEnv } from './env.js';

const DATABASE_URL = 'postgresql://babyfood:babyfood@localhost:55432/babyfood';
const SLACK_BOT_TOKEN = 'xoxb-test';

describe('환경 변수 읽기', () => {
  it('DATABASE_URL과 SLACK_BOT_TOKEN만 있으면 나머지는 기본값이다', () => {
    expect(readEnv({ DATABASE_URL, SLACK_BOT_TOKEN })).toEqual({
      databaseUrl: DATABASE_URL,
      lookbackDays: 90,
      databasePoolSize: 10,
      mcpAllowedHosts: ['localhost', '127.0.0.1', '[::1]'],
      mcpAllowedOrigins: ['localhost', '127.0.0.1', '[::1]'],
      schedulerEnabled: true,
      slackBotToken: SLACK_BOT_TOKEN,
    });
  });

  it('DATABASE_URL이 없으면 거부한다', () => {
    expect(() => readEnv({ SLACK_BOT_TOKEN })).toThrow(/DATABASE_URL/);
  });

  it('DATABASE_URL이 빈 문자열이면 거부한다', () => {
    expect(() => readEnv({ DATABASE_URL: '  ', SLACK_BOT_TOKEN })).toThrow(/DATABASE_URL/);
  });

  it('SLACK_BOT_TOKEN이 없으면 거부한다', () => {
    expect(() => readEnv({ DATABASE_URL })).toThrow(/SLACK_BOT_TOKEN/);
  });

  it('SLACK_BOT_TOKEN이 빈 문자열이면 거부한다', () => {
    expect(() => readEnv({ DATABASE_URL, SLACK_BOT_TOKEN: ' ' })).toThrow(/SLACK_BOT_TOKEN/);
  });

  it('LOOKBACK_DAYS를 덮어쓸 수 있다', () => {
    expect(readEnv({ DATABASE_URL, SLACK_BOT_TOKEN, LOOKBACK_DAYS: '30' }).lookbackDays).toBe(30);
  });

  it.each(['0', '-1', '1.5', 'many'])('LOOKBACK_DAYS가 "%s"이면 거부한다', (value) => {
    expect(() => readEnv({ DATABASE_URL, SLACK_BOT_TOKEN, LOOKBACK_DAYS: value })).toThrow(/LOOKBACK_DAYS/);
  });

  it('빈 값은 지정하지 않은 것으로 본다', () => {
    expect(readEnv({ DATABASE_URL, SLACK_BOT_TOKEN, LOOKBACK_DAYS: '' }).lookbackDays).toBe(90);
  });

  it('풀 크기도 같은 규칙으로 읽는다', () => {
    expect(readEnv({ DATABASE_URL, SLACK_BOT_TOKEN, DATABASE_POOL_SIZE: '20' }).databasePoolSize).toBe(20);
    expect(() => readEnv({ DATABASE_URL, SLACK_BOT_TOKEN, DATABASE_POOL_SIZE: '0' })).toThrow(/DATABASE_POOL_SIZE/);
  });

  it('허용 호스트는 쉼표로 나누고 공백을 떼어 낸다', () => {
    expect(
      readEnv({ DATABASE_URL, SLACK_BOT_TOKEN, MCP_ALLOWED_HOSTS: 'babyfood.up.railway.app , localhost' })
        .mcpAllowedHosts,
    ).toEqual(['babyfood.up.railway.app', 'localhost']);
  });

  it('허용 호스트를 지정하지 않으면 localhost만 허용한다', () => {
    expect(readEnv({ DATABASE_URL, SLACK_BOT_TOKEN, MCP_ALLOWED_HOSTS: '' }).mcpAllowedHosts).toEqual([
      'localhost',
      '127.0.0.1',
      '[::1]',
    ]);
  });

  it('쉼표만 있어 호스트가 하나도 남지 않으면 거부한다', () => {
    expect(() => readEnv({ DATABASE_URL, SLACK_BOT_TOKEN, MCP_ALLOWED_HOSTS: ' , , ' })).toThrow(
      /MCP_ALLOWED_HOSTS/,
    );
  });

  it('스케줄러는 끄라고 적었을 때만 꺼진다', () => {
    expect(readEnv({ DATABASE_URL, SLACK_BOT_TOKEN, SCHEDULER_ENABLED: 'false' }).schedulerEnabled).toBe(false);
    expect(readEnv({ DATABASE_URL, SLACK_BOT_TOKEN, SCHEDULER_ENABLED: 'TRUE' }).schedulerEnabled).toBe(true);
    expect(readEnv({ DATABASE_URL, SLACK_BOT_TOKEN, SCHEDULER_ENABLED: '' }).schedulerEnabled).toBe(true);
  });

  it.each(['0', 'no', 'off'])('SCHEDULER_ENABLED가 "%s"이면 거부한다', (value) => {
    expect(() => readEnv({ DATABASE_URL, SLACK_BOT_TOKEN, SCHEDULER_ENABLED: value })).toThrow(/SCHEDULER_ENABLED/);
  });

  it('허용 Origin도 같은 규칙으로 읽는다', () => {
    expect(readEnv({ DATABASE_URL, SLACK_BOT_TOKEN, MCP_ALLOWED_ORIGINS: 'claude.ai' }).mcpAllowedOrigins).toEqual([
      'claude.ai',
    ]);
  });
});
