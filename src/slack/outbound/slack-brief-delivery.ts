import { Logger } from '@nestjs/common';
import { DailyBrief } from '../../application/daily-brief.js';
import { BriefDeliveryPort, DeliveryResult, ReactionPrompt } from '../../application/ports/brief-delivery.port.js';
import { ClockPort } from '../../application/ports/clock.port.js';
import { PrismaTransaction } from '../../infrastructure/prisma/prisma.service.js';
import { SlackMessage } from '../templates/blocks.js';
import { dailyBriefTemplate } from '../templates/daily-brief.js';
import { MessageTemplate } from '../templates/message-template.js';
import { reactionPromptTemplate } from '../templates/reaction-prompt.js';
import { SLACK_API_BASE_URL, callSlackApi } from './slack-api.js';
import { SlackMessageLog } from './slack-message-log.js';

export { SLACK_API_BASE_URL };

/** 채널이 연결되지 않은 가정. 재시도로 고쳐지지 않으므로 실패가 아니라 건너뜀이다. */
export const NOT_LINKED = 'not_linked';

/** The part of a `chat.postMessage` response this reads. Anything else in the body is ignored. */
interface PostMessageResponse {
  readonly ts?: unknown;
}

/**
 * Posts the brief and the follow-up to the household's channel with `chat.postMessage`, and keeps
 * what it posted in `slack_message`.
 *
 * The call itself goes through `callSlackApi`, which is where the `ok: false` judgement of ADR
 * 0006 lives, so that a failed post throws with Slack's error for the delivery log to keep.
 *
 * The channel id is read from Prisma directly. Looking up an identifier is not a use case (ADR
 * 0004, "층별 결합"), and this reads nothing else from the store.
 *
 * `baseUrl` is an option so that a test can point it at a fake server. It is not an environment
 * variable: production has one Slack.
 */
export class SlackBriefDelivery implements BriefDeliveryPort {
  private readonly logger = new Logger(SlackBriefDelivery.name);

  constructor(
    private readonly prisma: PrismaTransaction,
    private readonly botToken: string,
    private readonly messageLog: SlackMessageLog,
    private readonly clock: ClockPort,
    private readonly baseUrl: string = SLACK_API_BASE_URL,
  ) {}

  async deliverDailyBrief(householdId: string, brief: DailyBrief): Promise<DeliveryResult> {
    return await this.post(householdId, dailyBriefTemplate, brief);
  }

  async deliverReactionPrompt(householdId: string, prompt: ReactionPrompt): Promise<DeliveryResult> {
    return await this.post(householdId, reactionPromptTemplate, prompt);
  }

  private async post<Input>(
    householdId: string,
    template: MessageTemplate<Input>,
    input: Input,
  ): Promise<DeliveryResult> {
    const household = await this.prisma.household.findUnique({
      where: { id: householdId },
      select: { slackChannelId: true },
    });
    const channelId = household?.slackChannelId ?? null;
    if (channelId === null) return { kind: 'skipped', reason: NOT_LINKED };

    const message = template.render(input);
    const messageTs = await postMessage(this.baseUrl, this.botToken, channelId, message);

    // 메시지는 이미 채널에 있다. 여기서 던지면 발송 로그가 실패로 남고 재시도가 같은 브리프를
    // 한 번 더 보낸다. 스냅숏 하나가 빠지는 쪽을 택한다(ADR 0007).
    try {
      await this.messageLog.record({
        householdId,
        channelId,
        messageTs,
        templateKey: template.key,
        templateVersion: template.version,
        message,
        postedAt: this.clock.instant(),
      });
    } catch (error) {
      this.logger.error(
        `보낸 메시지의 스냅숏을 남기지 못했습니다: ${template.key} ${channelId} ${messageTs}`,
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
    return { kind: 'sent', reference: messageTs };
  }
}

/**
 * One `chat.postMessage` call. Returns the message's `ts`, or throws with what Slack said.
 * `src/scripts/preview-slack.ts` posts through this too, so a preview fails the way a brief would.
 */
export async function postMessage(
  baseUrl: string,
  botToken: string,
  channelId: string,
  message: SlackMessage,
): Promise<string> {
  const body = await callSlackApi<PostMessageResponse>(baseUrl, botToken, 'chat.postMessage', {
    channel: channelId,
    text: message.text,
    blocks: message.blocks,
  });
  if (typeof body.ts !== 'string') {
    throw new Error('Slack chat.postMessage 응답에 ts가 없습니다');
  }
  return body.ts;
}
