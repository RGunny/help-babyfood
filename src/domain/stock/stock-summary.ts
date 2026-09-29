import { Ingredient } from '../ingredient/ingredient.js';
import { LocalDate } from '../shared/local-date.js';
import { ExpiryStage, expiryStageOn } from './expiry.js';
import { CookedBatch, LedgerEntry, oldestCookedFirst, remainingByBatch } from './ledger.js';

export interface BatchStock {
  readonly batch: CookedBatch;
  readonly remaining: number;
  readonly expiry: ExpiryStage;
  /** Cube weight differs from the current serving weight, so meals never deduct from it. */
  readonly weightMismatched: boolean;
}

/** One row of the stock table: "브로콜리 12 (가용 9 / 임계 지남 3)". Pantry ingredients have no row. */
export interface IngredientStock {
  readonly ingredientId: string;
  /** Everything in the freezer, including cubes past their expiry date. */
  readonly total: number;
  /** Part of `total` not yet past the expiry date. Batches due soon are still fresh. */
  readonly fresh: number;
  /** Part of `total` past the expiry date. Still stock until parents report a discard. */
  readonly overdue: number;
  /** Part of `total` that meals will not deduct because of the cube weight. */
  readonly weightMismatched: number;
  readonly batches: readonly BatchStock[];
}

export function summarizeStock(
  ingredients: readonly Ingredient[],
  batches: readonly CookedBatch[],
  entries: readonly LedgerEntry[],
  today: LocalDate,
  shelfLifeDays: number,
): IngredientStock[] {
  const remaining = remainingByBatch(entries);
  return ingredients
    .filter((ingredient) => ingredient.stockTracking === 'cubes')
    .map((ingredient) => {
      const batchStocks = batches
        .filter((batch) => batch.ingredientId === ingredient.id && (remaining.get(batch.id) ?? 0) > 0)
        .sort(oldestCookedFirst)
        .map<BatchStock>((batch) => ({
          batch,
          remaining: remaining.get(batch.id)!,
          expiry: expiryStageOn(batch, today, shelfLifeDays),
          weightMismatched: batch.cubeWeightGram !== ingredient.servingWeightGram,
        }));
      const sum = (selected: BatchStock[]) => selected.reduce((cubes, stock) => cubes + stock.remaining, 0);
      const overdue = sum(batchStocks.filter((stock) => stock.expiry.kind === 'overdue'));
      const total = sum(batchStocks);
      return {
        ingredientId: ingredient.id,
        total,
        fresh: total - overdue,
        overdue,
        weightMismatched: sum(batchStocks.filter((stock) => stock.weightMismatched)),
        batches: batchStocks,
      };
    });
}

/** Batches the brief must mention: due soon or overdue. Empty batches never appear. */
export function batchesNeedingExpiryAlert(stocks: readonly IngredientStock[]): BatchStock[] {
  return stocks.flatMap((stock) => stock.batches).filter((batchStock) => batchStock.expiry.kind !== 'fresh');
}

/** Fallback alert for periods without a meal plan, where depletion cannot be forecast. */
export function isAtOrBelowThreshold(stock: IngredientStock, thresholdCubes: number): boolean {
  return stock.total <= thresholdCubes;
}
