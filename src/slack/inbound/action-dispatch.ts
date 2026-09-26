import { Logger } from '@nestjs/common';
import { ApplicationError } from '../../application/errors.js';
import { NoFeedService } from '../../application/no-feed.service.js';
import { HouseholdReader } from '../../application/ports/household-write.port.js';
import { ReactionService } from '../../application/reaction.service.js';
import { StockService } from '../../application/stock.service.js';
import { DomainError } from '../../domain/errors.js';
import { SlackAction, decodeAction } from '../actions.js';
import {
  BATCH_DISCARDED,
  PROCESSING_FAILED,
  UNKNOWN_BUTTON,
  UNKNOWN_INGREDIENT,
  UNKNOWN_SLACK_USER,
  noFeedRecorded,
  reactionRecorded,
  refused,
} from '../templates/button-reply.js';
import { SlackMember } from './slack-member.resolver.js';

/** One tapped button, as much of the `block_actions` payload as the dispatch reads. */
export interface ButtonTap {
  readonly slackUserId: string;
  readonly responseUrl: string;
  readonly messageTs: string;
  readonly actionId: string;
  readonly value: string;
}

/** The three use cases a button can reach, and the reader that turns an ingredient id into its name. */
export interface ButtonUseCases {
  readonly noFeed: Pick<NoFeedService, 'register'>;
  readonly reaction: Pick<ReactionService, 'record'>;
  readonly stock: Pick<StockService, 'discardBatch'>;
  readonly reader: HouseholdReader;
}

export interface MemberLookup {
  resolve(slackUserId: string): Promise<SlackMember | null>;
}

/** Sends a sentence back to the parent who tapped, visible only to them. */
export type EphemeralReply = (responseUrl: string, text: string) => Promise<void>;

/**
 * Same message, same button, same value: a second tap of one button. Anything else is a different
 * request. `value` is what tells two "폐기 완료" buttons of one brief apart; without it the second
 * batch would hit `IDEMPOTENCY_KEY_REUSED` and never be discarded (ADR 0006).
 */
export function idempotencyKeyOf(tap: ButtonTap): string {
  return `slack:${tap.messageTs}:${tap.actionId}:${tap.value}`;
}

/**
 * Carries a button tap from the decoded action to the use case and back to the parent.
 *
 * Runs after the 200 has gone out, so it has nobody to throw to: `handle` never rejects. A rejected
 * promise that nobody awaits is an unhandled rejection, and Node ends the process on one. Every
 * outcome, errors included, becomes a sentence on `response_url` instead.
 *
 * No stock rule lives here. Each button maps to one existing use case, and what the button means is
 * the use case's business.
 */
export class SlackActionDispatcher {
  private readonly logger = new Logger(SlackActionDispatcher.name);

  constructor(
    private readonly useCases: ButtonUseCases,
    private readonly members: MemberLookup,
    private readonly reply: EphemeralReply,
  ) {}

  async handle(tap: ButtonTap): Promise<void> {
    try {
      await this.reply(tap.responseUrl, await this.process(tap));
    } catch (error) {
      // 통보조차 실패했다. 부모에게 닿을 길이 없으므로 서버 로그에만 남긴다.
      this.logger.error('Slack 버튼 결과를 response_url로 보내지 못했습니다', stackOf(error));
    }
  }

  private async process(tap: ButtonTap): Promise<string> {
    try {
      const member = await this.members.resolve(tap.slackUserId);
      if (member === null) return UNKNOWN_SLACK_USER;
      const action = decodeAction(tap.actionId, tap.value);
      if (action === null) return UNKNOWN_BUTTON;
      return await this.dispatch(member, action, idempotencyKeyOf(tap));
    } catch (error) {
      if (error instanceof DomainError || error instanceof ApplicationError) {
        return refused(error.message);
      }
      // 내부 오류의 문장은 부모가 고칠 수 있는 것이 아니고, 밖으로 보낼 것도 아니다.
      this.logger.error('Slack 버튼 처리 중 예상하지 못한 오류가 났습니다', stackOf(error));
      return PROCESSING_FAILED;
    }
  }

  private async dispatch(member: SlackMember, action: SlackAction, idempotencyKey: string): Promise<string> {
    const { householdId, actor } = member;
    switch (action.kind) {
      case 'no_feed': {
        await this.useCases.noFeed.register({
          householdId,
          actor,
          idempotencyKey,
          date: action.date,
          slot: action.slot,
          thawed: action.thawed,
          reason: null,
        });
        return noFeedRecorded(action.date, action.slot, action.thawed);
      }
      case 'reaction': {
        const ingredientName = await this.ingredientName(householdId, action.ingredientId);
        if (ingredientName === null) return UNKNOWN_INGREDIENT;
        await this.useCases.reaction.record({
          householdId,
          actor,
          idempotencyKey,
          date: action.date,
          slot: action.slot,
          ingredientName,
          result: action.result,
        });
        return reactionRecorded(action.date, action.slot, ingredientName, action.result);
      }
      case 'discard': {
        // 브리프의 폐기 완료 버튼은 임계일을 넘긴 배치에만 붙는다(기획안 4.5절).
        await this.useCases.stock.discardBatch({
          householdId,
          actor,
          idempotencyKey,
          batchId: action.batchId,
          reason: 'expired',
        });
        return BATCH_DISCARDED;
      }
    }
  }

  /**
   * The button carries the ingredient id, the use case takes the name. The same lookup
   * `src/mcp/name-directory.ts` does, except that a missing id is an answer here, not a fallback.
   */
  private async ingredientName(householdId: string, ingredientId: string): Promise<string | null> {
    return await this.useCases.reader.read(
      householdId,
      (state) => state.ingredients.find((ingredient) => ingredient.id === ingredientId)?.name ?? null,
    );
  }
}

/**
 * Posts to a `response_url`. Slack accepts up to five posts within thirty minutes of the tap.
 * A non-2xx answer throws, and `SlackActionDispatcher.handle` logs it.
 */
export async function postEphemeral(responseUrl: string, text: string): Promise<void> {
  const response = await fetch(responseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ response_type: 'ephemeral', text }),
  });
  if (!response.ok) {
    throw new Error(`response_url이 HTTP ${response.status}로 응답했습니다`);
  }
}

function stackOf(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
