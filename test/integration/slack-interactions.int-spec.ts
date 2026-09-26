import { createHmac, randomUUID } from 'node:crypto';
import { Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { ClockPort } from '../../src/application/ports/clock.port.js';
import { CLOCK } from '../../src/application/ports/tokens.js';
import { AppEnv } from '../../src/config/env.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { localTime } from '../../src/domain/shared/local-time.js';
import { APP_ENV } from '../../src/infrastructure/prisma/prisma.service.js';
import { actionId, encodeDiscard, encodeNoFeed, encodeReaction } from '../../src/slack/actions.js';
import { UNKNOWN_SLACK_USER } from '../../src/slack/templates/button-reply.js';
import { SIGNATURE_TOLERANCE_SECONDS } from '../../src/slack/inbound/signature.js';
import { testDatabaseUrl } from './setup/database.js';
import { Household, INGREDIENTS, MENU_NAME, TestServices, at, buildServices, seedHousehold } from './setup/fixtures.js';

// Slack 버튼 응답의 수신 경로를 실제 AppModule로 본다. 처리는 200을 보낸 뒤에 일어나므로
// 기다릴 관문이 필요하고, 그 관문은 가짜 response_url이 ephemeral을 받은 순간이다. 원장과 기록은
// 반드시 그 뒤에 확인한다.

const SIGNING_SECRET = 'slack-signing-secret-integration';

interface Ephemeral {
  readonly response_type: string;
  readonly text: string;
}

/** Stands in for Slack's `response_url`: every POST is kept by path, and a test can wait for them. */
class ResponseUrlInbox {
  private readonly messages = new Map<string, Ephemeral[]>();
  private waiters: { path: string; count: number; resolve: (messages: Ephemeral[]) => void }[] = [];

  receive(path: string, message: Ephemeral): void {
    const list = [...(this.messages.get(path) ?? []), message];
    this.messages.set(path, list);
    const ready = this.waiters.filter((waiter) => waiter.path === path && list.length >= waiter.count);
    this.waiters = this.waiters.filter((waiter) => !ready.includes(waiter));
    for (const waiter of ready) waiter.resolve(list);
  }

  received(path: string): Ephemeral[] {
    return this.messages.get(path) ?? [];
  }

  /** Resolves once `count` messages have arrived on `path`. The gate, instead of a sleep. */
  async waitFor(path: string, count = 1): Promise<Ephemeral[]> {
    const list = this.received(path);
    if (list.length >= count) return list;
    return await new Promise((resolve) => this.waiters.push({ path, count, resolve }));
  }
}

let services: TestServices;
let app: INestApplication;
let interactionsUrl: string;
let responseServer: Server;
let responseBaseUrl: string;
const inbox = new ResponseUrlInbox();

beforeAll(async () => {
  services = buildServices(at('2026-08-17', '09:00'));

  responseServer = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      inbox.receive(request.url ?? '', JSON.parse(Buffer.concat(chunks).toString('utf8')) as Ephemeral);
      response.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => responseServer.listen(0, '127.0.0.1', resolve));
  responseBaseUrl = `http://127.0.0.1:${(responseServer.address() as AddressInfo).port}`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_ENV)
    .useValue({
      databaseUrl: testDatabaseUrl(),
      lookbackDays: 90,
      databasePoolSize: 5,
      mcpAllowedHosts: ['localhost', '127.0.0.1', '[::1]'],
      mcpAllowedOrigins: ['localhost', '127.0.0.1', '[::1]'],
      // 정합화가 끼어들면 원장을 세는 단정이 실행 시점에 따라 달라진다.
      schedulerEnabled: false,
      slackBotToken: 'xoxb-test',
      slackSigningSecret: SIGNING_SECRET,
    } satisfies AppEnv)
    .overrideProvider(CLOCK)
    // 서버와 테스트가 같은 시계를 본다. 서명의 타임스탬프도 이 시계로 만든다.
    .useValue(services.clock satisfies ClockPort)
    .compile();
  // main.ts와 같은 옵션이다. 없으면 req.rawBody가 비어 모든 요청이 401이 된다.
  app = moduleRef.createNestApplication({ rawBody: true });
  await app.listen(0, '127.0.0.1');
  interactionsUrl = `${await app.getUrl()}/slack/interactions`;
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((resolve, reject) =>
    responseServer.close((error) => (error ? reject(error) : resolve())),
  );
  await services.prisma.$disconnect();
});

