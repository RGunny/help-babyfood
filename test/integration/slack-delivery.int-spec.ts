import { IncomingHttpHeaders, Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { DailyBrief } from '../../src/application/daily-brief.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { SlackBriefDelivery } from '../../src/slack/outbound/slack-brief-delivery.js';
import { TestServices, at, buildServices, seedHouseholdOnly } from './setup/fixtures.js';

// 발송 어댑터가 Slack Web API의 응답을 어떻게 판정하는지 본다. 가짜 서버가 chat.postMessage를
// 대신 받는다. 여기서 지키는 것은 "HTTP 200이어도 본문의 ok가 false면 실패다"이다.

const TODAY = '2026-09-22';
const BOT_TOKEN = 'xoxb-integration-test';
const CHANNEL_ID = 'C0123456789';

interface ReceivedRequest {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: { channel?: string; text?: string; blocks?: unknown[] };
}

interface FakeReply {
  readonly status: number;
  readonly body: unknown;
}

let services: TestServices;
let server: Server;
let baseUrl: string;
let received: ReceivedRequest[];
let reply: FakeReply;

beforeAll(async () => {
  services = buildServices(at(TODAY, '07:30'));
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as ReceivedRequest['body'],
      });
      response.writeHead(reply.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await services.prisma.$disconnect();
});

beforeEach(() => {
  received = [];
  reply = { status: 200, body: { ok: true, channel: CHANNEL_ID, ts: '1758493800.000100' } };
});

function delivery(): SlackBriefDelivery {
  return new SlackBriefDelivery(services.prisma, BOT_TOKEN, baseUrl);
}

async function household(channelId: string | null): Promise<string> {
  const { id } = await seedHouseholdOnly(services.prisma);
  if (channelId !== null) {
    await services.prisma.household.update({ where: { id }, data: { slackChannelId: channelId } });
  }
  return id;
}

const BRIEF: DailyBrief = {
  date: localDate(TODAY),
  dayNumber: 3,
  slots: [],
  newIngredients: [],
  stock: [],
  shortages: [],
  thresholdAlerts: [],
  expiryAlerts: [],
  attention: {
    heldDeductions: [],
    unrecordedReactions: [],
    ruleWarnings: [],
    weightMismatchedBatches: [],
    planRunwayDays: null,
    planRunwayShort: true,
  },
};

describe('Slack 발송', () => {
  it('채널이 연결된 가정의 브리프는 봇 토큰과 채널 id를 실어 chat.postMessage로 간다', async () => {
    const householdId = await household(CHANNEL_ID);

    await delivery().deliverDailyBrief(householdId, BRIEF);

    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/api/chat.postMessage');
    expect(request.headers.authorization).toBe(`Bearer ${BOT_TOKEN}`);
    expect(request.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(request.body.channel).toBe(CHANNEL_ID);
    expect(request.body.text).toBe('2026-09-22 이유식 브리프 · 3일차');
    expect(request.body.blocks?.length).toBeGreaterThan(0);
  });

  it('응답의 ts가 발송 결과의 reference로 돌아온다', async () => {
    const householdId = await household(CHANNEL_ID);

    expect(await delivery().deliverDailyBrief(householdId, BRIEF)).toEqual({
      kind: 'sent',
      reference: '1758493800.000100',
    });
  });

  it('후속 메시지도 같은 경로로 간다', async () => {
    const householdId = await household(CHANNEL_ID);

    const result = await delivery().deliverReactionPrompt(householdId, {
      date: localDate(TODAY),
      slot: 'morning',
      ingredients: [{ ingredientId: '3f1c2a4e-7b8d-4c9e-a1f2-0123456789ab', name: '완두콩', exposureNumber: 1 }],
    });

    expect(result).toEqual({ kind: 'sent', reference: '1758493800.000100' });
    expect(received[0].body.text).toBe('2026-09-22 오전 새 재료 반응 기록');
  });

  it('HTTP 200에 {"ok": false, "error": "channel_not_found"}가 오면 성공이 아니라 던진다', async () => {
    const householdId = await household(CHANNEL_ID);
    reply = { status: 200, body: { ok: false, error: 'channel_not_found' } };

    await expect(delivery().deliverDailyBrief(householdId, BRIEF)).rejects.toThrow(/channel_not_found/);
    expect(received).toHaveLength(1);
  });

  it('HTTP 200인데 ts가 없으면 던진다', async () => {
    const householdId = await household(CHANNEL_ID);
    reply = { status: 200, body: { ok: true } };

    await expect(delivery().deliverDailyBrief(householdId, BRIEF)).rejects.toThrow(/ts/);
  });

  it('HTTP 500을 받으면 던진다', async () => {
    const householdId = await household(CHANNEL_ID);
    reply = { status: 500, body: { ok: false, error: 'internal_error' } };

    await expect(delivery().deliverDailyBrief(householdId, BRIEF)).rejects.toThrow(/500/);
  });

  it('채널이 연결되지 않은 가정은 건너뛰고 Slack에 요청을 하나도 보내지 않는다', async () => {
    const householdId = await household(null);

    expect(await delivery().deliverDailyBrief(householdId, BRIEF)).toEqual({ kind: 'skipped', reason: 'not_linked' });
    expect(
      await delivery().deliverReactionPrompt(householdId, { date: localDate(TODAY), slot: 'morning', ingredients: [] }),
    ).toEqual({ kind: 'skipped', reason: 'not_linked' });
    expect(received).toEqual([]);
  });
});
