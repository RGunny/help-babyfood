export const SLACK_API_BASE_URL = 'https://slack.com/api';

/**
 * A Web API call Slack answered with `ok: false`. `code` is Slack's `error` string, the one thing
 * a caller may branch on: `channel_canvas_already_exists` is a skip, most others are a retry.
 */
export class SlackApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
  ) {
    super(`Slack ${method}가 실패했습니다: ${code}`);
    this.name = 'SlackApiError';
  }
}

/**
 * One Web API call with a bot token and a JSON body.
 *
 * Plain `fetch` rather than `@slack/web-api` (ADR 0006), which moves one duty here: Slack answers a
 * failed call with HTTP 200 and `{"ok": false, "error": "..."}`. The HTTP status alone would record
 * `channel_not_found` and `invalid_auth` as success, so the body's `ok` decides, and anything but
 * `true` throws with Slack's error in the message for the logs to keep.
 */
export async function callSlackApi<Response extends object>(
  baseUrl: string,
  botToken: string,
  method: string,
  body: object,
): Promise<Response> {
  const response = await fetch(`${baseUrl}/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${botToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Slack ${method}가 HTTP ${response.status}로 실패했습니다`);
  }

  const parsed = (await response.json()) as { ok?: unknown; error?: unknown };
  // HTTP 200이어도 실패일 수 있다. 판정은 본문의 "ok"로 한다.
  if (parsed.ok !== true) {
    throw new SlackApiError(method, String(parsed.error ?? 'unknown_error'));
  }
  return parsed as Response;
}

export function isSlackApiError(error: unknown, code: string): boolean {
  return error instanceof SlackApiError && error.code === code;
}
