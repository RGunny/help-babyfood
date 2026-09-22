import { DailyBrief } from '../../application/daily-brief.js';
import { BriefDeliveryPort, DeliveryResult, ReactionPrompt } from '../../application/ports/brief-delivery.port.js';
import { PrismaTransaction } from '../../infrastructure/prisma/prisma.service.js';
import { SlackMessage, renderBrief } from './render-brief.js';
import { renderReactionPrompt } from './render-reaction-prompt.js';

export const SLACK_API_BASE_URL = 'https://slack.com/api';

/** 채널이 연결되지 않은 가정. 재시도로 고쳐지지 않으므로 실패가 아니라 건너뜀이다. */
export const NOT_LINKED = 'not_linked';

/** The part of a `chat.postMessage` response this reads. Anything else in the body is ignored. */
interface PostMessageResponse {
  readonly ok?: unknown;
  readonly error?: unknown;
  readonly ts?: unknown;
}

/**
 * Posts the brief and the follow-up to the household's channel with `chat.postMessage`.
 *
 * Plain `fetch` rather than `@slack/web-api` (ADR 0006), which moves one duty here: Slack answers a
 * failed call with HTTP 200 and `{"ok": false, "error": "..."}`. The HTTP status alone would record
 * `channel_not_found` and `invalid_auth` as sent, so the body's `ok` decides, and anything but
 * `true` throws with Slack's error in the message for the delivery log to keep.
 *
 * The channel id is read from Prisma directly. Looking up an identifier is not a use case (ADR
 * 0004, "층별 결합"), and this reads nothing else from the store.
 *
 * `baseUrl` is a constructor argument so that a test can point it at a fake server. It is not an
 * environment variable: production has one Slack.
 */
export class SlackBriefDelivery implements BriefDeliveryPort {
  constructor(
    private readonly prisma: PrismaTransaction,
    private readonly botToken: string,
    private readonly baseUrl: string = SLACK_API_BASE_URL,
  ) {}

  async deliverDailyBrief(householdId: string, brief: DailyBrief): Promise<DeliveryResult> {
    return await this.post(householdId, renderBrief(brief));
  }

  async deliverReactionPrompt(householdId: string, prompt: ReactionPrompt): Promise<DeliveryResult> {
    return await this.post(householdId, renderReactionPrompt(prompt));
  }

  private async post(householdId: string, message: SlackMessage): Promise<DeliveryResult> {
    const household = await this.prisma.household.findUnique({
      where: { id: householdId },
      select: { slackChannelId: true },
    });
    const channel = household?.slackChannelId ?? null;
    if (channel === null) return { kind: 'skipped', reason: NOT_LINKED };

    const response = await fetch(`${this.baseUrl}/chat.postMessage`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.botToken}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text: message.text, blocks: message.blocks }),
    });
    if (!response.ok) {
      throw new Error(`Slack chat.postMessage가 HTTP ${response.status}로 실패했습니다`);
    }

    const body = (await response.json()) as PostMessageResponse;
    // HTTP 200이어도 실패일 수 있다. 판정은 본문의 "ok"로 한다.
    if (body.ok !== true) {
      throw new Error(`Slack chat.postMessage가 실패했습니다: ${String(body.error ?? 'unknown_error')}`);
    }
    if (typeof body.ts !== 'string') {
      throw new Error('Slack chat.postMessage 응답에 ts가 없습니다');
    }
    return { kind: 'sent', reference: body.ts };
  }
}
