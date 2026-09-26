import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BoardSyncOutcome, BoardSyncService } from '../application/board-sync.service.js';
import { SERVICE_TIME_ZONE } from '../infrastructure/clock.js';

export const BOARD_SYNC_JOB = 'board-sync';

/**
 * Brings the boards up to date: an adapter that calls the use case and writes down what came back.
 * Which households are due is decided there, from `state_changed_at` and the day (ADR 0008).
 *
 * Every minute, like the other two jobs, and for the same reason: the store is read each time, so
 * nothing has to be re-registered when a household changes.
 */
@Injectable()
export class BoardSyncJob {
  private readonly logger = new Logger(BoardSyncJob.name);

  constructor(private readonly sync: BoardSyncService) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: BOARD_SYNC_JOB,
    timeZone: SERVICE_TIME_ZONE,
    waitForCompletion: true,
  })
  async tick(): Promise<void> {
    let outcomes: readonly BoardSyncOutcome[];
    try {
      outcomes = await this.sync.runEveryHousehold();
    } catch (error) {
      // 판정 질의조차 돌지 못한 경우다. 다음 tick이 그대로 다시 시도한다.
      this.logger.error('상태판 쓸기를 시작하지 못했습니다', stackOf(error));
      return;
    }
    for (const outcome of outcomes) this.report(outcome);
  }

  /**
   * A failure is logged once per reason. The retry comes every five minutes and a reason a person
   * has to fix (a missing scope) would otherwise fill the log until they do.
   */
  private report(outcome: BoardSyncOutcome): void {
    if (outcome.kind === 'failed') {
      if (outcome.repeated) return;
      this.logger.error(`상태판 갱신이 실패한 가정: ${outcome.householdId}`, stackOf(outcome.error));
      return;
    }
    if (outcome.kind === 'skipped') {
      this.logger.warn(`상태판을 올릴 곳이 없는 가정: ${outcome.householdId} (${outcome.reason})`);
      return;
    }
    this.logger.log(`상태판 갱신: 가정 ${outcome.householdId}`);
  }
}

function stackOf(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
