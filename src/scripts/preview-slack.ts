import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { ApplicationModule } from '../application/application.module.js';
import { DailyBrief } from '../application/daily-brief.js';
import { DailyBriefService } from '../application/daily-brief.service.js';
import { ReactionPrompt } from '../application/ports/brief-delivery.port.js';
import type { AppEnv } from '../config/env.js';
import { APP_ENV, PrismaService } from '../infrastructure/prisma/prisma.service.js';
import { SLACK_API_BASE_URL, postMessage } from '../slack/outbound/slack-brief-delivery.js';
import { SlackMessage, context } from '../slack/templates/blocks.js';
import { dailyBriefTemplate } from '../slack/templates/daily-brief.js';
import { TemplateKey } from '../slack/templates/message-template.js';
import { reactionPromptTemplate } from '../slack/templates/reaction-prompt.js';

/**
 * Renders today's messages from the real brief and posts them to a channel, to see a layout before
 * the morning does (ADR 0007).
 *
 * Neither the delivery log nor `slack_message` is written: a preview is not a delivery, and a
 * `brief_delivery` row would stop the real brief from going out today. The buttons are real,
 * though, so the preview says so in its first line.
 *
 * Only `ApplicationModule` is booted, not `AppModule`, so no cron job starts in this process.
 *
 *   node dist/scripts/preview-slack.js --household 재하네
 *   node dist/scripts/preview-slack.js --household 재하네 --channel C0123ABCD --template daily_brief
 *   node dist/scripts/preview-slack.js --household 재하네 --dry-run
 */
const USAGE = `사용법:
  --household <이름>     대상 가정.
  --channel <채널 id>    보낼 채널. 없으면 그 가정에 연결된 채널이다.
  --template <키>        daily_brief, reaction_prompt, all 중 하나. 기본 all
  --dry-run              보내지 않고 페이로드 JSON을 출력한다. Block Kit Builder에 붙여 넣을 수 있다.`;

const TEMPLATES: readonly TemplateKey[] = ['daily_brief', 'reaction_prompt'];

const PREVIEW_BANNER = ':warning: *[미리보기]* 버튼을 누르면 실제로 기록됩니다.';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      household: { type: 'string' },
      channel: { type: 'string' },
      template: { type: 'string', default: 'all' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });

  if (values.help === true) {
    console.log(USAGE);
    return;
  }
  const householdName = values.household?.trim();
  if (householdName === undefined || householdName === '') fail(`--household가 필요합니다.\n\n${USAGE}`);
  const keys = selectedTemplates(values.template);

  const app = await NestFactory.createApplicationContext(ApplicationModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService, { strict: false });
    const env = app.get<AppEnv>(APP_ENV, { strict: false });

    const household = await prisma.household.findFirst({
      where: { name: householdName },
      select: { id: true, slackChannelId: true },
    });
    if (household === null) fail(`그런 가정이 없습니다: ${householdName}`);

    const brief = await app.get(DailyBriefService).get(household.id);
    const messages = keys.flatMap((key) => render(key, brief));

    if (values['dry-run'] === true) {
      for (const { key, message } of messages) console.log(`--- ${key} ---\n${JSON.stringify(message, null, 2)}`);
      return;
    }

    const channelId = values.channel?.trim() || household.slackChannelId;
    if (channelId === null || channelId === '') {
      fail(`${householdName}에 연결된 채널이 없습니다. --channel로 지정하거나 pnpm slack-link로 연결하세요.`);
    }
    for (const { key, message } of messages) {
      const ts = await postMessage(SLACK_API_BASE_URL, env.slackBotToken, channelId, withBanner(message));
      console.log(`${key}: ${channelId}에 보냈습니다 (ts ${ts}, 블록 ${message.blocks.length}개)`);
    }
  } finally {
    await app.close();
  }
}

function selectedTemplates(value: string | undefined): readonly TemplateKey[] {
  if (value === undefined || value === 'all') return TEMPLATES;
  const key = TEMPLATES.find((candidate) => candidate === value);
  if (key === undefined) fail(`알 수 없는 템플릿입니다: ${value}\n\n${USAGE}`);
  return [key];
}

/**
 * The follow-up is built from today's new ingredients of the first slot that has any, the way the
 * dispatcher builds it once that meal is fed. With no new ingredient there is nothing to ask.
 */
function render(key: TemplateKey, brief: DailyBrief): { key: TemplateKey; message: SlackMessage }[] {
  if (key === 'daily_brief') return [{ key, message: dailyBriefTemplate.render(brief) }];

  const [first] = brief.newIngredients;
  if (first === undefined) {
    console.log('reaction_prompt: 오늘 새 재료가 없어 건너뜁니다.');
    return [];
  }
  const prompt: ReactionPrompt = {
    date: brief.date,
    slot: first.slot,
    ingredients: brief.newIngredients
      .filter((entry) => entry.slot === first.slot)
      .map(({ ingredientId, name, exposureNumber }) => ({ ingredientId, name, exposureNumber })),
  };
  return [{ key, message: reactionPromptTemplate.render(prompt) }];
}

function withBanner(message: SlackMessage): SlackMessage {
  return { text: `[미리보기] ${message.text}`, blocks: [context(PREVIEW_BANNER), ...message.blocks] };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

await main();
