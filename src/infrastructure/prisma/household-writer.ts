import { createHash } from 'node:crypto';
import { HouseholdState, LoadScope } from '../../application/household-state.js';
import { ClockPort } from '../../application/ports/clock.port.js';
import {
  Actor,
  CookedBatchDraft,
  HouseholdReader,
  HouseholdWriteContext,
  HouseholdWriter,
  MealDraft,
  WriteRequest,
} from '../../application/ports/household-write.port.js';
import { MealStatusChange } from '../../domain/deduction/reconcile.js';
import { Meal } from '../../domain/meal-plan/meal.js';
import { NoFeedRecord } from '../../domain/meal-plan/meal-calendar.js';
import { LocalDate } from '../../domain/shared/local-date.js';
import { MealSlot } from '../../domain/shared/meal-slot.js';
import { CookedBatch, LedgerEntry } from '../../domain/stock/ledger.js';
import { PrismaHouseholdStateRepository } from './household-state.repository.js';
import { PrismaService, PrismaTransaction } from './prisma.service.js';
import { fromLocalDate } from './mappers/local-date.mapper.js';

export class ApplicationError extends Error {
  constructor(
    readonly code: 'IDEMPOTENCY_KEY_REUSED' | 'HOUSEHOLD_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

/** Long enough to cover a full aggregate read plus its writes, short enough to fail a stuck run. */
const TRANSACTION_TIMEOUT_MS = 15_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;
/** Must stay under the transaction timeout so that a lock wait fails before the transaction does. */
const LOCK_TIMEOUT = '5s';

export class PrismaHouseholdWriter implements HouseholdWriter, HouseholdReader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PrismaHouseholdStateRepository,
    private readonly clock: ClockPort,
  ) {}

  async read<T>(
    householdId: string,
    body: (state: HouseholdState) => T | Promise<T>,
    scope?: LoadScope,
  ): Promise<T> {
    const state = await this.repository.load(this.prisma, householdId, this.clock.today(), scope);
    return await body(state);
  }

  async write<T>(request: WriteRequest, body: (context: HouseholdWriteContext) => Promise<T>): Promise<T> {
    const now = this.clock.now();
    return await this.prisma.$transaction(
      async (tx) => {
        await this.lockHousehold(tx, request.householdId);

        const recorded = await this.recordedResult<T>(tx, request);
        if (recorded !== undefined) return recorded.value;

        const context = new PrismaWriteContext(tx, this.repository, request, now);
        const result = await body(context);
        await this.recordResult(tx, request, result);
        return result;
      },
      {
        // 격리 수준은 Read Committed(기본값)다. 가정 행 잠금이 이미 쓰기를 직렬화하고,
        // 상위 격리는 잠금을 얻기 전에 스냅샷을 고정해 오히려 낡은 재고를 읽게 만든다.
        timeout: TRANSACTION_TIMEOUT_MS,
        maxWait: TRANSACTION_MAX_WAIT_MS,
      },
    );
  }

  /**
   * The household row is the aggregate root. Taking it first gives every write a deterministic
   * order, so two parents deducting the last cube cannot both read the same stock.
   */
  private async lockHousehold(tx: PrismaTransaction, householdId: string): Promise<void> {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM household WHERE id = ${householdId}::uuid FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new ApplicationError('HOUSEHOLD_NOT_FOUND', `가정을 찾을 수 없습니다: ${householdId}`);
    }
  }

  private async recordedResult<T>(
    tx: PrismaTransaction,
    request: WriteRequest,
  ): Promise<{ value: T } | undefined> {
    if (request.idempotencyKey === undefined) return undefined;
    const record = await tx.idempotencyRecord.findUnique({
      where: { householdId_key: { householdId: request.householdId, key: request.idempotencyKey } },
    });
    if (record === null) return undefined;
    if (record.requestHash !== hashPayload(request)) {
      throw new ApplicationError(
        'IDEMPOTENCY_KEY_REUSED',
        `같은 멱등키에 다른 요청이 왔습니다: ${request.idempotencyKey}`,
      );
    }
    return { value: (record.response as { value: T }).value };
  }

  private async recordResult(tx: PrismaTransaction, request: WriteRequest, value: unknown): Promise<void> {
    if (request.idempotencyKey === undefined) return;
    await tx.idempotencyRecord.create({
      data: {
        householdId: request.householdId,
        key: request.idempotencyKey,
        operation: request.operation,
        requestHash: hashPayload(request),
        // 값을 그대로 넣으면 undefined가 JSON에서 사라져 재시도 응답이 달라진다.
        response: JSON.parse(JSON.stringify({ value })) as object,
      },
    });
  }
}

function hashPayload(request: WriteRequest): string {
  return createHash('sha256')
    .update(`${request.operation}\u0000${stableStringify(request.payload)}`)
    .digest('hex');
}