afterEach(() => {
  services.clock.set('2026-08-17', '09:00');
});

interface Tapper {
  readonly house: Household;
  readonly slackUserId: string;
}

/** A household with three morning meals from 8/17, stock for all of them, and a Slack-linked member. */
async function linkedHousehold(): Promise<Tapper> {
  const house = await seedHousehold(services, { mealCount: 3 });
  for (const spec of INGREDIENTS) {
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: spec.name,
      cubeWeightGram: spec.servingWeightGram,
      cookedOn: localDate('2026-08-15'),
      cubes: 6,
    });
  }
  const slackUserId = `U${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
  await services.prisma.member.update({ where: { id: house.memberId }, data: { slackUserId } });
  return { house, slackUserId };
}

/** Meals of 8/17 and 8/18 settled as fed, so reactions have something to attach to. */
async function feedThroughAugust18(house: Household): Promise<void> {
  services.clock.set('2026-08-19', '11:00');
  await services.reconcile.run(house.id);
}

interface Button {
  readonly actionId: string;
  readonly value: string;
}

interface TapOptions {
  readonly slackUserId: string;
  readonly button: Button;
  readonly messageTs?: string;
  readonly responsePath?: string;
  readonly secret?: string;
  readonly timestamp?: number;
}

const nowSeconds = (): number => Math.floor(services.clock.instant().getTime() / 1000);

/** A tap, signed the way Slack signs it and posted as `payload=<JSON>`. */
async function tap(options: TapOptions): Promise<Response> {
  const payload = {
    type: 'block_actions',
    user: { id: options.slackUserId },
    response_url: `${responseBaseUrl}${options.responsePath ?? '/unused'}`,
    message: { ts: options.messageTs ?? '1755388800.000100' },
    actions: [{ type: 'button', action_id: options.button.actionId, value: options.button.value }],
  };
  const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
  const timestamp = options.timestamp ?? nowSeconds();
  const signature = `v0=${createHmac('sha256', options.secret ?? SIGNING_SECRET)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')}`;
  return await fetch(interactionsUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-signature': signature,
      'x-slack-request-timestamp': String(timestamp),
    },
    body,
  });
}

const responsePath = (): string => `/actions/${randomUUID()}`;

const noFeedButton = (date: string, thawed: boolean): Button => ({
  actionId: actionId('no_feed', thawed ? 1 : 0),
  value: encodeNoFeed(localDate(date), 'morning', thawed),
});

const reactionButton = (house: Household, date: string, name: string, result: 'clear' | 'reacted'): Button => ({
  actionId: actionId('reaction', result === 'clear' ? 0 : 1),
  value: encodeReaction(localDate(date), 'morning', house.ingredientId(name), result),
});

const ledgerCount = async (house: Household): Promise<number> =>
  await services.prisma.stockLedgerEntry.count({ where: { householdId: house.id } });

const noFeedCount = async (house: Household): Promise<number> =>
  await services.prisma.noFeedRecord.count({ where: { householdId: house.id } });

