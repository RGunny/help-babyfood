import { Prisma } from '../../generated/prisma/client.js';
import { PrismaTransaction } from '../../infrastructure/prisma/prisma.service.js';
import { SlackMessage } from '../templates/blocks.js';
import { TemplateKey } from '../templates/message-template.js';

/** One message as it went out, and where it went. */
export interface PostedMessage {
  readonly householdId: string;
  readonly channelId: string;
  readonly messageTs: string;
  readonly templateKey: TemplateKey;
  readonly templateVersion: number;
  readonly message: SlackMessage;
  readonly postedAt: Date;
}

/** Where a posted message is kept, so that what a parent saw can be shown again (ADR 0007). */
export interface SlackMessageLog {
  record(posted: PostedMessage): Promise<void>;
}

/**
 * Writes the snapshot to `slack_message`.
 *
 * Slack-only data, so the adapter writes it to Prisma directly, the same way it reads the
 * household's channel. The delivery log (`brief_delivery`) belongs to the application port and
 * does not know Block Kit.
 */
export class PrismaSlackMessageLog implements SlackMessageLog {
  constructor(private readonly prisma: PrismaTransaction) {}

  async record(posted: PostedMessage): Promise<void> {
    await this.prisma.slackMessage.create({
      data: {
        householdId: posted.householdId,
        channelId: posted.channelId,
        messageTs: posted.messageTs,
        templateKey: posted.templateKey,
        templateVersion: posted.templateVersion,
        payload: { text: posted.message.text, blocks: posted.message.blocks } as unknown as Prisma.InputJsonObject,
        postedAt: posted.postedAt,
      },
    });
  }
}
