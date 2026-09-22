import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BriefDispatchService, DispatchOutcome } from '../application/brief-dispatch.service.js';
import { SERVICE_TIME_ZONE } from '../infrastructure/clock.js';

export const BRIEF_DISPATCH_JOB = 'brief-dispatch';

/**
 * Sends what is due: today's brief and the follow-up after a meal. An adapter: it calls the use
 * case and writes down what came back. Whether anything is due is decided there, not here.
 *
 * Every minute rather than at each household's brief time. The time differs per household and
 * `update_alert_settings` changes it, so a job registered per brief time would have to be
 * re-registered on every change, and with two instances the change would not reach the other
 * instance's registry and the old time would stay. A minute tick reads the current settings from
 * the database each time, the same reason ADR 0005 gave for the reconciliation job.
 *
 * `waitForCompletion` keeps one process from starting a second sweep on top of a slow one. Across
 * processes the claim row decides who sends, so a second sweep finds nothing to claim.
 */
@Injectable()
export class BriefDispatchJob {
  private readonly logger = new Logger(BriefDispatchJob.name);

  constructor(private readonly dispatch: BriefDispatchService) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: BRIEF_DISPATCH_JOB,
    timeZone: SERVICE_TIME_ZONE,
    waitForCompletion: true,
  })
  async tick(): Promise<void> {
    let outcomes: readonly DispatchOutcome[];
    try {
      outcomes = await this.dispatch.runEveryHousehold();
    } catch (error) {
      // 가정 목록조차 읽지 못한 경우다. 다음 tick이 그대로 다시 시도한다.
      this.logger.error('발송 쓸기를 시작하지 못했습니다', stackOf(error));
      return;
    }
    for (const outcome of outcomes) this.report(outcome);
  }

  /** `skipped` and `deferred` are the normal case, and logging them every minute would bury the rest. */
  private report(outcome: DispatchOutcome): void {
    if (outcome.kind === 'failed') {
      this.logger.error(`발송이 실패한 가정: ${outcome.householdId} (${outcome.target})`, stackOf(outcome.error));
      return;
    }
    if (outcome.kind !== 'sent') return;
    this.logger.log(`발송: 가정 ${outcome.householdId}, ${outcome.target}`);
  }
}

function stackOf(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
