import { Ingredient } from '../ingredient/ingredient.js';
import { LocalDate } from '../shared/local-date.js';
import { CookedBatch, oldestCookedFirst } from './ledger.js';

export interface BatchAllocation {
  readonly batchId: string;
  readonly cubes: number;
}

/**
 * A batch can feed a meal when it has cubes left, its cube weight equals the current serving weight,
 * and it was not cooked after the meal date. Batches past their expiry date stay eligible:
 * parents keep them on purpose until they report a discard.
 */
export function isDeductibleFor(
  batch: CookedBatch,
  ingredient: Ingredient,
  mealDate: LocalDate,
  remaining: number,
): boolean {
  return (
    batch.ingredientId === ingredient.id &&
    remaining > 0 &&
    batch.cubeWeightGram === ingredient.servingWeightGram &&
    batch.cookedOn <= mealDate
  );
}

/**
 * Picks cubes from the oldest batches first. Returns null when stock cannot cover the whole need:
 * stock never goes negative, the deduction is held instead.
 */
export function allocateOldestFirst(
  ingredient: Ingredient,
  cubes: number,
  mealDate: LocalDate,
  batches: readonly CookedBatch[],
  remaining: ReadonlyMap<string, number>,
): BatchAllocation[] | null {
  const candidates = batches
    .filter((batch) => isDeductibleFor(batch, ingredient, mealDate, remaining.get(batch.id) ?? 0))
    .sort(oldestCookedFirst);

  const allocations: BatchAllocation[] = [];
  let needed = cubes;
  for (const batch of candidates) {
    if (needed === 0) break;
    const taken = Math.min(needed, remaining.get(batch.id)!);
    allocations.push({ batchId: batch.id, cubes: taken });
    needed -= taken;
  }
  return needed === 0 ? allocations : null;
}
