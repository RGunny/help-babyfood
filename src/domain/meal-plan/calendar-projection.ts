import { LocalDate, addDays } from '../shared/local-date.js';
import { MealSlot } from '../shared/meal-slot.js';
import { Meal, indexMealsBySlotOrder, slotOrderKey } from './meal.js';
import { MealCalendar, NoFeedRecord } from './meal-calendar.js';

export interface CalendarSlotEntry {
  readonly slot: MealSlot;
  /** Null when the slot was skipped that day or the plan has no more meals. */
  readonly meal: Meal | null;
  readonly noFeed: NoFeedRecord | null;
}

export interface CalendarDay {
  readonly date: LocalDate;
  /** "N일차". Null when nothing was fed that day. */
  readonly dayNumber: number | null;
  readonly slots: readonly CalendarSlotEntry[];
}

/** What parents see: each date with its day number and the meal of every slot. */
export function projectCalendar(
  meals: readonly Meal[],
  calendar: MealCalendar,
  from: LocalDate,
  to: LocalDate,
): CalendarDay[] {
  const mealIndex = indexMealsBySlotOrder(meals);
  const days: CalendarDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    days.push({
      date,
      dayNumber: calendar.dayNumberOn(date),
      slots: calendar.activeSlotsOn(date).map((slot) => {
        const order = calendar.orderAt(slot, date);
        return {
          slot,
          meal: order === null ? null : (mealIndex.get(slotOrderKey(slot, order)) ?? null),
          noFeed: calendar.noFeedRecordAt(slot, date),
        };
      }),
    });
  }
  return days;
}

/** Date of the last meal still to be fed. The brief warns when the plan is about to run out. */
export function lastPlannedMealDate(meals: readonly Meal[], calendar: MealCalendar): LocalDate | null {
  return meals
    .filter((meal) => meal.status === 'planned' && calendar.hasSlot(meal.slot))
    .map((meal) => calendar.dateOf(meal.slot, meal.order))
    .reduce<LocalDate | null>((last, date) => (last === null || date > last ? date : last), null);
}
