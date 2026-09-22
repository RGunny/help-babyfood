import { MutableClock, at } from './setup/fixtures.js';
import { McpTestServer, startMcpServer } from './setup/mcp-server.js';

let server: McpTestServer;
let healthUrl: string;

beforeAll(async () => {
  server = await startMcpServer(new MutableClock(at('2026-09-22', '09:00')));
  healthUrl = `${await server.app.getUrl()}/health`;
});

afterAll(async () => {
  await server.close();
});

describe('GET /health', () => {
  it('DB에 닿으면 200과 ok를 돌려준다', async () => {
    const response = await fetch(healthUrl);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('Authorization 헤더 없이도 답한다. 플랫폼의 헬스체크는 토큰을 들고 오지 않는다', async () => {
    const response = await fetch(healthUrl);

    expect(response.status).toBe(200);
    expect(response.headers.get('www-authenticate')).toBeNull();
  });
});
