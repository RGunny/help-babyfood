// Prisma 7과 마찬가지로 Node의 내장 로더를 쓴다. dotenv 의존성을 더하지 않는다.
try {
  process.loadEnvFile();
} catch {
  // .env가 없으면 이미 들어 있는 환경 변수를 쓴다.
}

export interface AppEnv {
  readonly databaseUrl: string;
  /**
   * How far back reconciliation loads meals. Meals older than this are settled: their meal time
   * passed long ago, so the one rule that drives reconciliation cannot change them.
   * An operation naming an older date widens the window to that date.
   */
  readonly lookbackDays: number;
  readonly databasePoolSize: number;
  /**
   * Hostnames the MCP endpoint answers, without scheme or port. A request whose `Host` does not
   * match gets 403 before anything reads the token: that is what stops a page from resolving its
   * own domain to this server and speaking to it as if it were same-origin.
   */
  readonly mcpAllowedHosts: readonly string[];
  /** Hostnames allowed in a browser's `Origin` header. A request without one always passes. */
  readonly mcpAllowedOrigins: readonly string[];
}

const LOCALHOST = ['localhost', '127.0.0.1', '[::1]'];

export function readEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return {
    databaseUrl: required(source, 'DATABASE_URL'),
    lookbackDays: positiveInteger(source, 'LOOKBACK_DAYS', 90),
    databasePoolSize: positiveInteger(source, 'DATABASE_POOL_SIZE', 10),
    mcpAllowedHosts: hostList(source, 'MCP_ALLOWED_HOSTS'),
    mcpAllowedOrigins: hostList(source, 'MCP_ALLOWED_ORIGINS'),
  };
}

/**
 * Comma-separated hostnames, defaulting to localhost only.
 *
 * The default is the safe one: a deployment that forgets to name its hostname refuses every
 * request rather than answering all of them.
 */
function hostList(source: NodeJS.ProcessEnv, name: string): readonly string[] {
  const raw = source[name];
  if (raw === undefined || raw.trim() === '') return LOCALHOST;
  const hosts = raw
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host !== '');
  if (hosts.length === 0) {
    throw new Error(`환경 변수 ${name}에 호스트 이름이 없습니다: ${raw}`);
  }
  return hosts;
}

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`환경 변수 ${name}이 필요합니다`);
  }
  return value;
}

function positiveInteger(source: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = source[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`환경 변수 ${name}은 1 이상의 정수여야 합니다: ${raw}`);
  }
  return value;
}