/** Key order must not change the hash, or a retry that serialises differently looks like a new body. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

class PrismaWriteContext implements HouseholdWriteContext {
  constructor(
    private readonly tx: PrismaTransaction,
    private readonly repository: PrismaHouseholdStateRepository,
    private readonly request: WriteRequest,
    readonly now: HouseholdWriteContext['now'],
  ) {}

  get householdId(): string {
    return this.request.householdId;
  }

  async load(scope?: LoadScope): Promise<HouseholdState> {
    return await this.repository.load(this.tx, this.householdId, this.now.date, scope);
  }

  /**
   * Appends to the ledger and moves each batch's projected count by the same delta, in the same
   * transaction. The `remaining_cubes >= 0` check is the last line of defence: if the household
   * lock ever stopped working, a concurrent deduction would fail here instead of going negative.
   */
  async appendLedgerEntries(entries: readonly LedgerEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.tx.stockLedgerEntry.createMany({
      data: entries.map((entry) => ({
        householdId: this.householdId,
        batchId: entry.batchId,
        type: entry.type,
        delta: entry.delta,
        mealId: entry.mealId,
        reason: entry.reason,
        noFeedKey: entry.noFeedKey ?? null,
        ...actorColumns(this.request.actor),
      })),
    });

    const deltaByBatch = new Map<string, number>();
    for (const entry of entries) {
      deltaByBatch.set(entry.batchId, (deltaByBatch.get(entry.batchId) ?? 0) + entry.delta);
    }
    for (const [batchId, delta] of deltaByBatch) {
      if (delta === 0) continue;
      await this.tx.cookedBatch.update({
        where: { id: batchId },
        data: { remainingCubes: { increment: delta } },
      });
    }
  }

  async applyMealStatuses(changes: readonly MealStatusChange[]): Promise<void> {
    for (const change of changes) {
      await this.tx.meal.update({
        where: { id: change.mealId },
        data: { status: change.status, updatedByMemberId: memberIdOf(this.request.actor) },
      });
    }
  }

  async insertCookedBatch(draft: CookedBatchDraft): Promise<CookedBatch> {
    const row = await this.tx.cookedBatch.create({
      data: {
        householdId: this.householdId,
        ingredientId: draft.ingredientId,
        cubeWeightGram: draft.cubeWeightGram,
        cookedOn: fromLocalDate(draft.cookedOn),
        // 입고 이벤트가 곧바로 더한다. 여기서 수량을 세면 원장과 두 번 세게 된다.
        remainingCubes: 0,
        createdByMemberId: memberIdOf(this.request.actor),
      },
      select: { id: true },
    });
    return { ...draft, id: row.id };
  }

  async addNoFeedRecord(record: NoFeedRecord): Promise<void> {
    await this.tx.noFeedRecord.create({
      data: {
        householdId: this.householdId,
        date: fromLocalDate(record.date),
        slot: record.slot,
        thawed: record.thawed,
        reason: record.reason,
        createdByMemberId: memberIdOf(this.request.actor),
      },
    });
  }

  async removeNoFeedRecord(slot: MealSlot, date: LocalDate): Promise<void> {
    await this.tx.noFeedRecord.delete({
      where: { householdId_date_slot: { householdId: this.householdId, date: fromLocalDate(date), slot } },
    });
  }

  async upsertMeal(meal: MealDraft): Promise<Meal> {
    const memberId = memberIdOf(this.request.actor);
    const row = await this.tx.meal.upsert({
      where: { householdId_slot_mealOrder: { householdId: this.householdId, slot: meal.slot, mealOrder: meal.order } },
      create: {
        householdId: this.householdId,
        slot: meal.slot,
        mealOrder: meal.order,
        plannedBaseMenuId: meal.planned.baseMenuId,
        memo: meal.memo,
        status: meal.status,
        migrated: meal.migrated,
        updatedByMemberId: memberId,
      },
      update: {
        plannedBaseMenuId: meal.planned.baseMenuId,
        memo: meal.memo,
        status: meal.status,
        migrated: meal.migrated,
        updatedByMemberId: memberId,
      },
      select: { id: true },
    });

    // 토핑은 순서를 포함해 통째로 갈아 끼운다. 부분 갱신은 position이 어긋날 여지를 남긴다.
    await this.tx.mealTopping.deleteMany({ where: { mealId: row.id } });
    await this.tx.mealTopping.createMany({
      data: [
        ...meal.planned.toppingIngredientIds.map((ingredientId, position) => ({
          mealId: row.id,
          kind: 'planned' as const,
          position,
          ingredientId,
        })),
        ...(meal.actual?.toppingIngredientIds ?? []).map((ingredientId, position) => ({
          mealId: row.id,
          kind: 'actual' as const,
          position,
          ingredientId,
        })),
      ],
    });

    if (meal.actual === null) {
      await this.tx.mealActual.deleteMany({ where: { mealId: row.id } });
    } else {
      await this.tx.mealActual.upsert({
        where: { mealId: row.id },
        create: { mealId: row.id, actualBaseMenuId: meal.actual.baseMenuId },
        update: { actualBaseMenuId: meal.actual.baseMenuId },
      });
    }
    return { ...meal, id: row.id };
  }
}

function actorColumns(actor: Actor): { actorSource: 'member' | 'scheduler'; actorMemberId: string | null } {
  return actor.kind === 'member'
    ? { actorSource: 'member', actorMemberId: actor.memberId }
    : { actorSource: 'scheduler', actorMemberId: null };
}

function memberIdOf(actor: Actor): string | null {
  return actor.kind === 'member' ? actor.memberId : null;
}
