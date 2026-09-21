import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../src/generated/prisma/client.js';

/**
 * Set by `worker-database.ts` before any test file of this worker runs. Each worker owns its own
 * database, copied from the migrated template, so test files run in parallel without colliding.
 */
export function testDatabaseUrl(): string {
  const url = process.env['TEST_DATABASE_URL'];
  if (url === undefined) {
    throw new Error('통합 테스트 DB가 준비되지 않았습니다. vitest integration 프로젝트로 실행하세요.');
  }
  return url;
}

export function createPrismaClient(databaseUrl: string = testDatabaseUrl()): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      // Small on purpose: an exhausted pool should surface as a test failure, not a hang.
      max: 5,
      connectionTimeoutMillis: 5_000,
    }),
  });
}

let tableNames: string[] | undefined;

/** Empties every table but the migration journal, so each test starts from nothing. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  tableNames ??= (
    await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `
  ).map((row) => row.tablename);

  if (tableNames.length === 0) return;
  const list = tableNames.map((name) => `"public"."${name}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
