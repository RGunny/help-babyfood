import { DomainError } from '../domain/errors.js';
import { LocalDate } from '../domain/shared/local-date.js';
import {
  CookedBatch,
  DiscardReason,
  adjustToCountedCubes,
  discardRemaining,
  receiveBatch,
  remainingByBatch,
} from '../domain/stock/ledger.js';
import {
  BatchStock,
  IngredientStock,
  batchesNeedingExpiryAlert,
  summarizeStock,
} from '../domain/stock/stock-summary.js';
import { ApplicationError } from './errors.js';
import { Actor, HouseholdReader, HouseholdWriter } from './ports/household-write.port.js';
import { ClockPort } from './ports/clock.port.js';

export interface RegisterCookedBatchCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly ingredientName: string;
  readonly cubeWeightGram: number;
  readonly cookedOn: LocalDate;
  readonly cubes: number;
}

export interface AdjustStockCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly batchId: string;
  readonly countedCubes: number;
  readonly reason: string | null;
}

export interface DiscardBatchCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly batchId: string;
  readonly reason: DiscardReason;
}

export interface StockStatus {
  readonly ingredients: readonly IngredientStock[];
  readonly expiryAlerts: readonly BatchStock[];
}

export class StockService {
  constructor(
    private readonly writer: HouseholdWriter,
    private readonly reader: HouseholdReader,
    private readonly clock: ClockPort,
  ) {}

  /** Cooking done: a new batch plus the receiving entry, in one transaction. */
  async registerCookedBatch(command: RegisterCookedBatchCommand): Promise<CookedBatch> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'register_cooked_batch',
        idempotencyKey: command.idempotencyKey,
        payload: {
          ingredientName: command.ingredientName,
          cubeWeightGram: command.cubeWeightGram,
          cookedOn: command.cookedOn,
          cubes: command.cubes,
        },
      },
      async (context) => {
        const state = await context.load();
        // 마스터에 없는 재료명은 차감이 불가능하므로 여기서 거부한다.
        const ingredient = state.catalog.findByName(command.ingredientName);
        if (ingredient === null) {
          throw new DomainError(
            'UNKNOWN_INGREDIENT',
            `등록되지 않은 재료입니다: ${command.ingredientName}`,
          );
        }
        if (ingredient.stockTracking === 'pantry') {
          throw new ApplicationError(
            'PANTRY_INGREDIENT',
            `상비 재료는 큐브로 입고하지 않습니다: ${ingredient.name}`,
          );
        }
        const batch = await context.insertCookedBatch({
          ingredientId: ingredient.id,
          cubeWeightGram: command.cubeWeightGram,
          cookedOn: command.cookedOn,
        });
        await context.appendLedgerEntries([receiveBatch(batch, command.cubes)]);
        return batch;
      },
    );
  }

  /** Parents counted the freezer and found a different number. */
  async adjustStockByCount(command: AdjustStockCommand): Promise<void> {
    await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'adjust_stock_by_count',
        idempotencyKey: command.idempotencyKey,
        payload: { batchId: command.batchId, countedCubes: command.countedCubes, reason: command.reason },
      },
      async (context) => {
        // 잔여가 0인 배치도 "세어 보니 3개"로 되돌릴 수 있어야 하므로 명시적으로 범위에 넣는다.
        const state = await context.load({ batchIds: [command.batchId] });
        const entry = adjustToCountedCubes(
          command.batchId,
          state.entries,
          command.countedCubes,
          command.reason,
        );
        if (entry !== null) await context.appendLedgerEntries([entry]);
      },
    );
  }

  /** Parents actually threw the batch away. Only then does stock go down. */
  async discardBatch(command: DiscardBatchCommand): Promise<void> {
    await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'discard_batch',
        idempotencyKey: command.idempotencyKey,
        payload: { batchId: command.batchId, reason: command.reason },
      },
      async (context) => {
        const state = await context.load({ batchIds: [command.batchId] });
        await context.appendLedgerEntries([
          discardRemaining(command.batchId, state.entries, command.reason),
        ]);
      },
    );
  }

  async getStockStatus(householdId: string): Promise<StockStatus> {
    const today = this.clock.today();
    return await this.reader.read(householdId, (state) => {
      const ingredients = summarizeStock(
        state.ingredients,
        state.batches,
        state.entries,
        today,
        state.alertSettings.shelfLifeDays,
      );
      return { ingredients, expiryAlerts: batchesNeedingExpiryAlert(ingredients) };
    });
  }

  /** Cubes left per batch, as the ledger says. Used by tests and by the reconciliation report. */
  async getRemainingByBatch(householdId: string): Promise<Map<string, number>> {
    return await this.reader.read(householdId, (state) => remainingByBatch(state.entries));
  }
}
