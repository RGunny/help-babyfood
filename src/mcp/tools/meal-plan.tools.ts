import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { MealComposition } from '../../domain/menu/menu.js';
import { Caller } from '../auth/caller.js';
import { NameDirectory, loadNameDirectory } from '../name-directory.js';
import { ToolDeps } from '../server.factory.js';
import { toolResult } from '../tool-result.js';
import { composition, dateString, idempotencyKey, mealSlot, timeString } from './schemas.js';

/**
 * 식단 도구. 식단의 정체성은 날짜가 아니라 끼니 안의 순서이지만, 부모와 에이전트는 날짜로
 * 말하므로 도구는 전부 날짜를 받는다. 순서로의 변환은 애플리케이션이 달력을 통해 한다.
 */
export function registerMealPlanTools(server: McpServer, deps: ToolDeps, caller: Caller): void {
  server.registerTool(
    'import_meal_plan',
    {
      title: '식단표 가져오기',
      description:
        '엑셀 식단표에서 읽은 식단을 끼니 끝에 이어 붙인다. dryRun이 true면 놓일 날짜와 제약 위반만 돌려주고 아무것도 쓰지 않는다. fedThrough를 주면 그 날짜까지의 식단은 이미 먹인 것으로 기록되고 재고는 차감되지 않으며, 그때는 그 끼니에 식단이 하나도 없어야 한다.',
      inputSchema: z.object({
        idempotencyKey,
        dryRun: z.boolean().describe('true면 미리보기만 한다.'),
        slot: mealSlot,
        meals: z
          .array(z.object({ composition, memo: z.string().nullable().optional() }))
          .min(1)
          .describe('식단표의 행을 오래된 것부터 나열한다.'),
        fedThrough: dateString
          .nullable()
          .describe('서비스 이전에 이미 먹인 마지막 날짜. 이관이 아니면 null.'),
      }),
    },
    async (args) =>
      await toolResult(async () => {
        const names = await loadNameDirectory(deps.reader, caller.householdId);
        const command = {
          ...caller,
          idempotencyKey: args.idempotencyKey,
          slot: args.slot,
          meals: args.meals.map((meal) => ({
            composition: meal.composition,
            memo: meal.memo ?? null,
          })),
          fedThrough: args.fedThrough,
        };
        if (args.dryRun) {
          const preview = await deps.mealPlanImport.preview(command);
          return {
            dryRun: true,
            meals: preview.meals.map((meal) => plannedMeal(meal, names)),
            warnings: preview.warnings.map((warning) => ({
              code: warning.code,
              date: warning.date,
              slot: warning.slot,
              ingredientNames: warning.ingredientIds.map(names.ingredient),
            })),
          };
        }
        const imported = await deps.mealPlanImport.commit(command);
        return { dryRun: false, meals: imported.map((meal) => plannedMeal(meal, names)) };
      }),
  );

  server.registerTool(
    'get_meal_plan',
    {
      title: '식단 달력',
      description:
        '날짜마다 일차와 끼니별 식단을 돌려준다. 미급여로 밀린 날짜는 식단이 비어 있다. 제약 위반 경고는 읽을 때마다 다시 계산한다.',
      inputSchema: z.object({ from: dateString, to: dateString }),
    },
    async (args) =>
      await toolResult(async () => {
        const names = await loadNameDirectory(deps.reader, caller.householdId);
        const view = await deps.mealPlan.getMealPlan(caller.householdId, args.from, args.to);
        return {
          days: view.days.map((day) => ({
            date: day.date,
            dayNumber: day.dayNumber,
            slots: day.slots.map((entry) => ({
              slot: entry.slot,
              noFeed: entry.noFeed,
              meal:
                entry.meal === null
                  ? null
                  : {
                      status: entry.meal.status,
                      migrated: entry.meal.migrated,
                      memo: entry.meal.memo,
                      planned: describe(entry.meal.planned, names),
                      actual: entry.meal.actual === null ? null : describe(entry.meal.actual, names),
                    },
            })),
          })),
          warnings: view.warnings.map((warning) => ({
            code: warning.code,
            date: warning.date,
            slot: warning.slot,
            ingredientNames: warning.ingredientIds.map(names.ingredient),
          })),
        };
      }),
  );

  server.registerTool(
    'update_planned_meal',
    {
      title: '식단 계획 변경',
      description:
        '그 날짜와 끼니의 식단 계획을 바꾼다. 이미 먹인 식단이면 기존 차감을 취소하고 새 내용으로 다시 차감한다. memo를 넘기지 않으면 기존 메모를 지우지 않는다.',
      inputSchema: z.object({
        idempotencyKey,
        date: dateString,
        slot: mealSlot,
        composition,
        memo: z.string().nullable().optional(),
      }),
    },
    async (args) =>
      await toolResult(async () => await deps.mealPlan.updatePlannedMeal({ ...caller, ...args })),
  );

  server.registerTool(
    'update_meal_actual_items',
    {
      title: '실제 급여 내용 기록',
      description:
        '계획과 다르게 먹였을 때 실제 내용으로 고친다. composition을 null로 주면 정정을 지우고 계획대로 돌아간다.',
      inputSchema: z.object({
        idempotencyKey,
        date: dateString,
        slot: mealSlot,
        composition: composition.nullable(),
      }),
    },
    async (args) =>
      await toolResult(
        async () => await deps.mealPlan.updateMealActualItems({ ...caller, ...args }),
      ),
  );

  server.registerTool(
    'start_meal_slot',
    {
      title: '끼니 시작',
      description:
        '끼니의 시작일과 식단시간을 정한다. 식단의 날짜와 차감 시점이 여기서 계산되므로, 끼니는 이것을 부른 뒤에야 존재한다. 시작일은 나중에 바꿀 수 없다.',
      inputSchema: z.object({
        idempotencyKey,
        slot: mealSlot,
        startDate: dateString.describe('아무것도 거르지 않았을 때 그 끼니 첫 식단의 날짜.'),
        mealTime: timeString.describe('이 시각이 지나면 서버가 자동으로 차감한다.'),
      }),
    },
    async (args) => await toolResult(async () => await deps.mealSlot.start({ ...caller, ...args })),
  );
}

function plannedMeal(
  meal: { order: number; date: string; migrated: boolean; composition: MealComposition; memo: string | null },
  names: NameDirectory,
) {
  return {
    order: meal.order,
    date: meal.date,
    migrated: meal.migrated,
    memo: meal.memo,
    ...describe(meal.composition, names),
  };
}

/** A composition as the parent would say it back. */
function describe(value: MealComposition, names: NameDirectory) {
  return {
    baseMenuName: value.baseMenuId === null ? null : names.menu(value.baseMenuId),
    toppingIngredientNames: value.toppingIngredientIds.map(names.ingredient),
  };
}
