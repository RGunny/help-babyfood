import { Controller, Inject, Logger, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ButtonTap, SlackActionDispatcher } from './action-dispatch.js';

export const SLACK_ACTION_DISPATCHER = Symbol('SlackActionDispatcher');

/**
 * `POST /slack/interactions`, where Slack sends button taps. The signature was checked by the
 * middleware before this runs.
 *
 * The order is the point of this class:
 *
 *   signature (middleware) → 200 → member lookup → use case → response_url
 *
 * The 200 goes out before anything touches the database. Every button ends in
 * `HouseholdWriter.write`, whose first statement takes the household row `FOR UPDATE`, and the
 * minute sweep may already hold that row. The writer's lock and transaction limits are all above
 * the three seconds Slack waits, so a tap that lands on a sweep would show the parent an error and
 * be sent again. The member lookup waits too: it takes no lock, but getting a pooled connection
 * can itself queue behind the sweep (ADR 0006).
 *
 * The price: if the process dies after the 200 and before the use case runs, the tap is lost and
 * the parent gets no answer. Tapping again is safe, because the idempotency key is built from the
 * message, the button and its value, and the retry records once.
 */
@Controller('slack')
export class InteractionsController {
  private readonly logger = new Logger(InteractionsController.name);

  constructor(@Inject(SLACK_ACTION_DISPATCHER) private readonly dispatcher: SlackActionDispatcher) {}

  @Post('interactions')
  receive(@Req() request: Request, @Res() response: Response): void {
    const payload = parsePayload(request.body);
    response.status(200).end();
    if (payload === null || payload.type !== 'block_actions') return;

    const tap = buttonTapOf(payload);
    if (tap === null) {
      this.logger.warn('버튼 정보가 빠진 block_actions를 받았습니다');
      return;
    }
    // 응답은 이미 나갔다. handle은 안에서 모든 예외를 삼키므로 띄워 둬도 처리되지 않은 거부가 생기지 않는다.
    void this.dispatcher.handle(tap);
  }
}

/** The fields of a `block_actions` payload this reads. Slack sends many more. */
interface InteractionPayload {
  readonly type?: unknown;
  readonly user?: { readonly id?: unknown };
  readonly response_url?: unknown;
  readonly message?: { readonly ts?: unknown };
  readonly actions?: readonly { readonly action_id?: unknown; readonly value?: unknown }[];
}

/** Slack posts `application/x-www-form-urlencoded` with the JSON in one field named `payload`. */
function parsePayload(body: unknown): InteractionPayload | null {
  const raw = (body as { payload?: unknown } | undefined)?.payload;
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as InteractionPayload) : null;
  } catch {
    return null;
  }
}

function buttonTapOf(payload: InteractionPayload): ButtonTap | null {
  const action = Array.isArray(payload.actions) ? payload.actions[0] : undefined;
  const fields = {
    slackUserId: payload.user?.id,
    responseUrl: payload.response_url,
    messageTs: payload.message?.ts,
    actionId: action?.action_id,
    value: action?.value,
  };
  const complete = Object.values(fields).every((value) => typeof value === 'string');
  return complete ? (fields as ButtonTap) : null;
}
