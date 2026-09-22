import { MealCalendar, SlotSchedule } from '../domain/meal-plan/meal-calendar.js';
import { LocalDate } from '../domain/shared/local-date.js';
import { LocalTime } from '../domain/shared/local-time.js';
import { MealSlot } from '../domain/shared/meal-slot.js';
import { Actor, HouseholdReader, HouseholdWriter } from './ports/household-write.port.js';

export interface StartMealSlotCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly slot: MealSlot;
  /** Date of the first meal of the slot when nothing is skipped. */
  readonly startDate: LocalDate;
  readonly mealTime: LocalTime;
}

/**
 * Opens a slot. The start date and the meal time are what turn a meal's order into a date and a
 * deduction time, so a slot exists only once this is recorded.
 *
 * Changing a start date later would re-date every meal of the slot and move deductions that already
 * happened, so there is no update here. The afternoon slot starting later than the morning one is
 * the case this supports.
 */
export class MealSlotService {
  constructor(
    private readonly writer: HouseholdWriter,
    private readonly reader: HouseholdReader,
  ) {}

  async start(command: StartMealSlotCommand): Promise<SlotSchedule> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'start_meal_slot',
        idempotencyKey: command.idempotencyKey,
        payload: { slot: command.slot, startDate: command.startDate, mealTime: command.mealTime },
      },
      async (context) => {
        const state = await context.load();
        const schedule: SlotSchedule = {
          slot: command.slot,
          startDate: command.startDate,
          mealTime: command.mealTime,
        };
        // 캘린더 생성자가 끼니 중복에 DUPLICATE_SLOT_SCHEDULE을 던진다.
        new MealCalendar([...state.calendar.slotSchedules, schedule], state.calendar.noFeedRecords);
        await context.insertSlotSchedule(schedule);
        return schedule;
      },
    );
  }

  async getSchedules(householdId: string): Promise<SlotSchedule[]> {
    return await this.reader.read(householdId, (state) => state.calendar.slotSchedules);
  }
}
