import { DomainError } from '../errors.js';
import { LocalDate, addDays, daysBetween, minDate } from '../shared/local-date.js';
import { LocalDateTime, LocalTime } from '../shared/local-time.js';
import { MealSlot } from '../shared/meal-slot.js';

export interface SlotSchedule {
  readonly slot: MealSlot;
  /** Date of the first meal of this slot when nothing is skipped. */
  readonly startDate: LocalDate;
  readonly mealTime: LocalTime;
}

/** A parent reported that the baby was not fed in this slot on this date. */
export interface NoFeedRecord {
  readonly date: LocalDate;
  readonly slot: MealSlot;
  /** Cubes were already thawed, so they are wasted rather than returned to stock. */
  readonly thawed: boolean;
  readonly reason: string | null;
}

/**
 * Maps meals to dates. Dates are never stored: the k-th meal of a slot lands on the k-th date,
 * counted from the slot start date, that is not a no-feed date of that slot.
 */
export class MealCalendar {
  private readonly schedules = new Map<MealSlot, SlotSchedule>();
  private readonly noFeedBySlot = new Map<MealSlot, Map<LocalDate, NoFeedRecord>>();

  constructor(schedules: readonly SlotSchedule[], noFeedRecords: readonly NoFeedRecord[]) {
    for (const schedule of schedules) {
      if (this.schedules.has(schedule.slot)) {
        throw new DomainError('DUPLICATE_SLOT_SCHEDULE', `끼니 설정이 겹칩니다: ${schedule.slot}`);
      }
      this.schedules.set(schedule.slot, schedule);
      this.noFeedBySlot.set(schedule.slot, new Map());
    }
    for (const record of noFeedRecords) {
      const schedule = this.schedules.get(record.slot);
      if (!schedule || record.date < schedule.startDate) continue;
      this.noFeedBySlot.get(record.slot)!.set(record.date, record);
    }
  }

  get slotSchedules(): SlotSchedule[] {
    return [...this.schedules.values()];
  }

  get noFeedRecords(): NoFeedRecord[] {
    return [...this.noFeedBySlot.values()].flatMap((records) => [...records.values()]);
  }

  /** Date the baby started solid food: the earliest slot start date. */
  get feedingStartDate(): LocalDate | null {
    return minDate(this.slotSchedules.map((schedule) => schedule.startDate));
  }

  hasSlot(slot: MealSlot): boolean {
    return this.schedules.has(slot);
  }

  /** Slots that exist on the given date. The afternoon slot may start later than the morning slot. */
  activeSlotsOn(date: LocalDate): MealSlot[] {
    return this.slotSchedules.filter((schedule) => schedule.startDate <= date).map((schedule) => schedule.slot);
  }

  dateOf(slot: MealSlot, order: number): LocalDate {
    const schedule = this.scheduleOf(slot);
    if (!Number.isInteger(order) || order < 1) {
      throw new DomainError('INVALID_MEAL_ORDER', `식단 순서는 1 이상의 정수여야 합니다: ${order}`);
    }
    let date = addDays(schedule.startDate, order - 1);
    const skippedDates = [...this.noFeedBySlot.get(slot)!.keys()].sort();
    for (const skipped of skippedDates) {
      if (skipped <= date) date = addDays(date, 1);
    }
    return date;
  }

  scheduledAt(slot: MealSlot, order: number): LocalDateTime {
    return { date: this.dateOf(slot, order), time: this.scheduleOf(slot).mealTime };
  }

  /** Order of the meal that lands on the date, or null when the slot has no meal that day. */
  orderAt(slot: MealSlot, date: LocalDate): number | null {
    const schedule = this.scheduleOf(slot);
    if (date < schedule.startDate || this.isNoFeed(slot, date)) return null;
    const skippedBefore = [...this.noFeedBySlot.get(slot)!.keys()].filter((skipped) => skipped < date).length;
    return daysBetween(schedule.startDate, date) + 1 - skippedBefore;
  }

  noFeedRecordAt(slot: MealSlot, date: LocalDate): NoFeedRecord | null {
    return this.noFeedBySlot.get(slot)?.get(date) ?? null;
  }

  isNoFeed(slot: MealSlot, date: LocalDate): boolean {
    return this.noFeedRecordAt(slot, date) !== null;
  }

  /** True when every slot that exists on the date was skipped. Such a date is not a feeding day. */
  isFullNoFeedDate(date: LocalDate): boolean {
    const activeSlots = this.activeSlotsOn(date);
    return activeSlots.length > 0 && activeSlots.every((slot) => this.isNoFeed(slot, date));
  }

  /** "N일차": number of days with at least one feeding, from the feeding start date to the date. */
  dayNumberOn(date: LocalDate): number | null {
    const start = this.feedingStartDate;
    if (start === null || date < start || this.isFullNoFeedDate(date)) return null;
    const noFeedDates = new Set(this.noFeedRecords.map((record) => record.date));
    const fullNoFeedDays = [...noFeedDates].filter(
      (noFeedDate) => noFeedDate <= date && this.isFullNoFeedDate(noFeedDate),
    ).length;
    return daysBetween(start, date) + 1 - fullNoFeedDays;
  }

  withNoFeed(record: NoFeedRecord): MealCalendar {
    const schedule = this.scheduleOf(record.slot);
    if (record.date < schedule.startDate) {
      throw new DomainError(
        'NO_FEED_BEFORE_SLOT_START',
        `끼니 시작일(${schedule.startDate}) 이전은 미급여로 등록할 수 없습니다: ${record.date}`,
      );
    }
    if (this.isNoFeed(record.slot, record.date)) {
      throw new DomainError(
        'NO_FEED_ALREADY_REGISTERED',
        `이미 미급여로 등록돼 있습니다: ${record.date} ${record.slot}`,
      );
    }
    return new MealCalendar(this.slotSchedules, [...this.noFeedRecords, record]);
  }

  withoutNoFeed(slot: MealSlot, date: LocalDate): MealCalendar {
    if (!this.isNoFeed(slot, date)) {
      throw new DomainError('NO_FEED_NOT_FOUND', `미급여 기록이 없습니다: ${date} ${slot}`);
    }
    return new MealCalendar(
      this.slotSchedules,
      this.noFeedRecords.filter((record) => !(record.slot === slot && record.date === date)),
    );
  }

  private scheduleOf(slot: MealSlot): SlotSchedule {
    const schedule = this.schedules.get(slot);
    if (!schedule) {
      throw new DomainError('SLOT_NOT_SCHEDULED', `설정되지 않은 끼니입니다: ${slot}`);
    }
    return schedule;
  }
}
