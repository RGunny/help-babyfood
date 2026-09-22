import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

/**
 * The server as it boots, against a real database. `DATABASE_URL` must point at one.
 *
 * There is one route and it is protected, so an unauthenticated request is what this can assert
 * without minting a token. The tools themselves are covered by `test/integration/mcp-*.int-spec`,
 * which runs against a database Testcontainers brings up.
 */
describe('MCP 엔드포인트 (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('토큰 없이 부르면 401과 Bearer 챌린지가 온다', async () => {
    const response = await request(app.getHttpServer())
      .post('/mcp')
      .set('accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toMatch(/^Bearer/);
  });

  it('스캐폴드 라우트는 남아 있지 않다', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });
});
