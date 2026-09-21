import { HouseholdState, LoadScope } from '../../application/household-state.js';
import { IngredientCatalog } from '../../domain/ingredient/ingredient-catalog.js';
import { MealCalendar, SlotSchedule } from '../../domain/meal-plan/meal-calendar.js';
import { Menu } from '../../domain/menu/menu.js';
import { LocalDate, addDays } from '../../domain/shared/local-date.js';
import { DEFAULT_SHELF_LIFE_DAYS } from '../../domain/stock/expiry.js';
import {
  toCookedBatch,
  toIngredient,
  toLedgerEntry,
  toMeal,
  toMealPlanningRules,
  toMenu,
  toNoFeedRecord,
  toSlotSchedule,
} from './mappers/state.mapper.js';
import { PrismaTransaction } from './prisma.service.js';

/**
 * Reads one household in domain types.
 *
 * The read is scoped so that it does not grow with history, while still giving the domain
 * functions exactly the result they would produce from the whole database:
 *
 *   1. meals   — whose computed date is at or after the window start, plus every meal still
 *                planned, wherever it sits
 *   2. B       — batches with cubes left, plus batches those meals consumed, plus what the
 *                request names
 *   3. entries — every ledger entry of B, so each batch's remaining count is exact
 *
 * Batches outside B have no cubes left, and `isDeductibleFor` requires `remaining > 0`, so they can
 * never take part in a deduction. A meal left out is therefore consumed and long past its meal
 * time, which is exactly what the reconciliation rule says it should be — so there is nothing to
 * change. The two ways that could stop being true are both covered: a planned meal is never left
 * out, and a request naming an older date widens the window through `LoadScope.sinceDate`.
 */
export class PrismaHouseholdStateRepository {
  constructor(private readonly lookbackDays: number) {}

