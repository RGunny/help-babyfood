import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { Caller } from '../auth/caller.js';
import { loadNameDirectory } from '../name-directory.js';
import { ToolDeps } from '../server.factory.js';
import { toolResult } from '../tool-result.js';
import { dateString, idempotencyKey, positiveCubes } from './schemas.js';

/**
 * 재고 도구. 부모가 직접 하는 두 가지 입력 가운데 하나인 조리 후 입고가 여기에 있다.
 */
export function registerStockTools(server: McpServer, deps: ToolDeps, caller: Caller): void {
  server.registerTool(
    'register_cooked_batch',
    {
      title: '조리 배치 입고',
      description:
        '큐브를 만들어 냉동고에 넣었다고 등록한다. 재료명은 재료 마스터에 있어야 하고, 같은 날 만든 같은 재료는 한 배치다.',
      inputSchema: z.object({
        idempotencyKey,
        ingredientName: z.string(),
        cubeWeightGram: z.number().int().positive().describe('큐브 하나의 중량(g).'),
        cookedOn: dateString,
        cubes: positiveCubes.describe('입고한 큐브 개수.'),
      }),
    },
    async (args) =>
      await toolResult(async () => {
        const batch = await deps.stock.registerCookedBatch({ ...caller, ...args });
        return {
          batchId: batch.id,
          ingredientName: args.ingredientName,
          cubeWeightGram: batch.cubeWeightGram,
          cookedOn: batch.cookedOn,
          cubes: args.cubes,
        };
      }),
  );

  server.registerTool(
    'get_stock_status',
    {
      title: '재고 현황',
      description:
        '재료별 합계와 배치 내역, 임계일 알람 대상을 돌려준다. 폐기 대기 큐브도 합계에 든다.',
      inputSchema: z.object({}),
    },
    async () =>
      await toolResult(async () => {
        const names = await loadNameDirectory(deps.reader, caller.householdId);
        const status = await deps.stock.getStockStatus(caller.householdId);
        return {
          ingredients: status.ingredients.map((stock) => ({
            ingredientName: names.ingredient(stock.ingredientId),
            total: stock.total,
            fresh: stock.fresh,
            overdue: stock.overdue,
            weightMismatched: stock.weightMismatched,
            batches: stock.batches.map((batch) => ({
              batchId: batch.batch.id,
              cookedOn: batch.batch.cookedOn,
              cubeWeightGram: batch.batch.cubeWeightGram,
              remaining: batch.remaining,
              expiry: batch.expiry,
              weightMismatched: batch.weightMismatched,
            })),
          })),
          expiryAlerts: status.expiryAlerts.map((batch) => ({
            batchId: batch.batch.id,
            ingredientName: names.ingredient(batch.batch.ingredientId),
            cookedOn: batch.batch.cookedOn,
            remaining: batch.remaining,
            expiry: batch.expiry,
          })),
        };
      }),
  );

  server.registerTool(
    'adjust_stock_by_count',
    {
      title: '실사 조정',
      description:
        '세어 보니 수량이 다를 때 맞춘다. 잔여가 0인 배치도 되돌릴 수 있다. 원장에는 차이만큼의 조정 이벤트가 남는다.',
      inputSchema: z.object({
        idempotencyKey,
        batchId: z.string().describe('get_stock_status가 돌려준 배치 id.'),
        countedCubes: z.number().int().min(0).describe('실제로 세어 본 큐브 개수.'),
        reason: z.string().nullable(),
      }),
    },
    async (args) =>
      await toolResult(async () => {
        await deps.stock.adjustStockByCount({ ...caller, ...args });
        return { batchId: args.batchId, countedCubes: args.countedCubes };
      }),
  );

  server.registerTool(
    'discard_batch',
    {
      title: '폐기 완료',
      description:
        '냉동고에서 실제로 버린 뒤에 부른다. 임계일이 지났다는 이유만으로는 재고가 줄지 않으므로, 이것이 폐기 대기 알람을 끝내는 유일한 방법이다.',
      inputSchema: z.object({
        idempotencyKey,
        batchId: z.string(),
        reason: z.enum(['expired', 'thawed_not_fed', 'other']),
      }),
    },
    async (args) =>
      await toolResult(async () => {
        await deps.stock.discardBatch({ ...caller, ...args });
        return { batchId: args.batchId, discarded: true };
      }),
  );
}
