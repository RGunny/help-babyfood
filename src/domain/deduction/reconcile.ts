import { DomainError } from '../errors.js';
import { CubeNeed } from '../ingredient/ingredient.js';
import { IngredientCatalog } from '../ingredient/ingredient-catalog.js';
import { Meal, MealStatus, effectiveComposition } from '../meal-plan/meal.js';
import { MealCalendar } from '../meal-plan/meal-calendar.js';
import { Menu, expandToCubeNeeds } from '../menu/menu.js';
import { LocalDate } from '../shared/local-date.js';
import { LocalDateTime, compareDateTimes, isAtOrBefore } from '../shared/local-time.js';
import { allocateOldestFirst } from '../stock/allocation.js';
import { CookedBatch, LedgerEntry, netConsumedByBatch, oldestCookedFirst, remainingByBatch } from '../stock/ledger.js';

export interface ReconcileInput {
  readonly now: LocalDateTime;
  readonly meals: readonly Meal[];
  readonly calendar: MealCalendar;
  readonly menus: ReadonlyMap<string, Menu>;
  readonly catalog: IngredientCatalog;
  readonly batches: readonly CookedBatch[];
  readonly entries: readonly LedgerEntry[];
}

export interface MealStatusChange {
  readonly mealId: string;
  readonly status: MealStatus;
}

/** A deduction that could not be made because eligible stock was short. Retried on every run. */
export interface HeldDeduction {
  readonly mealId: string;
  readonly mealDate: LocalDate;
  readonly ingredientId: string;
  readonly cubes: number;
}

export interface ReconcileResult {
  readonly statusChanges: readonly MealStatusChange[];
  readonly newEntries: readonly LedgerEntry[];
  readonly held: readonly HeldDeduction[];
}

interface DueState {
  readonly meal: Meal;
  readonly scheduledAt: LocalDateTime;
  readonly due: boolean;
}

/**
 * Brings meals and the ledger in line with one rule: a meal whose computed date and meal time have
 * passed must be consumed and fully deducted, and any other meal must be planned with nothing deducted.
 *
 * Only differences produce output, so running it again after applying the result changes nothing.
 * The same run covers auto-deduction, catch-up after downtime, no-feed records registered late or
 * removed, edits of what was really fed, and held deductions waiting for stock.
 */
export function reconcileMeals(input: ReconcileInput): ReconcileResult {
  const batchById = new Map(input.batches.map((batch) => [batch.id, batch]));
  const remaining = remainingByBatch(input.entries);
  const states: DueState[] = input.meals
    .filter((meal) => !meal.migrated && input.calendar.hasSlot(meal.slot))
    .map((meal) => {
      const scheduledAt = input.calendar.scheduledAt(meal.slot, meal.order);
      return { meal, scheduledAt, due: isAtOrBefore(scheduledAt, input.now) };
    })
    .sort((a, b) => compareDateTimes(a.scheduledAt, b.scheduledAt) || a.meal.id.localeCompare(b.meal.id));

  const newEntries: LedgerEntry[] = [];
  const record = (entry: LedgerEntry) => {
    newEntries.push(entry);
    remaining.set(entry.batchId, (remaining.get(entry.batchId) ?? 0) + entry.delta);
  };
  const consumedOf = (mealId: string) => netConsumedByBatch([...input.entries, ...newEntries], mealId);
  const targetOf = (state: DueState): CubeNeed[] =>
    state.due ? expandToCubeNeeds(effectiveComposition(state.meal), input.menus) : [];

  // Release first so that freed cubes are available to the deductions below.
  for (const state of states) {
    const target = new Map(targetOf(state).map((need) => [need.ingredientId, need.cubes]));
    const consumedBatches = [...consumedOf(state.meal.id)]
      .map(([batchId, cubes]) => ({ batch: requireBatch(batchById, batchId), cubes }))
      .sort((a, b) => oldestCookedFirst(b.batch, a.batch));
    const consumedByIngredient = new Map<string, number>();
    for (const { batch, cubes } of consumedBatches) {
      consumedByIngredient.set(batch.ingredientId, (consumedByIngredient.get(batch.ingredientId) ?? 0) + cubes);
    }
    for (const [ingredientId, consumed] of consumedByIngredient) {
      let surplus = consumed - (target.get(ingredientId) ?? 0);
      for (const { batch, cubes } of consumedBatches) {
        if (surplus <= 0) break;
        if (batch.ingredientId !== ingredientId) continue;
        const returned = Math.min(surplus, cubes);
        record({
          batchId: batch.id,
          type: 'consumption_reverted',
          delta: returned,
          mealId: state.meal.id,
          reason: null,
        });
        surplus -= returned;
      }
    }
  }

  const held: HeldDeduction[] = [];
  for (const state of states.filter((candidate) => candidate.due)) {
    const consumedByIngredient = new Map<string, number>();
    for (const [batchId, cubes] of consumedOf(state.meal.id)) {
      const ingredientId = requireBatch(batchById, batchId).ingredientId;
      consumedByIngredient.set(ingredientId, (consumedByIngredient.get(ingredientId) ?? 0) + cubes);
    }
    for (const need of targetOf(state)) {
      const deficit = need.cubes - (consumedByIngredient.get(need.ingredientId) ?? 0);
      if (deficit <= 0) continue;
      const allocations = allocateOldestFirst(
        input.catalog.getById(need.ingredientId),
        deficit,
        state.scheduledAt.date,
        input.batches,
        remaining,
      );
      if (allocations === null) {
        held.push({
          mealId: state.meal.id,
          mealDate: state.scheduledAt.date,
          ingredientId: need.ingredientId,
          cubes: deficit,
        });
        continue;
      }
      for (const allocation of allocations) {
        record({
          batchId: allocation.batchId,
          type: 'meal_consumed',
          delta: -allocation.cubes,
          mealId: state.meal.id,
          reason: null,
        });
      }
    }
  }

  const statusChanges = states
    .filter((state) => (state.due ? 'consumed' : 'planned') !== state.meal.status)
    .map<MealStatusChange>((state) => ({ mealId: state.meal.id, status: state.due ? 'consumed' : 'planned' }));

  return { statusChanges, newEntries, held };
}

/** Applies a result to the input, as the application layer does when it persists it. */
export function applyReconcileResult(input: ReconcileInput, result: ReconcileResult): ReconcileInput {
  const statusById = new Map(result.statusChanges.map((change) => [change.mealId, change.status]));
  return {
    ...input,
    meals: input.meals.map((meal) => ({ ...meal, status: statusById.get(meal.id) ?? meal.status })),
    entries: [...input.entries, ...result.newEntries],
  };
}

function requireBatch(batchById: ReadonlyMap<string, CookedBatch>, batchId: string): CookedBatch {
  const batch = batchById.get(batchId);
  if (!batch) {
    throw new DomainError('UNKNOWN_BATCH', `원장에 있는 배치를 찾을 수 없습니다: ${batchId}`);
  }
  return batch;
}
