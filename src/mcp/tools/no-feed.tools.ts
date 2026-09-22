import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { NoFeedReport } from '../../application/no-feed.service.js';
import { LocalDate } from '../../domain/shared/local-date.js';
import { MealSlot } from '../../domain/shared/meal-slot.js';
import { Caller } from '../auth/caller.js';
import { loadNameDirectory } from '../name-directory.js';
import { ToolDeps } from '../server.factory.js';
import { toolResult } from '../tool-result.js';
import { dateString, idempotencyKey } from './schemas.js';

/** 7장이 정한 대로 `all`이 더 있다. 그 날짜에 열려 있는 끼니를 전부 가리킨다. */
const noFeedSlot = z.enum(['morning', 'afternoon', 'all']);

export function registerNoFeedTools(server: McpServer, deps: ToolDeps, caller: Caller): void {
  server.registerTool(
    'register_no_feed',
    {
      title: '미급여 등록',
      description:
        '먹이지 못한 끼니를 기록한다. 식단은 취소되지 않고 다음 날로 밀리며, 이후 식단의 날짜가 전부 다시 계산된다. 이미 해동했으면 thawed를 true로 준다: 그 큐브는 되돌릴 수 없어 폐기로 기록된다. 며칠 지난 날짜도 등록할 수 있다.',
      inputSchema: z.object({
        idempotencyKey,
        date: dateString,
        slot: noFeedSlot,
        thawed: z.boolean().describe('큐브를 이미 해동했으면 true.'),
        reason: z.string().nullable(),
      }),
    },
    async (args) =>
      await toolResult(
        async () =>
          await perSlot(deps, caller, args, async (slot, key) =>
            deps.noFeed.register({
              ...caller,
              idempotencyKey: key,
              date: args.date,
              slot,
              thawed: args.thawed,
              reason: args.reason,
            }),
          ),
      ),
  );

  server.registerTool(
    'cancel_no_feed',
    {
      title: '미급여 취소',
      description:
        '잘못 등록한 미급여를 지운다. 날짜가 앞으로 당겨지고, 해동 후로 등록했던 것이면 그때 폐기한 큐브도 되돌아온다.',
      inputSchema: z.object({ idempotencyKey, date: dateString, slot: noFeedSlot }),
    },
    async (args) =>
      await toolResult(
        async () =>
          await perSlot(deps, caller, args, async (slot, key) =>
            deps.noFeed.cancel({ ...caller, idempotencyKey: key, date: args.date, slot }),
          ),
      ),
  );
}

interface SlotArgs {
  readonly idempotencyKey: string;
  readonly date: LocalDate;
  readonly slot: 'morning' | 'afternoon' | 'all';
}

/**
 * Runs the use case once per slot the request names.
 *
 * `all` is resolved to the slots actually open on that date rather than to a fixed pair, because
 * the afternoon slot may start later than the morning one. Each slot gets its own derived
 * idempotency key, so a call that fails half way through can be retried with the same key: the
 * slots already done return their stored result and only the rest run.
 */
async function perSlot(
  deps: ToolDeps,
  caller: Caller,
  args: SlotArgs,
  run: (slot: MealSlot, idempotencyKey: string) => Promise<NoFeedReport>,
): Promise<unknown> {
  const names = await loadNameDirectory(deps.reader, caller.householdId);
  const slots =
    args.slot === 'all'
      ? await deps.reader.read(caller.householdId, (state) => state.calendar.activeSlotsOn(args.date))
      : [args.slot];

  const results = [];
  for (const slot of slots) {
    const report = await run(slot, `${args.idempotencyKey}:${slot}`);
    results.push({
      slot,
      heldDeductions: report.held.map((held) => ({
        ingredientName: names.ingredient(held.ingredientId),
        cubes: held.cubes,
        mealDate: held.mealDate,
      })),
      undiscardable: report.undiscardable.map((need) => ({
        ingredientName: names.ingredient(need.ingredientId),
        cubes: need.cubes,
      })),
    });
  }
  return { date: args.date, slots: results };
}
