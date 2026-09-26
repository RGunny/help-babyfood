import { BoardSyncClaim, BoardSyncDue, BoardSyncLogPort } from '../../application/ports/board-sync-log.port.js';
import { PrismaTransaction } from './prisma.service.js';
import { fromLocalDate } from './mappers/local-date.mapper.js';

/** 판정 질의가 돌려주는 것. 상태 시각은 클레임에 실려 발행 기록으로 돌아온다. */
interface DueRow {
  household_id: string;
  state_changed_at: Date;
  previous_failure: string | null;
}

const MS_PER_SECOND = 1_000;

/**
 * The publication record of ADR 0008 and the query that decides which boards are out of date.
 *
 * Claiming is a read, not an insert: a board is a whole-document replace, so two sweeps publishing
 * the same household do the same thing, and no row has to be won. What the row keeps is the state
 * time and the day the board was last brought up to, and the query compares those against the
 * household's `state_changed_at` and today.
 */
export class PrismaBoardSyncLog implements BoardSyncLogPort {
  constructor(private readonly prisma: PrismaTransaction) {}

  /**
   * Households whose board is behind. Four ways in: never published, a new day, a state change that
   * settled at least `debounceSeconds` ago, or a failure whose retry time has come. A failed row
   * whose retry time has not come is held back whatever else is true of it.
   */
  async claimDue(due: BoardSyncDue): Promise<BoardSyncClaim[]> {
    const debounceCutoff = new Date(due.instant.getTime() - due.debounceSeconds * MS_PER_SECOND);
    const rows = await this.prisma.$queryRaw<DueRow[]>`
      SELECT h.id AS household_id,
             h.state_changed_at,
             CASE WHEN p.status = 'failed'::publication_status THEN p.outcome_reason END AS previous_failure
      FROM household h
      LEFT JOIN board_publication p ON p.household_id = h.id
      WHERE ( p.household_id IS NULL
           OR p.synced_state_at IS NULL
           OR p.synced_on < ${due.today}::date
           OR (p.synced_state_at < h.state_changed_at AND h.state_changed_at <= ${debounceCutoff}) )
        AND ( p.status IS DISTINCT FROM 'failed'::publication_status OR p.next_attempt_at <= ${due.instant} )
      ORDER BY h.created_at
    `;
    return rows.map((row) => ({
      householdId: row.household_id,
      date: due.today,
      stateChangedAt: row.state_changed_at,
      previousFailure: row.previous_failure,
    }));
  }

  async recordPublished(claim: BoardSyncClaim, at: Date): Promise<void> {
    await this.settle(claim, 'published', null, at);
  }

  async recordSkipped(claim: BoardSyncClaim, reason: string, at: Date): Promise<void> {
    await this.settle(claim, 'skipped', reason, at);
  }

  /** The synced columns stay as they were: a failure brings the board up to nothing. */
  async recordFailed(claim: BoardSyncClaim, error: string, at: Date, nextAttemptAt: Date): Promise<void> {
    await this.prisma.boardPublication.upsert({
      where: { householdId: claim.householdId },
      create: {
        householdId: claim.householdId,
        status: 'failed',
        attempts: 1,
        nextAttemptAt,
        outcomeReason: error,
        updatedAt: at,
      },
      update: {
        status: 'failed',
        attempts: { increment: 1 },
        nextAttemptAt,
        outcomeReason: error,
        updatedAt: at,
      },
    });
  }

  /**
   * Published and skipped both move the synced columns forward, to the state time the claim read
   * and the day it was for. A skipped household otherwise comes back every minute.
   */
  private async settle(
    claim: BoardSyncClaim,
    status: 'published' | 'skipped',
    reason: string | null,
    at: Date,
  ): Promise<void> {
    const fields = {
      status,
      syncedStateAt: claim.stateChangedAt,
      syncedOn: fromLocalDate(claim.date),
      attempts: 0,
      nextAttemptAt: null,
      outcomeReason: reason,
      updatedAt: at,
    };
    await this.prisma.boardPublication.upsert({
      where: { householdId: claim.householdId },
      create: { householdId: claim.householdId, ...fields },
      update: fields,
    });
  }
}
