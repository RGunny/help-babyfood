import type { RawBodyRequest } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ClockPort } from '../../application/ports/clock.port.js';
import { verifySlackSignature } from './signature.js';

/**
 * Stands in front of `/slack/interactions` and turns away anything Slack did not sign.
 *
 * A failure ends with 401 before anything reads the payload. That is the only non-200 answer this
 * route gives: everything after the signature is answered with 200 and reported on `response_url`
 * (ADR 0006).
 *
 * Nothing else belongs here. Looking the member up in a middleware would put a database round trip
 * in front of the 200, which is the ordering the controller exists to avoid.
 *
 * The time comes from `ClockPort.instant()`: the timestamp is Unix seconds, an absolute moment,
 * not a Seoul wall-clock reading.
 */
export function slackSignature(signingSecret: string, clock: ClockPort): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const rawBody = (request as RawBodyRequest<Request>).rawBody;
    const verified =
      rawBody !== undefined &&
      verifySlackSignature({
        signingSecret,
        signature: header(request, 'x-slack-signature'),
        timestamp: header(request, 'x-slack-request-timestamp'),
        rawBody,
        now: clock.instant(),
      });
    if (!verified) {
      response.status(401).end();
      return;
    }
    next();
  };
}

/** Node lower-cases header names. A header sent twice is not something Slack does, so it fails. */
function header(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}
