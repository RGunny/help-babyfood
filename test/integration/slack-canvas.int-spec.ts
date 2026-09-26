import { IncomingHttpHeaders, Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { HouseholdBoard } from '../../src/application/household-board.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { localTime } from '../../src/domain/shared/local-time.js';
import { CanvasTemplate } from '../../src/slack/templates/canvas-template.js';
import { NOT_LINKED } from '../../src/slack/outbound/slack-brief-delivery.js';
import { CANVAS_EXISTS, SlackCanvasPublisher, hashContent } from '../../src/slack/outbound/slack-canvas-publisher.js';
import { TestServices, at, buildServices, seedHouseholdOnly } from './setup/fixtures.js';

// 상태판 발행 어댑터가 Slack Web API를 어떻게 부르고 slack_canvas에 무엇을 남기는지 본다.
// 가짜 서버가 conversations.canvases.create와 canvases.edit를 대신 받는다. 여기서 지키는 것은
// "처음엔 만들고 그 뒤엔 전체 교체", "내용이 같으면 부르지 않는다", "사람이 만든 캔버스는 가져가지
// 않는다"이다. 마크다운의 모양은 템플릿 스냅숏이 고정하므로 여기서는 고정 문자열 템플릿을 쓴다.

const TODAY = '2026-09-26';
const BOT_TOKEN = 'xoxb-integration-test';
const CHANNEL_ID = 'C0123456789';
const CANVAS_ID = 'F0C4HPW0JP7';

interface ReceivedRequest {
  readonly url: string | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: Record<string, unknown>;
}

let services: TestServices;
let server: Server;
let baseUrl: string;
let received: ReceivedRequest[];
let replies: Map<string, { status: number; body: unknown }>;

beforeAll(async () => {
  services = buildServices(at(TODAY, '19:03'));
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        url: request.url,
        headers: request.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      });
      const reply = replies.get(request.url ?? '') ?? { status: 200, body: { ok: true } };
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
  replies = new Map([['/api/conversations.canvases.create', { status: 200, body: { ok: true, canvas_id: CANVAS_ID } }]]);
});

/** A template whose output is the board's title line, so a test controls the content by the title. */
const template: CanvasTemplate<HouseholdBoard> = {
  key: 'household_board',
  version: 7,
  render: (board) => `# ${board.brief.dayNumber}일차\n`,
};

const board = (dayNumber: number): HouseholdBoard =>
  ({
    now: { date: localDate(TODAY), time: localTime('19:03') },
    brief: { date: localDate(TODAY), dayNumber },
    slots: [],
    blocks: [],
    omittedBlocks: 0,
  }) as unknown as HouseholdBoard;

const publisher = () => new SlackCanvasPublisher(services.prisma, BOT_TOKEN, services.clock, template, baseUrl);

async function household(channelId: string | null): Promise<string> {
  const { id } = await seedHouseholdOnly(services.prisma);
  if (channelId !== null) {
    await services.prisma.household.update({ where: { id }, data: { slackChannelId: channelId } });
  }
  return id;
}

const canvasRow = async (householdId: string) =>
  await services.prisma.slackCanvas.findUnique({ where: { householdId } });

