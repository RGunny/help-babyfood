import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReconcileOutcome, ReconcileService } from '../application/reconcile.service.js';
import { SERVICE_TIME_ZONE } from '../infrastructure/clock.js';

export const RECONCILE_JOB = 'reconcile';

/**
 * The periodic reconciliation (plan 4.4). An adapter: it calls the use case and writes down what
 * came back. No stock rule lives here.
 *
 * Every minute rather than at each meal time. A meal becomes due at its meal time, but the times
 * come from the database and a slot can open at any moment, so a job registered per meal time would
 * have to be re-registered on every change and on every instance. Minute ticks read the current
 * schedule instead, and `reconcileMeals` compares against the clock rather than against tick count,
 * so a server that was down catches up on the first tick after it comes back.
 *
 * `waitForCompletion` keeps one process from starting a second sweep on top of a slow one. Across
 * processes nothing is needed: every write locks the household row, and a second sweep finds the
 * state already settled and writes nothing.
 */
@Injectable()
export class ReconcileJob {
  private readonly logger = new Logger(ReconcileJob.name);

  constructor(private readonly reconcile: ReconcileService) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: RECONCILE_JOB,
    timeZone: SERVICE_TIME_ZONE,
    waitForCompletion: true,
  })
  async tick(): Promise<void> {
    let outcomes: readonly ReconcileOutcome[];
    try {
      outcomes = await this.reconcile.runEveryHousehold();
    } catch (error) {
      // 가정 목록조차 읽지 못한 경우다. 다음 tick이 그대로 다시 시도한다.
      this.logger.error('정합화 쓸기를 시작하지 못했습니다', stackOf(error));
      return;
    }
    for (const outcome of outcomes) this.report(outcome);
  }

  /** A sweep that changed nothing is the normal case, and logging it every minute would bury the rest. */
  private report(outcome: ReconcileOutcome): void {
    if (outcome.kind === 'failed') {
      this.logger.error(`정합화가 실패한 가정: ${outcome.householdId}`, stackOf(outcome.error));
      return;
    }
    const { consumedMealIds, revertedMealIds, held } = outcome.report;
    if (consumedMealIds.length === 0 && revertedMealIds.length === 0 && held.length === 0) return;
    this.logger.log(
      `정합화: 가정 ${outcome.householdId}, 급여 완료 ${consumedMealIds.length}건, ` +
        `예정 복귀 ${revertedMealIds.length}건, 보류 ${held.length}건`,
    );
  }
}

function stackOf(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
