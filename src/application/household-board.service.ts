import { addDays } from '../domain/shared/local-date.js';
import { BOARD_LOAD_DAYS, HouseholdBoard, buildHouseholdBoard } from './household-board.js';
import { ClockPort } from './ports/clock.port.js';
import { FeedingHistoryPort } from './ports/feeding-history.port.js';
import { HouseholdReader } from './ports/household-write.port.js';

/**
 * The board (ADR 0008), assembled on every call and stored nowhere, like the brief.
 *
 * The read is widened to `BOARD_LOAD_DAYS` before today rather than left to `LOOKBACK_DAYS`: the
 * calendar reaches back into last week's block, and a setting that happens to be wide enough today
 * is not a guarantee.
 */
export class HouseholdBoardService {
  constructor(
    private readonly reader: HouseholdReader,
    private readonly history: FeedingHistoryPort,
    private readonly clock: ClockPort,
  ) {}

  async get(householdId: string): Promise<HouseholdBoard> {
    const history = await this.history.load(householdId);
    const now = this.clock.now();
    return await this.reader.read(
      householdId,
      (state) => buildHouseholdBoard({ state, history, now }),
      { sinceDate: addDays(now.date, -BOARD_LOAD_DAYS) },
    );
  }
}