describe('상태판 발행', () => {
  it('채널이 없는 가정은 아무것도 부르지 않고 건너뛴다', async () => {
    const householdId = await household(null);

    expect(await publisher().publish(householdId, board(27))).toEqual({ kind: 'skipped', reason: NOT_LINKED });
    expect(received).toEqual([]);
  });

  it('처음에는 채널 캔버스를 만들고 그 id와 내용 해시를 slack_canvas에 남긴다', async () => {
    const householdId = await household(CHANNEL_ID);

    const result = await publisher().publish(householdId, board(27));

    expect(result).toEqual({ kind: 'published', reference: CANVAS_ID });
    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request.url).toBe('/api/conversations.canvases.create');
    expect(request.headers.authorization).toBe(`Bearer ${BOT_TOKEN}`);
    expect(request.body).toEqual({
      channel_id: CHANNEL_ID,
      title: '이유식 상태판',
      document_content: { type: 'markdown', markdown: '# 27일차\n' },
    });
    expect(await canvasRow(householdId)).toMatchObject({
      channelId: CHANNEL_ID,
      canvasId: CANVAS_ID,
      templateVersion: 7,
      contentHash: hashContent(7, '# 27일차\n'),
      updatedAt: services.clock.instant(),
    });
  });

  it('두 번째부터는 canvases.edit의 replace로 문서 전체를 바꾼다', async () => {
    const householdId = await household(CHANNEL_ID);
    await publisher().publish(householdId, board(27));
    received = [];

    const result = await publisher().publish(householdId, board(28));

    expect(result).toEqual({ kind: 'published', reference: CANVAS_ID });
    expect(received).toHaveLength(1);
    expect(received[0].url).toBe('/api/canvases.edit');
    expect(received[0].body).toEqual({
      canvas_id: CANVAS_ID,
      changes: [{ operation: 'replace', document_content: { type: 'markdown', markdown: '# 28일차\n' } }],
    });
    expect((await canvasRow(householdId))?.contentHash).toBe(hashContent(7, '# 28일차\n'));
  });

  it('내용이 같으면 Slack을 부르지 않고 발행된 것으로 답한다', async () => {
    const householdId = await household(CHANNEL_ID);
    await publisher().publish(householdId, board(27));
    received = [];

    expect(await publisher().publish(householdId, board(27))).toEqual({ kind: 'published', reference: CANVAS_ID });
    expect(received).toEqual([]);
  });

  it('템플릿 버전이 오르면 내용이 같아도 한 번 편집한다', async () => {
    const householdId = await household(CHANNEL_ID);
    await publisher().publish(householdId, board(27));
    received = [];

    const bumped = new SlackCanvasPublisher(services.prisma, BOT_TOKEN, services.clock, { ...template, version: 8 }, baseUrl);
    await bumped.publish(householdId, board(27));

    expect(received.map((request) => request.url)).toEqual(['/api/canvases.edit']);
    expect(await canvasRow(householdId)).toMatchObject({ templateVersion: 8, contentHash: hashContent(8, '# 27일차\n') });
  });

  it('사람이 만든 캔버스가 이미 있으면 가져가지 않고 건너뛴다', async () => {
    const householdId = await household(CHANNEL_ID);
    replies.set('/api/conversations.canvases.create', { status: 200, body: { ok: false, error: 'channel_canvas_already_exists' } });

    expect(await publisher().publish(householdId, board(27))).toEqual({ kind: 'skipped', reason: CANVAS_EXISTS });
    expect(await canvasRow(householdId)).toBeNull();
  });

  it('손으로 연결한 캔버스(해시 없음)는 다음 발행에서 반드시 한 번 편집된다', async () => {
    const householdId = await household(CHANNEL_ID);
    await services.prisma.slackCanvas.create({
      data: { householdId, channelId: CHANNEL_ID, canvasId: 'F0HANDMADE', templateVersion: 7, contentHash: '', updatedAt: new Date() },
    });

    expect(await publisher().publish(householdId, board(27))).toEqual({ kind: 'published', reference: 'F0HANDMADE' });
    expect(received.map((request) => request.url)).toEqual(['/api/canvases.edit']);
    expect(received[0].body).toMatchObject({ canvas_id: 'F0HANDMADE' });
  });

  it('채널이 옮겨지면 새 채널에 캔버스를 다시 만든다', async () => {
    const householdId = await household(CHANNEL_ID);
    await publisher().publish(householdId, board(27));
    await services.prisma.household.update({ where: { id: householdId }, data: { slackChannelId: 'C0NEW' } });
    replies.set('/api/conversations.canvases.create', { status: 200, body: { ok: true, canvas_id: 'F0NEW' } });
    received = [];

    expect(await publisher().publish(householdId, board(27))).toEqual({ kind: 'published', reference: 'F0NEW' });
    expect(received[0].body).toMatchObject({ channel_id: 'C0NEW' });
    expect(await canvasRow(householdId)).toMatchObject({ channelId: 'C0NEW', canvasId: 'F0NEW' });
  });

  it('HTTP 200에 ok가 false면 성공이 아니라 던지고, 기록은 그대로다', async () => {
    const householdId = await household(CHANNEL_ID);
    await publisher().publish(householdId, board(27));
    replies.set('/api/canvases.edit', { status: 200, body: { ok: false, error: 'canvas_editing_locked' } });

    await expect(publisher().publish(householdId, board(28))).rejects.toThrow(/canvas_editing_locked/);
    expect((await canvasRow(householdId))?.contentHash).toBe(hashContent(7, '# 27일차\n'));
  });

  it('생성 응답에 canvas_id가 없으면 던진다', async () => {
    const householdId = await household(CHANNEL_ID);
    replies.set('/api/conversations.canvases.create', { status: 200, body: { ok: true } });

    await expect(publisher().publish(householdId, board(27))).rejects.toThrow(/canvas_id/);
  });

  it('HTTP 500을 받으면 던진다', async () => {
    const householdId = await household(CHANNEL_ID);
    replies.set('/api/conversations.canvases.create', { status: 500, body: { ok: false, error: 'internal_error' } });

    await expect(publisher().publish(householdId, board(27))).rejects.toThrow(/500/);
  });
});
