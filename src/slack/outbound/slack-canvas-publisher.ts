import { createHash } from 'node:crypto';
import { HouseholdBoard } from '../../application/household-board.js';
import { BoardPublishResult, BoardPublisherPort } from '../../application/ports/board-publisher.port.js';
import { ClockPort } from '../../application/ports/clock.port.js';
import { PrismaTransaction } from '../../infrastructure/prisma/prisma.service.js';
import { CanvasTemplate } from '../templates/canvas-template.js';
import { householdBoardTemplate } from '../templates/household-board.js';
import { SLACK_API_BASE_URL, callSlackApi, isSlackApiError } from './slack-api.js';
import { NOT_LINKED } from './slack-brief-delivery.js';

/** The title the channel tab shows. The body does not repeat it: the mobile app draws the title itself. */
export const CANVAS_TITLE = '이유식 상태판';

/** Somebody made the channel canvas by hand. The server does not take it over; `pnpm slack-link --canvas` does. */
export const CANVAS_EXISTS = 'channel_canvas_exists';

/** What `slack_canvas` holds for a household. */
interface CanvasRow {
  readonly channelId: string;
  readonly canvasId: string;
  readonly contentHash: string;
}

/**
 * Keeps the household's channel canvas equal to the board (ADR 0008).
 *
 * The first publication creates the channel canvas and remembers its id; every later one replaces
 * the whole document, and only when the content changed. The content hash covers the template
 * version, so raising the version forces one edit even when the board did not move.
 *
 * `slack_canvas` is read and written here directly, like `slack_message`: it is the adapter's own
 * record, and the application's port neither knows a canvas id nor needs one.
 */
export class SlackCanvasPublisher implements BoardPublisherPort {
  constructor(
    private readonly prisma: PrismaTransaction,
    private readonly botToken: string,
    private readonly clock: ClockPort,
    private readonly template: CanvasTemplate<HouseholdBoard> = householdBoardTemplate,
    private readonly baseUrl: string = SLACK_API_BASE_URL,
  ) {}

  async publish(householdId: string, board: HouseholdBoard): Promise<BoardPublishResult> {
    const household = await this.prisma.household.findUnique({
      where: { id: householdId },
      select: { slackChannelId: true, slackCanvas: { select: { channelId: true, canvasId: true, contentHash: true } } },
    });
    const channelId = household?.slackChannelId ?? null;
    if (channelId === null) return { kind: 'skipped', reason: NOT_LINKED };

    const markdown = this.template.render(board);
    const contentHash = hashContent(this.template.version, markdown);
    const canvas = household?.slackCanvas ?? null;

    // 캔버스가 없거나 채널이 옮겨졌으면 새 채널에 만든다. 채널당 하나뿐이라 사람이 만든 것이
    // 있으면 already_exists가 오고, 그때는 서버가 가져가지 않는다.
    if (canvas === null || canvas.channelId !== channelId) {
      let canvasId: string;
      try {
        canvasId = await createChannelCanvas(this.baseUrl, this.botToken, channelId, markdown);
      } catch (error) {
        if (isSlackApiError(error, 'channel_canvas_already_exists')) return { kind: 'skipped', reason: CANVAS_EXISTS };
        throw error;
      }
      await this.remember(householdId, { channelId, canvasId, contentHash });
      return { kind: 'published', reference: canvasId };
    }

    if (canvas.contentHash === contentHash) return { kind: 'published', reference: canvas.canvasId };

    await replaceCanvas(this.baseUrl, this.botToken, canvas.canvasId, markdown);
    await this.remember(householdId, { ...canvas, contentHash });
    return { kind: 'published', reference: canvas.canvasId };
  }

  private async remember(householdId: string, row: CanvasRow): Promise<void> {
    const fields = {
      channelId: row.channelId,
      canvasId: row.canvasId,
      templateVersion: this.template.version,
      contentHash: row.contentHash,
      updatedAt: this.clock.instant(),
    };
    await this.prisma.slackCanvas.upsert({
      where: { householdId },
      create: { householdId, ...fields },
      update: fields,
    });
  }
}

/** SHA-256 over the template version and the markdown, so a layout change never reads as "unchanged". */
export function hashContent(templateVersion: number, markdown: string): string {
  return createHash('sha256').update(`${templateVersion}\n${markdown}`).digest('hex');
}

/** `conversations.canvases.create`: the one canvas a channel can have, made with its first content. */
export async function createChannelCanvas(
  baseUrl: string,
  botToken: string,
  channelId: string,
  markdown: string,
): Promise<string> {
  const body = await callSlackApi<{ canvas_id?: unknown }>(baseUrl, botToken, 'conversations.canvases.create', {
    channel_id: channelId,
    title: CANVAS_TITLE,
    document_content: { type: 'markdown', markdown },
  });
  if (typeof body.canvas_id !== 'string') {
    throw new Error('Slack conversations.canvases.create 응답에 canvas_id가 없습니다');
  }
  return body.canvas_id;
}

/**
 * `canvases.edit` with one `replace` and no section id, which replaces the whole document
 * (https://docs.slack.dev/reference/methods/canvases.edit). Section-by-section editing is one call
 * per operation and can leave a half-edited document behind.
 */
export async function replaceCanvas(baseUrl: string, botToken: string, canvasId: string, markdown: string): Promise<void> {
  await callSlackApi(baseUrl, botToken, 'canvases.edit', {
    canvas_id: canvasId,
    changes: [{ operation: 'replace', document_content: { type: 'markdown', markdown } }],
  });
}