  async load(
    tx: PrismaTransaction,
    householdId: string,
    today: LocalDate,
    scope: LoadScope = {},
  ): Promise<HouseholdState> {
    // 쿼리를 Promise.all로 묶지 않는다. 트랜잭션 안에서는 커넥션이 하나라, 동시에 던지면
    // 드라이버가 직렬화하면서 경고를 내고 순서도 보장되지 않는다.
    //
    // 아래 일곱 가지는 부모가 직접 만든 목록이라 이력과 함께 늘어나지 않는다. MealCalendar는
    // 끼니 시작일 이후의 미급여 기록이 하나라도 빠지면 날짜를 틀리게 계산하므로 전부 읽는다.
    const ingredientRows = await tx.ingredient.findMany({
      where: { householdId },
      include: { labels: { select: { label: true, isCanonical: true, position: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const menuRows = await tx.menu.findMany({
      where: { householdId },
      include: { components: { select: { ingredientId: true, cubes: true }, orderBy: { ingredientId: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    const scheduleRows = await tx.slotSchedule.findMany({ where: { householdId }, orderBy: { slot: 'asc' } });
    const noFeedRows = await tx.noFeedRecord.findMany({
      where: { householdId },
      orderBy: [{ date: 'asc' }, { slot: 'asc' }],
    });
    const rulesRow = await tx.mealPlanningRules.findUnique({ where: { householdId } });
    const pairingRows = await tx.forbiddenPairing.findMany({ where: { householdId }, orderBy: { id: 'asc' } });
    const settingsRow = await tx.alertSettings.findUnique({ where: { householdId } });

    const ingredients = ingredientRows.map(toIngredient);
    const schedules = scheduleRows.map(toSlotSchedule);
    const calendar = new MealCalendar(schedules, noFeedRows.map(toNoFeedRecord));

    const windowStart = earlier(addDays(today, -this.lookbackDays), scope.sinceDate);
    const mealWindows = schedules.map((schedule) => ({
      slot: schedule.slot,
      mealOrder: { gte: minOrderOnOrAfter(calendar, schedule, windowStart) },
    }));
    const mealRows =
      mealWindows.length === 0
        ? []
        : await tx.meal.findMany({
            where: {
              householdId,
              OR: [
                ...mealWindows,
                // 윈도 밖이라도 아직 예정인 식단은 전부 읽는다. 스케줄러가 윈도보다 오래
                // 멈춰 있었다면 식단시간이 지난 예정 식단이 남아 있고, 그것을 빠뜨리면
                // 영영 차감되지 않는다. 예정 식단의 수는 부모가 짜 둔 식단표 길이로 묶인다.
                { status: 'planned' },
              ],
            },
            include: {
              actual: { select: { actualBaseMenuId: true } },
              toppings: { select: { kind: true, position: true, ingredientId: true } },
            },
            orderBy: [{ slot: 'asc' }, { mealOrder: 'asc' }],
          });
    const meals = mealRows.map(toMeal);

    const batchIds = await this.batchIdsInScope(tx, householdId, meals.map((meal) => meal.id), scope);
    const batchRows = await tx.cookedBatch.findMany({
      where: {
        householdId,
        OR: [{ remainingCubes: { gt: 0 } }, ...(batchIds.length > 0 ? [{ id: { in: batchIds } }] : [])],
      },
      orderBy: [{ cookedOn: 'asc' }, { id: 'asc' }],
    });
    const batches = batchRows.map(toCookedBatch);

    const entryRows =
      batches.length === 0
        ? []
        : await tx.stockLedgerEntry.findMany({
            where: { householdId, batchId: { in: batches.map((batch) => batch.id) } },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          });

    return {
      householdId,
      ingredients,
      catalog: new IngredientCatalog(ingredients),
      menus: new Map<string, Menu>(menuRows.map(toMenu).map((menu) => [menu.id, menu])),
      calendar,
      meals,
      batches,
      entries: entryRows.map(toLedgerEntry),
      rules: toMealPlanningRules(rulesRow, pairingRows),
      shelfLifeDays: settingsRow?.shelfLifeDays ?? DEFAULT_SHELF_LIFE_DAYS,
    };
  }

  /** Batches the window alone would miss: emptied by a meal in the window, or named by the request. */
  private async batchIdsInScope(
    tx: PrismaTransaction,
    householdId: string,
    mealIds: readonly string[],
    scope: LoadScope,
  ): Promise<string[]> {
    const noFeedKeys = scope.noFeedKeys ?? [];
    const fromMeals =
      mealIds.length === 0
        ? []
        : await tx.stockLedgerEntry.findMany({
            where: { householdId, mealId: { in: [...mealIds] } },
            select: { batchId: true },
            distinct: ['batchId'],
          });
    const fromNoFeed =
      noFeedKeys.length === 0
        ? []
        : await tx.stockLedgerEntry.findMany({
            where: { householdId, noFeedKey: { in: [...noFeedKeys] } },
            select: { batchId: true },
            distinct: ['batchId'],
          });
    return [
      ...new Set([
        ...fromMeals.map((row) => row.batchId),
        ...fromNoFeed.map((row) => row.batchId),
        ...(scope.batchIds ?? []),
      ]),
    ];
  }
}

function earlier(base: LocalDate, named: LocalDate | undefined): LocalDate {
  return named !== undefined && named < base ? named : base;
}

/**
 * Order of the first meal of the slot that lands on or after `windowStart`.
 *
 * `orderAt` gives nothing for a no-feed date, so this steps forward until it finds a date that
 * carries a meal. Consecutive no-feed dates cannot outnumber the records themselves, and falling
 * back to 1 only widens the window, which is always safe.
 */
function minOrderOnOrAfter(calendar: MealCalendar, schedule: SlotSchedule, windowStart: LocalDate): number {
  if (windowStart <= schedule.startDate) return 1;
  const attempts = calendar.noFeedRecords.filter((record) => record.slot === schedule.slot).length + 1;
  let date = windowStart;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const order = calendar.orderAt(schedule.slot, date);
    if (order !== null) return order;
    date = addDays(date, 1);
  }
  return 1;
}
