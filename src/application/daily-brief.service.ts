import { DailyBrief, buildDailyBrief } from './daily-brief.js';
import { ClockPort } from './ports/clock.port.js';
import { FeedingHistoryPort } from './ports/feeding-history.port.js';
import { HouseholdReader } from './ports/household-write.port.js';

/**
 * Today's brief (chapter 5), assembled on every call and stored nowhere.
 *
 * A brief kept from this morning is wrong as soon as a batch is cooked or a meal is postponed, and
 * every part of it is derived: `buildDailyBrief` composes the domain functions that the tools
 * already answer with. The scheduler will send this content in stage 5; here it is a read.
 */
export class DailyBriefService {
  constructor(
    private readonly reader: HouseholdReader,
    private readonly history: FeedingHistoryPort,
    private readonly clock: ClockPort,
  ) {}

  async get(householdId: string): Promise<DailyBrief> {
    const history = await this.history.load(householdId);
    const now = this.clock.now();
    return await this.reader.read(householdId, (state) => buildDailyBrief({ state, history, now }));
  }
}
