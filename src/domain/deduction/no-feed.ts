import { CubeNeed } from '../ingredient/ingredient.js';
import { Meal, effectiveComposition, indexMealsBySlotOrder, slotOrderKey } from '../meal-plan/meal.js';
import { MealCalendar, NoFeedRecord } from '../meal-plan/meal-calendar.js';
import { expandToCubeNeeds } from '../menu/menu.js';
import { LocalDate } from '../shared/local-date.js';
import { MealSlot } from '../shared/meal-slot.js';
import { allocateOldestFirst } from '../stock/allocation.js';
import { LedgerEntry, remainingByBatch } from '../stock/ledger.js';
import { ReconcileInput, ReconcileResult, reconcileMeals } from './reconcile.js';

export interface NoFeedChange {
  readonly calendar: MealCalendar;
  readonly reconcile: ReconcileResult;
  /** Discards of thawed cubes, or their reversal when a record is removed. */
  readonly stockEntries: readonly LedgerEntry[];
  /** Thawed cubes that could not be discarded because the ledger had no matching stock. */
  readonly undiscardable: readonly CubeNeed[];
}

export function noFeedKey(slot: MealSlot, date: LocalDate): string {
  return `${date}/${slot}`;
}

/**
 * Registers a skipped slot. The meal that sat on that date moves to the next day together with every
 * later meal of the slot; it is postponed, never cancelled. Works the same whether the record is for
 * today, for a future date, or reported days late.
 *
 * Thawed cubes cannot be refrozen, so the skipped meal's cubes are discarded on top of the shift.
 */
export function registerNoFeed(input: ReconcileInput, record: NoFeedRecord): NoFeedChange {
  const skippedMeal = mealAt(input.meals, input.calendar, record.slot, record.date);
  const calendar = input.calendar.withNoFeed(record);
  const reconcile = reconcileMeals({ ...input, calendar });

  const stockEntries: LedgerEntry[] = [];
  const undiscardable: CubeNeed[] = [];
  if (record.thawed && skippedMeal !== null && !skippedMeal.migrated) {
    const remaining = remainingByBatch([...input.entries, ...reconcile.newEntries]);
    for (const need of expandToCubeNeeds(effectiveComposition(skippedMeal), input.menus)) {
      const allocations = allocateOldestFirst(
        input.catalog.getById(need.ingredientId),
        need.cubes,
        record.date,
        input.batches,
        remaining,
      );
      if (allocations === null) {
        undiscardable.push(need);
        continue;
      }
      for (const allocation of allocations) {
        remaining.set(allocation.batchId, remaining.get(allocation.batchId)! - allocation.cubes);
        stockEntries.push({
          batchId: allocation.batchId,
          type: 'discarded',
          delta: -allocation.cubes,
          mealId: skippedMeal.id,
          reason: 'thawed_not_fed',
          noFeedKey: noFeedKey(record.slot, record.date),
        });
      }
    }
  }
  return { calendar, reconcile, stockEntries, undiscardable };
}

/**
 * Removes a record registered by mistake. Dates move back, meals whose time has passed get deducted,
 * and cubes discarded as thawed for this record return to stock.
 */
export function cancelNoFeed(input: ReconcileInput, slot: MealSlot, date: LocalDate): NoFeedChange {
  const calendar = input.calendar.withoutNoFeed(slot, date);

  const key = noFeedKey(slot, date);
  const discardedByBatch = new Map<string, number>();
  for (const entry of input.entries) {
    if (entry.noFeedKey !== key) continue;
    discardedByBatch.set(entry.batchId, (discardedByBatch.get(entry.batchId) ?? 0) - entry.delta);
  }
  const stockEntries = [...discardedByBatch]
    .filter(([, cubes]) => cubes > 0)
    .map<LedgerEntry>(([batchId, cubes]) => ({
      batchId,
      type: 'count_adjusted',
      delta: cubes,
      mealId: null,
      reason: 'no_feed_cancelled',
      noFeedKey: key,
    }));

  const reconcile = reconcileMeals({ ...input, calendar, entries: [...input.entries, ...stockEntries] });
  return { calendar, reconcile, stockEntries, undiscardable: [] };
}

function mealAt(meals: readonly Meal[], calendar: MealCalendar, slot: MealSlot, date: LocalDate): Meal | null {
  if (!calendar.hasSlot(slot)) return null;
  const order = calendar.orderAt(slot, date);
  if (order === null) return null;
  return indexMealsBySlotOrder(meals).get(slotOrderKey(slot, order)) ?? null;
}
