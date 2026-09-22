import { HeldDeduction, reconcileMeals } from '../domain/deduction/reconcile.js';
import { toReconcileInput } from './household-state.js';
import { HouseholdDirectoryPort } from './ports/household-directory.port.js';
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

/** What one household's turn in a sweep came to. A failure is a result, not an exception. */
export type ReconcileOutcome =
  | { readonly kind: 'reconciled'; readonly householdId: string; readonly report: ReconcileReport }
  | { readonly kind: 'failed'; readonly householdId: string; readonly error: unknown };

export const SCHEDULER: Actor = { kind: 'scheduler' };

export class ReconcileService {
  constructor(
    private readonly writer: HouseholdWriter,
    private readonly directory: HouseholdDirectoryPort,
  ) {}

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

  /**
   * Every household, one transaction each. This is what the scheduler calls.
   *
   * Sequential on purpose. Each household's turn holds a transaction, and firing them together
   * would let one sweep take the whole connection pool while the MCP endpoint is answering.
   *
   * A household that throws is reported and the sweep goes on. Reconciliation carries nothing over
   * between runs, so the next tick retries the failed household with no repair step in between.
   */
  async runEveryHousehold(): Promise<ReconcileOutcome[]> {
    const outcomes: ReconcileOutcome[] = [];
    for (const householdId of await this.directory.listIds()) {
      try {
        outcomes.push({ kind: 'reconciled', householdId, report: await this.run(householdId) });
      } catch (error) {
        outcomes.push({ kind: 'failed', householdId, error });
      }
    }
    return outcomes;
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