describe('Slack 버튼 응답', () => {
  it('서명된 요청으로 미급여 버튼을 누르면 미급여 기록과 원장 변화가 남는다', async () => {
    const { house, slackUserId } = await linkedHousehold();
    const before = await ledgerCount(house);
    const path = responsePath();

    const response = await tap({ slackUserId, button: noFeedButton('2026-08-17', true), responsePath: path });
    expect(response.status).toBe(200);
    const [message] = await inbox.waitFor(path);

    expect(message).toEqual({ response_type: 'ephemeral', text: '2026-08-17 오전 미급여(해동 후)를 기록했습니다' });
    expect(await noFeedCount(house)).toBe(1);
    // 해동한 큐브는 되돌릴 수 없으므로 그 끼니의 큐브가 폐기로 원장에 남는다.
    const discarded = await services.prisma.stockLedgerEntry.findMany({
      where: { householdId: house.id, type: 'discarded' },
      select: { reason: true, actorMemberId: true },
    });
    expect(await ledgerCount(house)).toBeGreaterThan(before);
    expect(discarded.length).toBeGreaterThan(0);
    expect(discarded.every((entry) => entry.reason === 'thawed_not_fed')).toBe(true);
    expect(discarded.every((entry) => entry.actorMemberId === house.memberId)).toBe(true);
  });

  it('반응 버튼을 누르면 급여 반응이 기록된다', async () => {
    const { house, slackUserId } = await linkedHousehold();
    await feedThroughAugust18(house);
    const path = responsePath();

    await tap({ slackUserId, button: reactionButton(house, '2026-08-17', '브로콜리', 'clear'), responsePath: path });
    const [message] = await inbox.waitFor(path);

    expect(message.text).toBe('2026-08-17 오전 브로콜리: 이상 없음으로 기록했습니다');
    const reactions = await services.prisma.feedingReaction.findMany({
      where: { householdId: house.id },
      select: { ingredientId: true, result: true, createdByMemberId: true },
    });
    expect(reactions).toEqual([
      { ingredientId: house.ingredientId('브로콜리'), result: 'clear', createdByMemberId: house.memberId },
    ]);
  });

  it('폐기 버튼을 누르면 배치가 폐기된다', async () => {
    const { house, slackUserId } = await linkedHousehold();
    const batch = await services.prisma.cookedBatch.findFirstOrThrow({
      where: { householdId: house.id, ingredientId: house.ingredientId('애호박') },
    });
    const path = responsePath();

    await tap({
      slackUserId,
      button: { actionId: actionId('discard', 0), value: encodeDiscard(batch.id) },
      responsePath: path,
    });
    const [message] = await inbox.waitFor(path);

    expect(message.text).toBe('배치를 폐기했습니다');
    const entries = await services.prisma.stockLedgerEntry.findMany({
      where: { batchId: batch.id, type: 'discarded' },
      select: { delta: true, reason: true },
    });
    expect(entries).toEqual([{ delta: -6, reason: 'expired' }]);
  });

  it('같은 메시지의 서로 다른 배치 두 개를 폐기하면 둘 다 원장에 남는다', async () => {
    const { house, slackUserId } = await linkedHousehold();
    const batches = await services.prisma.cookedBatch.findMany({
      where: {
        householdId: house.id,
        ingredientId: { in: [house.ingredientId('애호박'), house.ingredientId('소고기')] },
      },
      select: { id: true },
    });
    expect(batches).toHaveLength(2);
    const path = responsePath();

    // 한 브리프의 두 "폐기 완료" 버튼이다. message.ts가 같고 action_id의 종류도 같다.
    for (const [ordinal, batch] of batches.entries()) {
      await tap({
        slackUserId,
        button: { actionId: actionId('discard', ordinal), value: encodeDiscard(batch.id) },
        messageTs: '1755388800.000200',
        responsePath: path,
      });
    }
    const messages = await inbox.waitFor(path, 2);

    expect(messages.map((message) => message.text)).toEqual(['배치를 폐기했습니다', '배치를 폐기했습니다']);
    const discarded = await services.prisma.stockLedgerEntry.findMany({
      where: { householdId: house.id, type: 'discarded' },
      select: { batchId: true },
    });
    expect(discarded.map((entry) => entry.batchId).sort()).toEqual(batches.map((batch) => batch.id).sort());
  });

  it('같은 후속 메시지의 두 재료에 "이상 없음"을 누르면 둘 다 기록된다', async () => {
    const { house, slackUserId } = await linkedHousehold();
    await feedThroughAugust18(house);
    const path = responsePath();

    // templates/reaction-prompt.ts는 재료마다 actions 블록을 따로 두므로 두 버튼의 action_id가
    // 둘 다 reaction.0이다. message.ts도 같으니 두 탭을 가르는 것은 value뿐이다.
    const buttons = ['소고기', '브로콜리'].map((name) => reactionButton(house, '2026-08-17', name, 'clear'));
    expect(new Set(buttons.map((button) => button.actionId))).toEqual(new Set(['reaction.0']));
    for (const button of buttons) {
      await tap({ slackUserId, button, messageTs: '1755392400.000300', responsePath: path });
    }
    const messages = await inbox.waitFor(path, 2);

    // 응답은 200 뒤에 비동기로 오므로 도착 순서가 보장되지 않는다.
    expect(messages.map((message) => message.text).sort()).toEqual([
      '2026-08-17 오전 브로콜리: 이상 없음으로 기록했습니다',
      '2026-08-17 오전 소고기: 이상 없음으로 기록했습니다',
    ]);
    const reactions = await services.prisma.feedingReaction.findMany({
      where: { householdId: house.id },
      select: { ingredientId: true },
    });
    expect(reactions.map((reaction) => reaction.ingredientId).sort()).toEqual(
      [house.ingredientId('소고기'), house.ingredientId('브로콜리')].sort(),
    );
  });

  it('같은 브리프의 오전과 오후에 "미급여(해동 전)"을 누르면 둘 다 기록된다', async () => {
    const { house, slackUserId } = await linkedHousehold();
    await services.mealSlot.start({
      householdId: house.id,
      actor: house.actor,
      slot: 'afternoon',
      startDate: localDate('2026-08-17'),
      mealTime: localTime('18:00'),
    });
    await services.mealPlan.appendMeals({
      householdId: house.id,
      actor: house.actor,
      slot: 'afternoon',
      meals: [{ composition: { baseMenuName: MENU_NAME, toppingIngredientNames: ['소고기', '브로콜리'] } }],
    });
    const path = responsePath();

    // templates/daily-brief.ts는 끼니마다 no_feed.0(해동 전)과 no_feed.1(해동 후)을 붙인다. 두 끼니의
    // 해동 전 버튼은 action_id가 둘 다 no_feed.0이고 value의 끼니만 다르다.
    const buttons = (['morning', 'afternoon'] as const).map((slot): Button => ({
      actionId: actionId('no_feed', 0),
      value: encodeNoFeed(localDate('2026-08-17'), slot, false),
    }));
    for (const button of buttons) {
      await tap({ slackUserId, button, messageTs: '1755388800.000400', responsePath: path });
    }
    const messages = await inbox.waitFor(path, 2);

    expect(messages.map((message) => message.text).sort()).toEqual([
      '2026-08-17 오전 미급여(해동 전)를 기록했습니다',
      '2026-08-17 오후 미급여(해동 전)를 기록했습니다',
    ]);
    const records = await services.prisma.noFeedRecord.findMany({
      where: { householdId: house.id },
      select: { slot: true },
    });
    expect(records.map((record) => record.slot).sort()).toEqual(['afternoon', 'morning']);
  });

  it('같은 버튼을 두 번 탭하면 한 번만 기록되고 두 번째 응답도 ephemeral로 온다', async () => {
    const { house, slackUserId } = await linkedHousehold();
    const path = responsePath();
    const button = noFeedButton('2026-08-17', true);

    await tap({ slackUserId, button, responsePath: path });
    await inbox.waitFor(path, 1);
    const afterFirst = await ledgerCount(house);

    await tap({ slackUserId, button, responsePath: path });
    const messages = await inbox.waitFor(path, 2);

    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual(messages[0]);
    expect(messages[1].response_type).toBe('ephemeral');
    expect(await noFeedCount(house)).toBe(1);
    expect(await ledgerCount(house)).toBe(afterFirst);
  });

  it('"이상 없음" 뒤 "반응 있음"을 누르면 나중 것이 남는다', async () => {
    const { house, slackUserId } = await linkedHousehold();
    await feedThroughAugust18(house);
    const path = responsePath();

    await tap({ slackUserId, button: reactionButton(house, '2026-08-17', '소고기', 'clear'), responsePath: path });
    await inbox.waitFor(path, 1);
    await tap({ slackUserId, button: reactionButton(house, '2026-08-17', '소고기', 'reacted'), responsePath: path });
    const messages = await inbox.waitFor(path, 2);

    expect(messages[1].text).toBe('2026-08-17 오전 소고기: 반응 있음으로 기록했습니다');
    const reactions = await services.prisma.feedingReaction.findMany({
      where: { householdId: house.id },
      select: { result: true },
    });
    expect(reactions).toEqual([{ result: 'reacted' }]);
  });

  it('모르는 Slack 사용자는 200이고 안내가 ephemeral로 오지만 원장은 그대로다', async () => {
    const { house } = await linkedHousehold();
    const before = await ledgerCount(house);
    const path = responsePath();

    const response = await tap({
      slackUserId: 'U_NOT_LINKED',
      button: noFeedButton('2026-08-17', true),
      responsePath: path,
    });
    expect(response.status).toBe(200);
    const [message] = await inbox.waitFor(path);

    expect(message).toEqual({ response_type: 'ephemeral', text: UNKNOWN_SLACK_USER });
    expect(await ledgerCount(house)).toBe(before);
    expect(await noFeedCount(house)).toBe(0);
  });

  it('응답이 처리보다 먼저 온다', async () => {
    const { house, slackUserId } = await linkedHousehold();
    const path = responsePath();

    // 정합화 쓸기가 가정 행을 잡고 있는 순간을 흉내 낸다. 처리가 응답보다 먼저라면 이 잠금에 막혀
    // 200이 오지 않는다.
    await services.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM household WHERE id = ${house.id}::uuid FOR UPDATE`;

        const response = await tap({ slackUserId, button: noFeedButton('2026-08-17', false), responsePath: path });

        expect(response.status).toBe(200);
        // 200이 온 시점에는 아직 기록이 없다. 그것이 정상이다.
        expect(await noFeedCount(house)).toBe(0);
        expect(inbox.received(path)).toEqual([]);
      },
      { timeout: 10_000 },
    );

    await inbox.waitFor(path);
    expect(await noFeedCount(house)).toBe(1);
  });
});

describe('Slack 서명', () => {
  /** A tap that is known to produce an ephemeral, sent after a rejected one to prove nothing trailed it. */
  async function sentinel(slackUserId: string): Promise<void> {
    const path = responsePath();
    await tap({ slackUserId: `${slackUserId}_SENTINEL`, button: noFeedButton('2026-08-17', true), responsePath: path });
    await inbox.waitFor(path);
  }

  it('서명이 틀리면 401이고 아무것도 바뀌지 않으며 response_url에도 아무것도 오지 않는다', async () => {
    const { house, slackUserId } = await linkedHousehold();
    const before = await ledgerCount(house);
    const path = responsePath();

    const response = await tap({
      slackUserId,
      button: noFeedButton('2026-08-17', true),
      responsePath: path,
      secret: 'not-the-signing-secret',
    });

    expect(response.status).toBe(401);
    await sentinel(slackUserId);
    expect(inbox.received(path)).toEqual([]);
    expect(await ledgerCount(house)).toBe(before);
    expect(await noFeedCount(house)).toBe(0);
  });

  it('타임스탬프가 5분보다 오래된 요청도 401이다', async () => {
    const { house, slackUserId } = await linkedHousehold();
    const path = responsePath();

    const response = await tap({
      slackUserId,
      button: noFeedButton('2026-08-17', true),
      responsePath: path,
      timestamp: nowSeconds() - SIGNATURE_TOLERANCE_SECONDS - 1,
    });

    expect(response.status).toBe(401);
    await sentinel(slackUserId);
    expect(inbox.received(path)).toEqual([]);
    expect(await noFeedCount(house)).toBe(0);
  });

  it('서명 헤더가 없으면 401이다', async () => {
    const response = await fetch(interactionsUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'payload=%7B%7D',
    });

    expect(response.status).toBe(401);
  });

  it('block_actions가 아닌 서명된 요청은 200으로 끝난다', async () => {
    const body = `payload=${encodeURIComponent(JSON.stringify({ type: 'view_submission' }))}`;
    const timestamp = nowSeconds();
    const signature = `v0=${createHmac('sha256', SIGNING_SECRET).update(`v0:${timestamp}:${body}`).digest('hex')}`;

    const response = await fetch(interactionsUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-slack-signature': signature,
        'x-slack-request-timestamp': String(timestamp),
      },
      body,
    });

    expect(response.status).toBe(200);
  });
});
