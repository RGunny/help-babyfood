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
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return {
    databaseUrl: required(source, 'DATABASE_URL'),
    lookbackDays: positiveInteger(source, 'LOOKBACK_DAYS', 90),
    databasePoolSize: positiveInteger(source, 'DATABASE_POOL_SIZE', 10),
  };
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
