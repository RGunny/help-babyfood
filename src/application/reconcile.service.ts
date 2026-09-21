import { HeldDeduction, reconcileMeals } from '../domain/deduction/reconcile.js';
import { toReconcileInput } from './household-state.js';
import { Actor, HouseholdWriteContext, HouseholdWriter } from './ports/household-write.port.js';

export interface ReconcileReport {
  readonly consumedMealIds: readonly string[];
  readonly revertedMealIds: readonly string[];
  /**
   * Deductions waiting for stock. Never stored: a row would keep saying "short" after cooking
   * arrives. The brief re-runs reconciliation and reads this.
   */
  readonly held: readonly HeldDeduction[];
}

export const SCHEDULER: Actor = { kind: 'scheduler' };

export class ReconcileService {
  constructor(private readonly writer: HouseholdWriter) {}

  /**
   * Brings meals and the ledger in line with the one rule: a meal whose computed date and meal
   * time have passed is consumed and fully deducted, and every other meal is planned with nothing
   * deducted. Running it again changes nothing, so it needs no idempotency key.
   */
  async run(householdId: string, actor: Actor = SCHEDULER): Promise<ReconcileReport> {
    return await this.writer.write(
      { householdId, actor, operation: 'reconcile' },
      async (context) => await reconcile(context),
    );
  }
}

/** Shared with the services that change something and must settle the ledger in the same transaction. */
export async function reconcile(context: HouseholdWriteContext): Promise<ReconcileReport> {
  const state = await context.load();
  const result = reconcileMeals(toReconcileInput(state, context.now));

  await context.appendLedgerEntries(result.newEntries);
  await context.applyMealStatuses(result.statusChanges);

  return {
    consumedMealIds: result.statusChanges.filter((c) => c.status === 'consumed').map((c) => c.mealId),
    revertedMealIds: result.statusChanges.filter((c) => c.status === 'planned').map((c) => c.mealId),
    held: result.held,
  };
}
