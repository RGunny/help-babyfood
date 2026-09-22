import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { Caller } from '../auth/caller.js';
import { loadNameDirectory } from '../name-directory.js';
import { ToolDeps } from '../server.factory.js';
import { toolResult } from '../tool-result.js';
import { idempotencyKey, mealSlot } from './schemas.js';

const forbiddenPairings = z
  .array(
    z.object({
      ingredientNames: z.tuple([z.string(), z.string()]),
      scope: z.enum(['same_meal', 'same_day']).describe('한 식단 안인지, 같은 날인지.'),
    }),
  )
  .describe('금지 조합. 통째로 갈아 끼우므로 남길 것도 모두 적는다.');

/**
 * 식단 규칙은 두 종류다. 서버가 검증하는 구조화된 제약과, 에이전트가 읽고 참고하는 텍스트
 * 가이드. 위반은 경고일 뿐 막지 않는다.
 */
export function registerRulesTools(server: McpServer, deps: ToolDeps, caller: Caller): void {
  server.registerTool(
    'get_meal_planning_rules',
    {
      title: '식단 규칙 조회',
      description:
        '서버가 검증하는 제약과 에이전트가 읽는 텍스트 가이드를 돌려준다. 식단을 제안하기 전에 읽는다.',
      inputSchema: z.object({}),
    },
    async () =>
      await toolResult(async () => {
        const names = await loadNameDirectory(deps.reader, caller.householdId);
        const view = await deps.rules.getRules(caller.householdId);
        return {
          forbiddenPairings: view.rules.forbiddenPairings.map((pairing) => ({
            ingredientNames: pairing.ingredientIds.map(names.ingredient),
            scope: pairing.scope,
          })),
          maxFirstIntroductionsPerDay: view.rules.maxFirstIntroductionsPerDay,
          firstIntroductionSlot: view.rules.firstIntroductionSlot,
          textGuidance: view.textGuidance,
        };
      }),
  );

  server.registerTool(
    'update_meal_planning_rules',
    {
      title: '식단 규칙 변경',
      description:
        '제약과 텍스트 가이드를 통째로 바꾼다. 남길 항목도 모두 적어야 한다. 먼저 get_meal_planning_rules로 읽고 고쳐서 보내라.',
      inputSchema: z.object({
        idempotencyKey,
        forbiddenPairings,
        maxFirstIntroductionsPerDay: z
          .number()
          .int()
          .min(0)
          .nullable()
          .describe('하루에 처음 먹이는 재료의 상한. 제한이 없으면 null.'),
        firstIntroductionSlot: mealSlot
          .nullable()
          .describe('새 재료를 도입할 끼니. 정하지 않으면 null.'),
        textGuidance: z.string().nullable().describe('서버가 검사하지 않는 자유 서술.'),
      }),
    },
    async (args) =>
      await toolResult(async () => {
        await deps.rules.update({ ...caller, ...args });
        return {
          forbiddenPairings: args.forbiddenPairings,
          maxFirstIntroductionsPerDay: args.maxFirstIntroductionsPerDay,
          firstIntroductionSlot: args.firstIntroductionSlot,
          textGuidance: args.textGuidance,
        };
      }),
  );
}
