import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { Caller } from '../auth/caller.js';
import { loadNameDirectory } from '../name-directory.js';
import { ToolDeps } from '../server.factory.js';
import { toolResult } from '../tool-result.js';
import { dateString, idempotencyKey, timeString } from './schemas.js';

/** 브리프와 소진 예측, 알람 설정. */
export function registerAlertTools(server: McpServer, deps: ToolDeps, caller: Caller): void {
  server.registerTool(
    'get_daily_brief',
    {
      title: '데일리 브리프',
      description:
        '오늘 날짜와 일차, 끼니별 식단, 새 재료 관찰 안내, 재고현황과 소진 예상일, 부족 예측, 임계개수와 임계일 알람, 확인 필요 항목을 한 번에 돌려준다. 저장된 브리프를 읽는 것이 아니라 부를 때마다 계산한다.',
      inputSchema: z.object({}),
    },
    async () =>
      await toolResult(async () => {
        const brief = await deps.dailyBrief.get(caller.householdId);
        return {
          date: brief.date,
          dayNumber: brief.dayNumber,
          slots: brief.slots,
          newIngredients: brief.newIngredients.map((entry) => ({
            ingredientName: entry.name,
            slot: entry.slot,
            exposureNumber: entry.exposureNumber,
          })),
          stock: brief.stock.map((row) => ({
            ingredientName: row.name,
            total: row.total,
            fresh: row.fresh,
            pendingDiscard: row.pendingDiscard,
            weightMismatched: row.weightMismatched,
            depletionDate: row.depletionDate,
          })),
          shortages: brief.shortages.map((shortage) => ({
            ingredientName: shortage.name,
            plannedCubes: shortage.plannedCubes,
            firstShortageDate: shortage.firstShortageDate,
            shortfallCubes: shortage.shortfallCubes,
          })),
          thresholdAlerts: brief.thresholdAlerts.map((alert) => ({
            ingredientName: alert.name,
            total: alert.total,
            thresholdCubes: alert.thresholdCubes,
          })),
          expiryAlerts: brief.expiryAlerts.map((alert) => ({
            batchId: alert.batchId,
            ingredientName: alert.name,
            cookedOn: alert.cookedOn,
            expiryDate: alert.expiryDate,
            remaining: alert.remaining,
            expiry: alert.stage,
          })),
          needsAttention: {
            heldDeductions: brief.attention.heldDeductions.map((held) => ({
              ingredientName: held.name,
              cubes: held.cubes,
              date: held.date,
              slot: held.slot,
            })),
            unrecordedReactions: brief.attention.unrecordedReactions.map((unrecorded) => ({
              ingredientName: unrecorded.name,
              date: unrecorded.date,
              slot: unrecorded.slot,
            })),
            ruleWarnings: brief.attention.ruleWarnings,
            weightMismatchedBatches: brief.attention.weightMismatchedBatches.map((batch) => ({
              batchId: batch.batchId,
              ingredientName: batch.name,
              cookedOn: batch.cookedOn,
              remaining: batch.remaining,
              cubeWeightGram: batch.cubeWeightGram,
              servingWeightGram: batch.servingWeightGram,
            })),
            planRunwayDays: brief.attention.planRunwayDays,
            planRunwayShort: brief.attention.planRunwayShort,
          },
        };
      }),
  );

  server.registerTool(
    'forecast_shortage',
    {
      title: '부족 예측',
      description:
        '앞으로의 식단을 지금 재고에 대입해, 재료마다 언제 바닥나고 몇 개를 더 만들어야 하는지 돌려준다. 실제 차감과 같은 규칙으로 계산한다.',
      inputSchema: z.object({
        until: dateString.nullable().optional().describe('여기까지만 본다. 비우면 식단 전체.'),
      }),
    },
    async (args) =>
      await toolResult(async () => {
        const names = await loadNameDirectory(deps.reader, caller.householdId);
        const forecasts = await deps.forecast.forecast(caller.householdId, args.until ?? null);
        return forecasts.map((forecast) => ({
          ingredientName: names.ingredient(forecast.ingredientId),
          plannedCubes: forecast.plannedCubes,
          depletionDate: forecast.depletionDate,
          firstShortageDate: forecast.firstShortageDate,
          shortfallCubes: forecast.shortfallCubes,
        }));
      }),
  );

  server.registerTool(
    'get_alert_settings',
    {
      title: '알람 설정 조회',
      description:
        '브리프 시각, 임계일, 재료별 임계개수를 돌려준다. update_alert_settings가 임계개수를 통째로 갈아 끼우므로 고치기 전에 이것을 먼저 읽는다.',
      inputSchema: z.object({}),
    },
    async () =>
      await toolResult(async () => {
        const view = await deps.alertSettings.getSettings(caller.householdId);
        return {
          briefTime: view.settings.briefTime,
          shelfLifeDays: view.settings.shelfLifeDays,
          thresholds: view.thresholds,
        };
      }),
  );

  server.registerTool(
    'update_alert_settings',
    {
      title: '알람 설정 변경',
      description:
        '브리프 시각, 임계일, 재료별 임계개수를 바꾼다. 임계개수는 통째로 갈아 끼우므로 목록에서 빠진 재료는 임계개수가 없어진다.',
      inputSchema: z.object({
        idempotencyKey,
        briefTime: timeString.describe('브리프를 보내는 시각.'),
        shelfLifeDays: z
          .number()
          .int()
          .positive()
          .describe('조리일로부터 임계일까지의 일수. 모든 재료 공통이다.'),
        thresholds: z
          .array(z.object({ ingredientName: z.string(), thresholdCubes: z.number().int().min(0) }))
          .describe('식단이 비어 예측할 수 없는 기간을 위한 보조 기준.'),
      }),
    },
    async (args) =>
      await toolResult(async () => {
        const view = await deps.alertSettings.update({ ...caller, ...args });
        return {
          briefTime: view.settings.briefTime,
          shelfLifeDays: view.settings.shelfLifeDays,
          thresholds: view.thresholds,
        };
      }),
  );
}
