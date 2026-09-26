import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { readEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { householdBoardTemplate } from '../slack/templates/household-board.js';

/**
 * Links a household to the channel its brief goes to, and a member to the Slack user who taps the
 * buttons, from the command line.
 *
 * No MCP tool moves a delivery target. A session that authenticated with a token being able to
 * point the brief at another channel would turn one leaked token into a way of reading a family's
 * day, so this stays on a path that needs database access, not a token. It is the same reason
 * `mint-member-token` is a script.
 *
 * It links what is already there and creates nothing. A household or member that does not exist is
 * a typo, and quietly making a second empty household hides it until the brief never arrives.
 *
 *   node dist/scripts/link-slack.js --household 재하네 --channel C0123ABCD
 *   node dist/scripts/link-slack.js --household 재하네 --member 엄마 --slack-user U0123ABCD
 *   node dist/scripts/link-slack.js --household 재하네 --canvas F0C4HPW0JP7
 *   node dist/scripts/link-slack.js --list
 *
 * `--canvas` hands the server a channel canvas somebody made by hand. A channel holds one canvas,
 * so the server cannot create its own beside it (ADR 0008); once linked, the next sweep fills it.
 */
const USAGE = `사용법:
  --household <이름>     대상 가정.
  --channel <채널 id>    브리프를 보낼 채널. 예: C0123ABCD
  --member <이름>        구성원 이름. --slack-user와 함께 쓴다.
  --slack-user <U...>    그 구성원의 Slack 사용자 id. 버튼을 누른 사람을 찾는 데 쓴다.
  --canvas <F...>        상태판으로 쓸 채널 캔버스 id. 채널이 먼저 연결되어 있어야 한다.
  --list                 연결 상태를 보인다.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      household: { type: 'string' },
      channel: { type: 'string' },
      member: { type: 'string' },
      'slack-user': { type: 'string' },
      canvas: { type: 'string' },
      list: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });

  if (values.help === true) {
    console.log(USAGE);
    return;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: readEnv().databaseUrl, max: 2 }),
  });

  try {
    if (values.list === true) return await list(prisma);
    await link(prisma, values);
  } finally {
    await prisma.$disconnect();
  }
}

async function link(
  prisma: PrismaClient,
  values: { household?: string; channel?: string; member?: string; 'slack-user'?: string; canvas?: string },
): Promise<void> {
  const householdName = required(values.household, '--household');
  const memberName = values.member;
  const slackUserId = values['slack-user'];

  if (values.channel === undefined && memberName === undefined && slackUserId === undefined && values.canvas === undefined) {
    fail(`--channel, --canvas, --member와 --slack-user 중 하나는 있어야 합니다.\n\n${USAGE}`);
  }
  if ((memberName === undefined) !== (slackUserId === undefined)) {
    fail(`--member와 --slack-user는 함께 씁니다.\n\n${USAGE}`);
  }

  const household = await prisma.household.findFirst({
    where: { name: householdName },
    select: { id: true, slackChannelId: true },
  });
  if (household === null) {
    fail(`그런 가정이 없습니다: ${householdName}\n\npnpm member-token으로 먼저 만드세요.`);
  }

  if (values.channel !== undefined) {
    const channelId = nonBlank(values.channel, '--channel');
    await prisma.household.update({
      where: { id: household.id },
      data: { slackChannelId: channelId },
    });
    console.log(`${householdName}의 브리프를 ${channelId}로 보냅니다.`);
    console.log('그 채널에 봇을 초대하지 않으면 발송이 not_in_channel로 실패합니다.');
  }

  if (memberName !== undefined && slackUserId !== undefined) {
    const member = await prisma.member.findFirst({
      where: { householdId: household.id, name: memberName },
      select: { id: true },
    });
    if (member === null) {
      fail(`${householdName}에 그런 구성원이 없습니다: ${memberName}\n\npnpm member-token으로 먼저 만드세요.`);
    }
    const userId = nonBlank(slackUserId, '--slack-user');
    await prisma.member.update({ where: { id: member.id }, data: { slackUserId: userId } });
    console.log(`${householdName}의 ${memberName}을 Slack 사용자 ${userId}에 연결했습니다.`);
  }

  if (values.canvas !== undefined) {
    const canvasId = nonBlank(values.canvas, '--canvas');
    const channelId = values.channel?.trim() || household.slackChannelId;
    if (channelId === null || channelId === '') {
      fail(`${householdName}에 연결된 채널이 없습니다. --channel을 먼저 연결하세요.`);
    }
    // 해시를 비워 두어 다음 쓸기가 반드시 한 번 내용을 쓰게 한다.
    const fields = {
      channelId,
      canvasId,
      templateVersion: householdBoardTemplate.version,
      contentHash: '',
      updatedAt: new Date(),
    };
    await prisma.slackCanvas.upsert({
      where: { householdId: household.id },
      create: { householdId: household.id, ...fields },
      update: fields,
    });
    console.log(`${householdName}의 상태판을 캔버스 ${canvasId}(채널 ${channelId})에 둡니다. 다음 쓸기가 내용을 채웁니다.`);
  }
}

async function list(prisma: PrismaClient): Promise<void> {
  const households = await prisma.household.findMany({
    select: {
      name: true,
      slackChannelId: true,
      slackCanvas: { select: { canvasId: true } },
      members: { select: { name: true, slackUserId: true }, orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (households.length === 0) {
    console.log('가정이 없습니다.');
    return;
  }
  for (const household of households) {
    console.log(
      `${household.name}  채널 ${household.slackChannelId ?? '연결 안 됨'}  캔버스 ${household.slackCanvas?.canvasId ?? '없음'}`,
    );
    for (const member of household.members) {
      console.log(`  ${member.name}  ${member.slackUserId ?? '연결 안 됨'}`);
    }
  }
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === '') {
    fail(`${flag}이 필요합니다.\n\n${USAGE}`);
  }
  return value;
}

function nonBlank(value: string, flag: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    fail(`${flag}에 값이 필요합니다.\n\n${USAGE}`);
  }
  return trimmed;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

await main();
