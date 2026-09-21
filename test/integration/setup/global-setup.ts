import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

const execFileAsync = promisify(execFile);

/**
 * Every worker copies its own database from this one, so migrations run once per test run.
 * It must not be the `postgres` system database: a copy needs a different database to connect to.
 */
export const TEMPLATE_DATABASE = 'babyfood_template';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection string of the migrated template database. Workers swap the database name. */
    postgresTemplateUri: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase(TEMPLATE_DATABASE)
    .withUsername('babyfood')
    .withPassword('babyfood')
    .start();

  const uri = container.getConnectionUri();
  await applyMigrations(uri);
  // Only serializable values cross the process boundary, so this is the URI and not the container.
  project.provide('postgresTemplateUri', uri);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

/**
 * `migrate deploy` uses no shadow database and does not look for drift, which is what a fresh
 * test database needs. Prisma 7 reads no `.env` of its own, so the URL goes in through the
 * child process environment.
 */
async function applyMigrations(databaseUrl: string): Promise<void> {
  const prismaBin = path.join(process.cwd(), 'node_modules', '.bin', 'prisma');
  await execFileAsync(prismaBin, ['migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
