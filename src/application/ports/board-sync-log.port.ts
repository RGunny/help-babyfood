import { LocalDate } from '../../domain/shared/local-date.js';

/** 한 번의 쓸기가 "지금"을 보는 방식. 시각은 전부 호출자가 준다. */
export interface BoardSyncDue {
  readonly today: LocalDate;
  readonly instant: Date;
  /** 상태가 바뀐 뒤 이만큼 지나야 잡는다. 연속된 도구 호출이 편집 한 번으로 묶인다. */
  readonly debounceSeconds: number;
}

/**
 * A household whose board is out of date, as the store saw it at claim time.
 *
 * `stateChangedAt` is the value the claim query read, and it is what `recordPublished` writes back
 * as the synced state. Writing the time of publication instead would let a change that landed
 * between the claim and the publication go unsynced for good (ADR 0008).
 */
export interface BoardSyncClaim {
  readonly householdId: string;
  readonly date: LocalDate;
  readonly stateChangedAt: Date;
  /** The reason the last attempt failed with, so that a repeat is not logged again. Null otherwise. */
  readonly previousFailure: string | null;
}

/**
 * The publication record of chapter 6: which state and which day the board was last brought up to.
 *
 * Unlike the delivery log, claiming here is a plain read. Publishing is a whole-document replace,
 * so two instances publishing the same content is harmless, and nothing needs the claim to be won.
 */
export interface BoardSyncLogPort {
  claimDue(due: BoardSyncDue): Promise<BoardSyncClaim[]>;
  recordPublished(claim: BoardSyncClaim, at: Date): Promise<void>;
  /** 종결이지만 상태 시각은 전진시킨다. 보낼 곳이 없는 가정을 매분 다시 잡지 않기 위해서다. */
  recordSkipped(claim: BoardSyncClaim, reason: string, at: Date): Promise<void>;
  recordFailed(claim: BoardSyncClaim, error: string, at: Date, nextAttemptAt: Date): Promise<void>;
}
