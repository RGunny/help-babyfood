import { Client } from 'pg';
import { inject } from 'vitest';
import { TEMPLATE_DATABASE } from './global-setup.js';
import { createPrismaClient, truncateAll } from './database.js';

/**
 * Gives every Vitest worker its own database, copied from the migrated template. Test files then
 * run in parallel, and each test starts from empty tables.
 *
 * Vitest 4 numbers workers from 0. Vitest 5 numbers them from 1, which only changes the name.
 */
const workerDatabase = `babyfood_w${process.env['VITEST_POOL_ID'] ?? '0'}`;

const templateUri = inject('postgresTemplateUri');
const workerUri = withDatabase(templateUri, workerDatabase);
process.env['TEST_DATABASE_URL'] = workerUri;

const prisma = createPrismaClient(workerUri);

beforeAll(async () => {
  await createWorkerDatabase();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * `CREATE DATABASE ... TEMPLATE` needs the source to have no connections, which holds because
 * nothing ever connects to the template after the migrations run. Test files are isolated from
 * each other, so this runs again for every file in the worker and must tolerate "already exists".
 */
async function createWorkerDatabase(): Promise<void> {
  const admin = new Client({ connectionString: withDatabase(templateUri, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${workerDatabase}" TEMPLATE "${TEMPLATE_DATABASE}"`);
  } catch (error) {
    // 42P04: duplicate_database. Another test file in this worker created it already.
    if ((error as { code?: string }).code !== '42P04') throw error;
  } finally {
    await admin.end();
  }
}
