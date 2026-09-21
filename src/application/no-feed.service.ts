import { cancelNoFeed, noFeedKey, registerNoFeed } from '../domain/deduction/no-feed.js';
import { CubeNeed } from '../domain/ingredient/ingredient.js';
import { HeldDeduction } from '../domain/deduction/reconcile.js';
import { LocalDate } from '../domain/shared/local-date.js';
import { MealSlot } from '../domain/shared/meal-slot.js';
import { toReconcileInput } from './household-state.js';
import { Actor, HouseholdWriter } from './ports/household-write.port.js';

export interface RegisterNoFeedCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly date: LocalDate;
  readonly slot: MealSlot;
  /** Cubes already thawed cannot be refrozen, so the skipped meal's cubes get discarded. */
  readonly thawed: boolean;
  readonly reason: string | null;
}

export interface CancelNoFeedCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly date: LocalDate;
  readonly slot: MealSlot;
}

export interface NoFeedReport {
  readonly held: readonly HeldDeduction[];
  /** Thawed cubes the ledger had no stock for, so they could not be written off. */
  readonly undiscardable: readonly CubeNeed[];
}

export class NoFeedService {
  constructor(private readonly writer: HouseholdWriter) {}

  /**
   * The meal that sat on that date moves to the next day together with every later meal of the
   * slot. Works the same for today, for a future date, and for a date reported days late.
   */
  async register(command: RegisterNoFeedCommand): Promise<NoFeedReport> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'register_no_feed',
        idempotencyKey: command.idempotencyKey,
        payload: {
          date: command.date,
          slot: command.slot,
          thawed: command.thawed,
          reason: command.reason,
        },
      },
      async (context) => {
        // 소급 등록은 그 날짜 이후 식단을 전부 민다. 윈도를 그 날짜까지 넓힌다.
        const state = await context.load({ sinceDate: command.date });
        const record = {
          date: command.date,
          slot: command.slot,
          thawed: command.thawed,
          reason: command.reason,
        };
        const change = registerNoFeed(toReconcileInput(state, context.now), record);

        await context.addNoFeedRecord(record);
        // 정합화가 만든 취소 이벤트가 먼저다. 해동 폐기는 그렇게 돌아온 큐브까지 보고 고른다.
        await context.appendLedgerEntries(change.reconcile.newEntries);
        await context.applyMealStatuses(change.reconcile.statusChanges);
        await context.appendLedgerEntries(change.stockEntries);

        return { held: change.reconcile.held, undiscardable: change.undiscardable };
      },
    );
  }

  /** Removes a record registered by mistake: dates move back and discarded cubes return. */
  async cancel(command: CancelNoFeedCommand): Promise<NoFeedReport> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'cancel_no_feed',
        idempotencyKey: command.idempotencyKey,
        payload: { date: command.date, slot: command.slot },
      },
      async (context) => {
        // 되돌릴 폐기는 그 폐기로 잔여가 0이 된 배치에 있을 수 있다. 기본 범위에는 없다.
        const state = await context.load({
          sinceDate: command.date,
          noFeedKeys: [noFeedKey(command.slot, command.date)],
        });
        const change = cancelNoFeed(toReconcileInput(state, context.now), command.slot, command.date);

        await context.removeNoFeedRecord(command.slot, command.date);
        await context.appendLedgerEntries(change.stockEntries);
        await context.appendLedgerEntries(change.reconcile.newEntries);
        await context.applyMealStatuses(change.reconcile.statusChanges);

        return { held: change.reconcile.held, undiscardable: change.undiscardable };
      },
    );
  }
}
