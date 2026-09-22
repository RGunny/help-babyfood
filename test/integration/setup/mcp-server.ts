import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module.js';
import { ClockPort } from '../../../src/application/ports/clock.port.js';
import { CLOCK } from '../../../src/application/ports/tokens.js';
import { AppEnv } from '../../../src/config/env.js';
import { DEFAULT_TOKEN_LIFETIME_DAYS, mintToken } from '../../../src/mcp/auth/member-token.js';
import { APP_ENV } from '../../../src/infrastructure/prisma/prisma.service.js';
import { PrismaClient } from '../../../src/generated/prisma/client.js';
import { testDatabaseUrl } from './database.js';
import { MutableClock } from './fixtures.js';

export interface McpTestServer {
  readonly app: INestApplication;
  readonly url: string;
  readonly clock: MutableClock;
  close(): Promise<void>;
}

/**
 * Boots the real `AppModule` — the same wiring `main.ts` uses — against the worker's database and
 * a clock the test can move. Only the environment and the clock are replaced; the middleware
 * chain, the verifier and the tools are the ones that run in production.
 */
export async function startMcpServer(clock: MutableClock): Promise<McpTestServer> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_ENV)
    .useValue({
      databaseUrl: testDatabaseUrl(),
      lookbackDays: 90,
      databasePoolSize: 5,
      mcpAllowedHosts: ['localhost', '127.0.0.1', '[::1]'],
      mcpAllowedOrigins: ['localhost', '127.0.0.1', '[::1]'],
      // 스케줄러는 끈다. 테스트 중간에 정합화가 끼어들면 아직 정산하지 않은 식단이 차감되고,
      // 원장을 세는 단정이 실행 시점에 따라 달라진다. 스케줄러 자체는 자기 테스트에서 돈다.
      schedulerEnabled: false,
      slackBotToken: 'xoxb-test',
    } satisfies AppEnv)
    .overrideProvider(CLOCK)
    .useValue(clock satisfies ClockPort)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/mcp`;

  return { app, url, clock, close: async () => await app.close() };
}

/** A client that presents the token on every request, the way Claude Code's static header does. */
export async function connectClient(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'integration-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { authProvider: { token: async () => token } }),
  );
  return client;
}

export interface IssuedToken {
  readonly token: string;
  readonly id: string;
}

export async function issueToken(
  prisma: PrismaClient,
  household: { id: string; memberId: string },
  options: { createdAt?: Date; expiresAt?: Date; revoked?: boolean; label?: string } = {},
): Promise<IssuedToken> {
  const { token, tokenHash } = mintToken();
  const row = await prisma.memberToken.create({
    data: {
      householdId: household.id,
      memberId: household.memberId,
      tokenHash,
      label: options.label ?? '테스트',
      // 이미 만료된 토큰은 발급 시점도 그만큼 과거여야 한다. expires_at > created_at CHECK가
      // 만료된 토큰을 새로 발급하는 것을 막고 있고, 그것이 이 제약의 목적이다.
      ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
      expiresAt:
        options.expiresAt ?? new Date(Date.now() + DEFAULT_TOKEN_LIFETIME_DAYS * 86_400_000),
    },
    select: { id: true },
  });
  // 폐기는 발급 뒤에 일어나는 별개의 일이다. 시각은 DB가 찍는다. 클라이언트 시계로 만든
  // 값을 넣으면 created_at(DB의 CURRENT_TIMESTAMP)보다 앞서 revoked_at >= created_at CHECK에
  // 걸릴 수 있고, 그 제약은 "발급보다 먼저 폐기될 수 없다"를 말하는 것이라 옳다.
  if (options.revoked === true) {
    await prisma.$executeRaw`UPDATE member_token SET revoked_at = now() WHERE id = ${row.id}::uuid`;
  }
  return { token, id: row.id };
}

/** The text blocks of a tool result, joined. Tools answer with one JSON block. */
export function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return content.map((block) => block.text ?? '').join('');
}

/**
 * A POST sent through `node:http`, which lets a test set `Host`. `fetch` forbids that header, so
 * the DNS-rebinding guard cannot be exercised through it.
 */
export async function rawPost(url: string, headers: Record<string, string>): Promise<number> {
  const target = new URL(url);
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  return await new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'content-length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}
