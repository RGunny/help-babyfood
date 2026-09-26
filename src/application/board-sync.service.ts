import { HouseholdBoardService } from './household-board.service.js';
import { BoardPublisherPort } from './ports/board-publisher.port.js';
import { BoardSyncClaim, BoardSyncLogPort } from './ports/board-sync-log.port.js';
import { ClockPort } from './ports/clock.port.js';

/** 상태가 바뀐 뒤 이만큼 기다렸다가 갱신한다. 에이전트가 식단을 한 건씩 고치는 동안을 묶는다. */
export const BOARD_DEBOUNCE_SECONDS = 60;
/** 실패한 가정을 다시 시도하기까지. 스코프처럼 사람이 고쳐야 풀리는 실패가 매분 기록되지 않게 한다. */
export const BOARD_RETRY_DELAY_SECONDS = 300;

const MS_PER_SECOND = 1_000;

/** What one household's turn came to. A failure is a result, not an exception. */
export type BoardSyncOutcome =
  | { readonly kind: 'published'; readonly householdId: string }
  | { readonly kind: 'skipped'; readonly householdId: string; readonly reason: string }
  | {
      readonly kind: 'failed';
      readonly householdId: string;
      readonly error: unknown;
      /** The same reason as last time, so the job does not log it again. */
      readonly repeated: boolean;
    };

/**
 * Brings every out-of-date board up to the current state (ADR 0008).
 *
 * Same shape as `BriefDispatchService`: the store says who is due, the board is built for those
 * households only, and the outcome is written back. The one difference is that a claim here is not
 * won, because publishing twice is harmless; what the claim carries is the state time to sync to.
 */
export class BoardSyncService {
  constructor(
    private readonly log: BoardSyncLogPort,
    private readonly publisher: BoardPublisherPort,
    private readonly board: HouseholdBoardService,
    private readonly clock: ClockPort,
  ) {}

  async runEveryHousehold(): Promise<BoardSyncOutcome[]> {
    const instant = this.clock.instant();
    const claims = await this.log.claimDue({
      today: this.clock.today(),
      instant,
      debounceSeconds: BOARD_DEBOUNCE_SECONDS,
    });

    const outcomes: BoardSyncOutcome[] = [];
    for (const claim of claims) outcomes.push(await this.sync(claim, instant));
    return outcomes;
  }

  private async sync(claim: BoardSyncClaim, instant: Date): Promise<BoardSyncOutcome> {
    const { householdId } = claim;
    try {
      const board = await this.board.get(householdId);
      const result = await this.publisher.publish(householdId, board);
      if (result.kind === 'published') {
        await this.log.recordPublished(claim, instant);
        return { kind: 'published', householdId };
      }
      await this.log.recordSkipped(claim, result.reason, instant);
      return { kind: 'skipped', householdId, reason: result.reason };
    } catch (error) {
      const message = messageOf(error);
      const nextAttemptAt = new Date(instant.getTime() + BOARD_RETRY_DELAY_SECONDS * MS_PER_SECOND);
      await this.log.recordFailed(claim, message, instant, nextAttemptAt);
      return { kind: 'failed', householdId, error, repeated: claim.previousFailure === message };
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
