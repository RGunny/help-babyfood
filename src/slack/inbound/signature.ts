import { createHmac, timingSafeEqual } from 'node:crypto';

/** How far the request timestamp may sit from now, either way. Slack's documented window. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const VERSION = 'v0';
const UNIX_SECONDS = /^\d+$/;

/**
 * Whether a request really came from Slack, following
 * https://docs.slack.dev/authentication/verifying-requests-from-slack step by step.
 *
 * The base string is built from the bytes that arrived, never from a parsed body: Slack signs
 * `payload=<url-encoded JSON>`, and parsing and re-serialising changes those bytes (ADR 0006).
 *
 * The timestamp check comes first and runs both ways. A replayed request is old; a request whose
 * clock is ahead is not something Slack sends, and accepting it would let a captured signature stay
 * valid for longer than the window.
 */
export function verifySlackSignature(input: {
  readonly signingSecret: string;
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
  readonly rawBody: Buffer;
  readonly now: Date;
}): boolean {
  const { signingSecret, signature, timestamp, rawBody, now } = input;
  if (signature === undefined || timestamp === undefined || !UNIX_SECONDS.test(timestamp)) return false;

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const base = Buffer.concat([Buffer.from(`v0:${timestamp}:`, 'utf8'), rawBody]);
  const digest = createHmac('sha256', signingSecret).update(base).digest('hex');
  const expected = Buffer.from(`${VERSION}=${digest}`, 'utf8');
  const actual = Buffer.from(signature, 'utf8');

  // timingSafeEqual은 길이가 다르면 던진다. 길이는 비밀이 아니므로 먼저 보고 거짓으로 끝낸다.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
