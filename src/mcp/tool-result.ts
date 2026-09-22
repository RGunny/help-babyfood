import type { CallToolResult } from '@modelcontextprotocol/server';
import { ApplicationError } from '../application/errors.js';
import { DomainError } from '../domain/errors.js';

export function ok(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/**
 * Runs a tool body and turns the two error layers into something the model can act on.
 *
 * `DomainError` and `ApplicationError` are both answers, not faults: an unregistered ingredient
 * name or a reused idempotency key tells the agent what to fix. They come back as `isError: true`
 * with the code beside the message — the SDK would already convert a thrown exception, but it
 * keeps only the message, and the code is the part that is stable enough to branch on.
 *
 * Everything else is left to throw. A Prisma failure or a bug of ours is not a thing the model can
 * correct, and describing it to the model only invites a retry loop.
 */
export async function toolResult(body: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await body());
  } catch (error) {
    if (error instanceof DomainError || error instanceof ApplicationError) {
      return {
        content: [{ type: 'text', text: `${error.code}: ${error.message}` }],
        structuredContent: { code: error.code, message: error.message },
        isError: true,
      };
    }
    throw error;
  }
}
