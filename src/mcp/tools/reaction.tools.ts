import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { Caller } from '../auth/caller.js';
import { ToolDeps } from '../server.factory.js';
import { toolResult } from '../tool-result.js';
import { dateString, idempotencyKey, mealSlot } from './schemas.js';

/**
 * 알러지 도입. 상태는 저장하지 않고 급여 이력에서 계산하므로, 반응을 늦게 기록해도 식단을
 * 나중에 정정해도 상태가 알아서 따라온다.
 */
export function registerReactionTools(server: McpServer, deps: ToolDeps, caller: Caller): void {
  server.registerTool(
    'record_feeding_reaction',
    {
      title: '급여 반응 기록',
      description:
        '먹인 뒤 관찰한 결과를 재료별로 남긴다. 이미 먹인 식단에만 기록할 수 있고, 같은 식단과 재료를 다시 기록하면 정정이다. 이상 없음 2회면 검증완료가 되고, 반응 있음이면 그 재료는 식단 제안에서 빠진다.',
      inputSchema: z.object({
        idempotencyKey,
        date: dateString,
        slot: mealSlot,
        ingredientName: z.string().describe('그 식단에 들어 있던 재료. 베이스 메뉴의 재료도 된다.'),
        result: z.enum(['clear', 'reacted']),
        symptomMemo: z.string().nullable().optional(),
      }),
    },
    async (args) =>
      await toolResult(async () => {
        await deps.reaction.record({ ...caller, ...args });
        return { date: args.date, slot: args.slot, ingredientName: args.ingredientName, result: args.result };
      }),
  );

  server.registerTool(
    'get_ingredient_introduction_status',
    {
      title: '재료 도입 상태',
      description:
        '등록된 모든 재료의 도입 상태를 한 줄씩 돌려준다. 미도입, 검증중(이상 없음 횟수와 미기록 횟수), 검증완료, 반응있음 가운데 하나다. 재료 목록 조회로도 쓴다. 재고 방식(cubes, pantry)도 함께 준다.',
      inputSchema: z.object({}),
    },
    async () =>
      await toolResult(async () => {
        const statuses = await deps.reaction.getIntroductionStatus(caller.householdId);
        return statuses.map((entry) => ({
          ingredientName: entry.name,
          status: entry.status,
          stockTracking: entry.stockTracking,
        }));
      }),
  );
}
