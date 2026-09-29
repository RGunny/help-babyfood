import { MutableClock, at, buildServices, seedHousehold, TestServices } from './setup/fixtures.js';
import { mintToken } from '../../src/mcp/auth/member-token.js';
import {
  McpTestServer,
  rawPost,
  connectClient,
  issueToken,
  startMcpServer,
  textOf,
} from './setup/mcp-server.js';

let server: McpTestServer;
let services: TestServices;
let clock: MutableClock;

beforeAll(async () => {
  clock = new MutableClock(at('2026-09-22', '09:00'));
  server = await startMcpServer(clock);
  services = buildServices(at('2026-09-22', '09:00'));
});

afterAll(async () => {
  await server.close();
  await services.prisma.$disconnect();
});

afterEach(() => {
  clock.set('2026-09-22', '09:00');
  services.clock.set('2026-09-22', '09:00');
});

const household = () => seedHousehold(services, { mealCount: 0 });

/** The raw HTTP answer, for the cases that never get as far as a client. */
const post = async (headers: Record<string, string>) =>
  await fetch(server.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

describe('MCP 인증', () => {
  it('토큰이 없으면 401과 Bearer 챌린지를 돌려준다', async () => {
    const response = await post({});

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/^Bearer/);
  });

  it('인증 서버가 없으므로 챌린지에 메타데이터 주소를 싣지 않는다', async () => {
    const response = await post({});

    expect(response.headers.get('www-authenticate')).not.toMatch(/resource_metadata/);
  });

  it('모르는 토큰은 401이다', async () => {
    const { token } = mintToken();
    expect((await post({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it('우리 형식이 아닌 토큰도 401이다', async () => {
    expect((await post({ authorization: 'Bearer not-one-of-ours' })).status).toBe(401);
  });

  it('폐기된 토큰은 401이다', async () => {
    const house = await household();
    const { token } = await issueToken(services.prisma, house, { revoked: true });

    expect((await post({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it('만료된 토큰은 401이다', async () => {
    const house = await household();
    // 200일 전에 180일짜리로 발급한 토큰.
    const { token } = await issueToken(services.prisma, house, {
      createdAt: new Date('2026-03-01T00:00:00Z'),
      expiresAt: new Date('2026-08-28T00:00:00Z'),
    });

    expect((await post({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it('만료 직전까지는 유효하고 시각이 지나면 거부된다', async () => {
    const house = await household();
    // 실제 내일 10:00 KST에 만료되는 토큰. 만료일을 고정하면 실제 날짜가 그날을 지난 뒤부터
    // 깨진다. MCP SDK가 AuthInfo.expiresAt을 실제 시계로도 보기 때문에 우리 시계만 옮겨서는
    // 살릴 수 없고, DB의 expires_at > created_at CHECK도 발급 자체를 막는다.
    const tomorrow = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(
      new Date(Date.now() + 86_400_000),
    );
    const { token } = await issueToken(services.prisma, house, {
      expiresAt: new Date(`${tomorrow}T10:00:00+09:00`),
    });

    clock.set(tomorrow, '09:59');
    expect((await post({ authorization: `Bearer ${token}` })).status).toBe(200);

    clock.set(tomorrow, '10:01');
    expect((await post({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it('유효한 토큰이면 도구 목록을 돌려준다', async () => {
    const house = await household();
    const { token } = await issueToken(services.prisma, house);

    const client = await connectClient(server.url, token);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain('get_stock_status');
    } finally {
      await client.close();
    }
  });

  it('토큰을 쓰면 마지막 사용 시각이 남는다', async () => {
    const house = await household();
    const { token, id } = await issueToken(services.prisma, house);

    await post({ authorization: `Bearer ${token}` });
    // lastUsedAt 갱신은 응답을 막지 않는 별도 경로라, 쓰이기까지 잠깐 기다린다.
    await vi.waitFor(async () => {
      const row = await services.prisma.memberToken.findUniqueOrThrow({ where: { id } });
      expect(row.lastUsedAt).not.toBeNull();
    });
  });
});

describe('허용 호스트', () => {
  it('허용 목록에 없는 Host는 토큰을 보기도 전에 403이다', async () => {
    const house = await household();
    const { token } = await issueToken(services.prisma, house);

    // fetch는 Host 헤더를 못 쓰게 막으므로 node:http로 직접 보낸다.
    const status = await rawPost(server.url, {
      authorization: `Bearer ${token}`,
      host: 'evil.example.com',
    });

    expect(status).toBe(403);
  });

  it('허용 목록에 있는 Host는 통과한다', async () => {
    const house = await household();
    const { token } = await issueToken(services.prisma, house);

    expect(await rawPost(server.url, { authorization: `Bearer ${token}` })).toBe(200);
  });

  it('허용 목록에 없는 Origin도 403이다', async () => {
    const house = await household();
    const { token } = await issueToken(services.prisma, house);

    const response = await post({
      authorization: `Bearer ${token}`,
      origin: 'https://evil.example.com',
    });

    expect(response.status).toBe(403);
  });

  it('Origin 헤더가 없는 요청은 통과한다', async () => {
    const house = await household();
    const { token } = await issueToken(services.prisma, house);

    expect((await post({ authorization: `Bearer ${token}` })).status).toBe(200);
  });
});

describe('가정 격리', () => {
  it('도구는 토큰이 가리키는 가정만 본다', async () => {
    const mine = await household();
    const theirs = await household();
    await services.stock.registerCookedBatch({
      householdId: theirs.id,
      actor: theirs.actor,
      ingredientName: '소고기',
      cubeWeightGram: 10,
      cookedOn: services.clock.today(),
      cubes: 7,
    });
    const { token } = await issueToken(services.prisma, mine);

    const client = await connectClient(server.url, token);
    try {
      const result = await client.callTool({ name: 'get_stock_status', arguments: {} });
      const body = JSON.parse(textOf(result)) as {
        ingredients: { ingredientName: string; total: number }[];
      };
      expect(body.ingredients.every((stock) => stock.total === 0)).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('원장의 수행자는 토큰의 구성원이다', async () => {
    const house = await household();
    const { token } = await issueToken(services.prisma, house);

    const client = await connectClient(server.url, token);
    try {
      await client.callTool({
        name: 'register_cooked_batch',
        arguments: {
          idempotencyKey: 'batch-1',
          ingredientName: '소고기',
          cubeWeightGram: 10,
          cookedOn: '2026-09-20',
          cubes: 6,
        },
      });
    } finally {
      await client.close();
    }

    const entries = await services.prisma.stockLedgerEntry.findMany({
      where: { householdId: house.id },
      select: { actorSource: true, actorMemberId: true },
    });
    expect(entries).toEqual([{ actorSource: 'member', actorMemberId: house.memberId }]);
  });
});
