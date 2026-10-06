import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { Caller } from '../auth/caller.js';
import { loadNameDirectory } from '../name-directory.js';
import { ToolDeps } from '../server.factory.js';
import { toolResult } from '../tool-result.js';
import { idempotencyKey, positiveCubes } from './schemas.js';

/**
 * 메뉴 마스터.
 *
 * 기획안 7장의 목록에는 없지만 없으면 아무것도 굴러가지 않는다. 메뉴는 "쌀 1개 + 오트밀 1개"라는
 * 큐브 수까지 가진 값인데 엑셀 식단표에는 "쌀오트밀죽"이라는 이름만 있어서, 식단표 가져오기가
 * 구성을 지어낼 수 없다. 재료와 같은 부류의 마스터이므로 같은 방식으로 부모가 만든다.
 */
const components = z
  .array(z.object({ ingredientName: z.string(), cubes: positiveCubes }))
  .min(1)
  .describe('메뉴 한 그릇이 쓰는 재료와 큐브 수.');

export function registerMenuTools(server: McpServer, deps: ToolDeps, caller: Caller): void {
  server.registerTool(
    'register_menu',
    {
      title: '메뉴 등록',
      description:
        '"쌀오트밀죽" 같은 베이스 메뉴를 만든다. 식단이 이 메뉴를 가리키고, 차감이 여기 적힌 큐브 수로 풀린다.',
      inputSchema: z.object({ idempotencyKey, name: z.string(), components }),
    },
    async (args) =>
      await toolResult(async () => {
        const menu = await deps.menu.register({ ...caller, ...args });
        return { name: menu.name, components: args.components };
      }),
  );

  server.registerTool(
    'update_menu',
    {
      title: '메뉴 변경',
      description:
        '메뉴의 이름이나 구성을 바꾼다. 구성은 통째로 갈아 끼우므로 남길 재료도 모두 적어야 한다. 구성을 바꾸면 이미 급여 완료된 끼니도 새 구성으로 다시 차감된다. 잘못 등록한 구성을 고칠 때만 쓰고, 조리 방식이 바뀐 것이면(예: 낱개 큐브에서 합침 큐브로) 새 메뉴를 등록한다.',
      inputSchema: z.object({
        idempotencyKey,
        currentName: z.string().describe('지금 저장돼 있는 이름.'),
        name: z.string().describe('바꿀 이름. 그대로 두려면 currentName과 같게 준다.'),
        components,
      }),
    },
    async (args) =>
      await toolResult(async () => {
        const menu = await deps.menu.update({ ...caller, ...args });
        return { name: menu.name, components: args.components };
      }),
  );

  server.registerTool(
    'get_menus',
    {
      title: '메뉴 목록',
      description: '등록된 메뉴와 각 메뉴의 구성을 돌려준다.',
      inputSchema: z.object({}),
    },
    async () =>
      await toolResult(async () => {
        const names = await loadNameDirectory(deps.reader, caller.householdId);
        const menus = await deps.menu.getMenus(caller.householdId);
        return menus.map((menu) => ({
          name: menu.name,
          components: menu.components.map((component) => ({
            ingredientName: names.ingredient(component.ingredientId),
            cubes: component.cubes,
          })),
        }));
      }),
  );
}
