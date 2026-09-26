import { localDate } from '../domain/shared/local-date.js';
import { localTime } from '../domain/shared/local-time.js';
import { BOARD_DEBOUNCE_SECONDS, BOARD_RETRY_DELAY_SECONDS, BoardSyncService } from './board-sync.service.js';
import { HouseholdBoard } from './household-board.js';
import { HouseholdBoardService } from './household-board.service.js';
import { BoardPublishResult, BoardPublisherPort } from './ports/board-publisher.port.js';
import { BoardSyncClaim, BoardSyncDue, BoardSyncLogPort } from './ports/board-sync-log.port.js';
import { ClockPort } from './ports/clock.port.js';

const DATE = localDate('2026-09-26');
const INSTANT = new Date('2026-09-26T10:03:00.000Z');
const STATE_CHANGED_AT = new Date('2026-09-26T10:01:30.000Z');

class RecordingLog implements BoardSyncLogPort {
  readonly due: BoardSyncDue[] = [];
  readonly published: { claim: BoardSyncClaim; at: Date }[] = [];
  readonly skipped: { claim: BoardSyncClaim; reason: string; at: Date }[] = [];
  readonly failed: { claim: BoardSyncClaim; error: string; at: Date; nextAttemptAt: Date }[] = [];

  constructor(private readonly claims: readonly BoardSyncClaim[]) {}

  async claimDue(due: BoardSyncDue): Promise<BoardSyncClaim[]> {
    this.due.push(due);
    return [...this.claims];
  }

  async recordPublished(claim: BoardSyncClaim, at: Date): Promise<void> {
    this.published.push({ claim, at });
  }

  async recordSkipped(claim: BoardSyncClaim, reason: string, at: Date): Promise<void> {
    this.skipped.push({ claim, reason, at });
  }

  async recordFailed(claim: BoardSyncClaim, error: string, at: Date, nextAttemptAt: Date): Promise<void> {
    this.failed.push({ claim, error, at, nextAttemptAt });
  }
}

class RecordingPublisher implements BoardPublisherPort {
  readonly published: { householdId: string; board: HouseholdBoard }[] = [];

  constructor(private readonly answers: ReadonlyMap<string, BoardPublishResult | Error> = new Map()) {}

  async publish(householdId: string, board: HouseholdBoard): Promise<BoardPublishResult> {
    this.published.push({ householdId, board });
    const answer = this.answers.get(householdId) ?? { kind: 'published', reference: 'F0C4HPW0JP7' };
    if (answer instanceof Error) throw answer;
    return answer;
  }
}

const clock: ClockPort = {
  now: () => ({ date: DATE, time: localTime('19:03') }),
  today: () => DATE,
  instant: () => INSTANT,
};

const BOARD = { now: { date: DATE, time: localTime('19:03') }, slots: [], blocks: [], omittedBlocks: 0 } as unknown as HouseholdBoard;

function boardService(failing: string | null = null): HouseholdBoardService {
  return {
    get: async (householdId: string) => {
      if (householdId === failing) throw new Error('상태를 읽지 못했습니다');
      return BOARD;
    },
  } as unknown as HouseholdBoardService;
}

const claim = (householdId: string, previousFailure: string | null = null): BoardSyncClaim => ({
  householdId,
  date: DATE,
  stateChangedAt: STATE_CHANGED_AT,
  previousFailure,
});

describe('상태판 동기화', () => {
  it('오늘과 지금, 디바운스 초를 저장소에 넘긴다', async () => {
    const log = new RecordingLog([]);

    await new BoardSyncService(log, new RecordingPublisher(), boardService(), clock).runEveryHousehold();

    expect(log.due).toEqual([{ today: DATE, instant: INSTANT, debounceSeconds: BOARD_DEBOUNCE_SECONDS }]);
  });

  it('발행되면 클레임 그대로 발행 시각과 함께 기록한다', async () => {
    const log = new RecordingLog([claim('재하네')]);
    const publisher = new RecordingPublisher();

    const outcomes = await new BoardSyncService(log, publisher, boardService(), clock).runEveryHousehold();

    expect(outcomes).toEqual([{ kind: 'published', householdId: '재하네' }]);
    expect(publisher.published).toEqual([{ householdId: '재하네', board: BOARD }]);
    // 기록되는 것은 클레임이 읽은 상태 시각이지 지금이 아니다.
    expect(log.published).toEqual([{ claim: claim('재하네'), at: INSTANT }]);
  });

  it('보낼 곳이 없으면 skipped로 기록하고 사유를 남긴다', async () => {
    const log = new RecordingLog([claim('재하네')]);
    const publisher = new RecordingPublisher(new Map([['재하네', { kind: 'skipped', reason: 'not_linked' }]]));

    const outcomes = await new BoardSyncService(log, publisher, boardService(), clock).runEveryHousehold();

    expect(outcomes).toEqual([{ kind: 'skipped', householdId: '재하네', reason: 'not_linked' }]);
    expect(log.skipped).toEqual([{ claim: claim('재하네'), reason: 'not_linked', at: INSTANT }]);
  });

  it('발행이 던지면 5분 뒤로 실패를 기록하고 다음 가정으로 넘어간다', async () => {
    const log = new RecordingLog([claim('재하네'), claim('민준네')]);
    const publisher = new RecordingPublisher(new Map([['재하네', new Error('missing_scope')]]));

    const outcomes = await new BoardSyncService(log, publisher, boardService(), clock).runEveryHousehold();

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['failed', 'published']);
    expect(log.failed).toEqual([
      {
        claim: claim('재하네'),
        error: 'missing_scope',
        at: INSTANT,
        nextAttemptAt: new Date(INSTANT.getTime() + BOARD_RETRY_DELAY_SECONDS * 1_000),
      },
    ]);
  });

  it('같은 사유로 다시 실패하면 repeated다', async () => {
    const log = new RecordingLog([claim('재하네', 'missing_scope'), claim('민준네', 'canvas_not_found')]);
    const publisher = new RecordingPublisher(
      new Map([
        ['재하네', new Error('missing_scope')],
        ['민준네', new Error('missing_scope')],
      ]),
    );

    const outcomes = await new BoardSyncService(log, publisher, boardService(), clock).runEveryHousehold();

    expect(outcomes).toMatchObject([
      { kind: 'failed', householdId: '재하네', repeated: true },
      { kind: 'failed', householdId: '민준네', repeated: false },
    ]);
  });

  it('상태판을 만들지 못해도 실패로 기록되고 발행은 부르지 않는다', async () => {
    const log = new RecordingLog([claim('재하네')]);
    const publisher = new RecordingPublisher();

    const outcomes = await new BoardSyncService(log, publisher, boardService('재하네'), clock).runEveryHousehold();

    expect(outcomes).toMatchObject([{ kind: 'failed', householdId: '재하네', repeated: false }]);
    expect(publisher.published).toEqual([]);
    expect(log.failed[0].error).toBe('상태를 읽지 못했습니다');
  });
});
