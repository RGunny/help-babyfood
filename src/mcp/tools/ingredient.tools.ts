import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { Caller } from '../auth/caller.js';
import { ToolDeps } from '../server.factory.js';
import { toolResult } from '../tool-result.js';
import { idempotencyKey, ingredientCategory } from './schemas.js';

/**
 * 재료 마스터. 모든 차감이 이름을 여기로 풀기 때문에, 여기에 없는 이름은 입고에도 식단에도
 * 들어갈 수 없다.
 */
export function registerIngredientTools(server: McpServer, deps: ToolDeps, caller: Caller): void {
  server.registerTool(
    'register_ingredient',
    {
      title: '재료 등록',
      description:
        '재료 마스터에 하나 더한다. 별칭까지 통틀어 한 호칭은 한 재료에만 붙을 수 있다. 이관 때 이미 검증이 끝난 재료라면 verifiedBeforeMigration을 true로 주면 급여 이력이 없어도 검증완료로 시작한다.',
      inputSchema: z.object({
        idempotencyKey,
        name: z.string(),
        aliases: z.array(z.string()).optional().describe('같은 재료를 가리키는 다른 이름들.'),
        category: ingredientCategory,
        servingWeightGram: z
          .number()
          .int()
          .positive()
          .describe('현재 1회분 중량(g). 큐브 중량이 이 값과 다른 배치는 자동 차감에서 빠진다.'),
        verifiedBeforeMigration: z.boolean().optional(),
      }),
    },
    async (args) => await toolResult(async () => await deps.ingredient.register({ ...caller, ...args })),
  );

  server.registerTool(
    'add_ingredient_alias',
    {
      title: '재료 별칭 추가',
      description: '"브로컬리"를 "브로콜리"에 붙이는 것처럼, 같은 재료를 가리키는 이름을 더한다.',
      inputSchema: z.object({
        idempotencyKey,
        name: z.string().describe('기존 재료의 이름 또는 별칭.'),
        alias: z.string(),
      }),
    },
    async (args) => await toolResult(async () => await deps.ingredient.addAlias({ ...caller, ...args })),
  );

  server.registerTool(
    'update_ingredient_serving_weight',
    {
      title: '1회분 중량 변경',
      description:
        '아기가 자라 1회분이 바뀌었을 때 쓴다. 옛 중량으로 만든 배치는 재고에 남지만 자동 차감에서 빠지고, 재고현황에 중량 불일치로 잡힌다.',
      inputSchema: z.object({
        idempotencyKey,
        name: z.string(),
        servingWeightGram: z.number().int().positive(),
      }),
    },
    async (args) =>
      await toolResult(async () => await deps.ingredient.updateServingWeight({ ...caller, ...args })),
  );
}
