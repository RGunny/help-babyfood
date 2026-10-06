import { reconcileMeals } from '../domain/deduction/reconcile.js';
import {
  IntroductionStatus,
  needsObservation,
  nextExposureNumber,
} from '../domain/ingredient/introduction-status.js';
import { CalendarDay, lastPlannedMealDate, projectCalendar } from '../domain/meal-plan/calendar-projection.js';
import { Meal, effectiveComposition } from '../domain/meal-plan/meal.js';
import { NoFeedRecord } from '../domain/meal-plan/meal-calendar.js';
import { expandToCubeNeeds } from '../domain/menu/menu.js';
import { RuleWarningCode, validateMealPlan } from '../domain/rules/meal-rules.js';
import { LocalDate, addDays, daysBetween } from '../domain/shared/local-date.js';
import { LocalDateTime, LocalTime } from '../domain/shared/local-time.js';
import { MealSlot } from '../domain/shared/meal-slot.js';
import { ExpiryStage, expiryDateOf } from '../domain/stock/expiry.js';
import { IngredientForecast, forecastShortage } from '../domain/forecast/shortage-forecast.js';
import {
  IngredientStock,
  batchesNeedingExpiryAlert,
  isAtOrBelowThreshold,
  summarizeStock,
} from '../domain/stock/stock-summary.js';
import {
  fedIngredientIdsBefore,
  introductionStatuses,
  reactedIngredientIds,
} from './feeding-history.js';
import { HouseholdState, toReconcileInput } from './household-state.js';
import { FeedingHistory } from './ports/feeding-history.port.js';

/**
 * Days of plan left below which the brief says so.
 *
 * Not a stored setting: the alert settings of the plan (chapter 6) are the brief time, the
 * per-ingredient thresholds and the shelf life, and this number is about the plan running out
 * rather than about stock.
 */
export const PLAN_RUNWAY_WARNING_DAYS = 7;

/**
 * Days ahead of today within which a first shortage puts an ingredient in the stock alert.
 *
 * Not a stored setting, for the same reason as above: ADR 0010 keeps the alert settings at three.
 * Seven is one week. Over the whole plan the alert listed 27 ingredients on the day it was
 * decided and ten within the week, and the shortfall it reports is what one cooking session can
 * make rather than a month of rice.
 */
export const STOCK_ALERT_HORIZON_DAYS = 7;

/**
 * Days ahead of today within which a first shortage is urgent. Not a stored setting either.
 *
 * One is the time cooking takes (ADR 0010): a meal of today or tomorrow is not fed unless the
 * cubes are cooked now.
 */
export const STOCK_ALERT_URGENT_DAYS = 1;

export interface BriefMealItem {
  readonly menuName: string | null;
  readonly toppingNames: readonly string[];
  readonly memo: string | null;
  readonly fed: boolean;
  /** What was really fed differs from the plan, so the names above are the correction. */
  readonly corrected: boolean;
}

export interface BriefSlot {
  readonly slot: MealSlot;
  readonly mealTime: LocalTime;
  /** Null when the slot was skipped that day or the plan has no more meals. */
  readonly meal: BriefMealItem | null;
  readonly noFeed: NoFeedRecord | null;
}

/** "오늘 새 재료: 완두콩(1회차), 급여 후 반응 관찰". */
export interface BriefNewIngredient {
  readonly ingredientId: string;
  readonly name: string;
  readonly slot: MealSlot;
  readonly exposureNumber: number;
}

export interface BriefNextExpiry {
  readonly date: LocalDate;
  readonly stage: ExpiryStage;
}

export interface BriefStockRow {
  readonly ingredientId: string;
  readonly name: string;
  readonly total: number;
  readonly fresh: number;
  readonly overdue: number;
  readonly weightMismatched: number;
  /** Date the plan uses the last deductible cube. Null when stock outlasts the plan. */
  readonly depletionDate: LocalDate | null;
  /** First meal date stock cannot cover, over the whole plan. Null when stock outlasts the plan. */
  readonly firstShortageDate: LocalDate | null;
  /** Earliest expiry among the batches with cubes left. Null when nothing is in the freezer. */
  readonly nextExpiry: BriefNextExpiry | null;
}

/** Ingredients that are always at hand and therefore have no stock row. */
export interface BriefPantryIngredient {
  readonly ingredientId: string;
  readonly name: string;
}

export interface BriefShortage {
  readonly ingredientId: string;
  readonly name: string;
  readonly plannedCubes: number;
  /** First meal date stock cannot cover. Cooking has to happen on or before it. */
  readonly firstShortageDate: LocalDate;
  readonly shortfallCubes: number;
}

export interface BriefThresholdAlert {
  readonly ingredientId: string;
  readonly name: string;
  readonly total: number;
  readonly thresholdCubes: number;
}

export type StockAlertUrgency = 'urgent' | 'upcoming' | 'low_stock';

export interface BriefStockAlertItem {
  readonly ingredientId: string;
  readonly name: string;
  readonly total: number;
  /** The threshold the ingredient reached. Null when it has none or stock is above it. */
  readonly thresholdCubes: number | null;
  /** First meal date stock cannot cover, over the whole plan. Null when stock outlasts the plan. */
  readonly firstShortageDate: LocalDate | null;
  /** Days from today to `firstShortageDate`. Zero or negative when a meal is already short. */
  readonly daysUntilShortage: number | null;
  /** Cubes missing for the meals within the horizon. Zero when the first shortage is beyond it. */
  readonly horizonShortfallCubes: number;
  readonly urgency: StockAlertUrgency;
}

export interface BriefStockAlert {
  readonly horizonDays: number;
  readonly items: readonly BriefStockAlertItem[];
}

export interface BriefExpiryAlert {
  readonly batchId: string;
  readonly ingredientId: string;
  readonly name: string;
  readonly cookedOn: LocalDate;
  readonly expiryDate: LocalDate;
  readonly remaining: number;
  readonly stage: ExpiryStage;
}

export interface BriefHeldDeduction {
  readonly ingredientId: string;
  readonly name: string;
  readonly cubes: number;
  readonly date: LocalDate;
  readonly slot: MealSlot | null;
}

export interface BriefUnrecordedReaction {
  readonly ingredientId: string;
  readonly name: string;
  readonly date: LocalDate;
  readonly slot: MealSlot;
}

export interface BriefRuleWarning {
  readonly code: RuleWarningCode;
  readonly date: LocalDate;
  readonly slot: MealSlot | null;
  readonly ingredientNames: readonly string[];
}

export interface BriefWeightMismatch {
  readonly batchId: string;
  readonly ingredientId: string;
  readonly name: string;
  readonly cookedOn: LocalDate;
  readonly remaining: number;
  readonly cubeWeightGram: number;
  readonly servingWeightGram: number;
}

/** 확인 필요: the parent has to do something about each of these. */
export interface BriefAttention {
  readonly heldDeductions: readonly BriefHeldDeduction[];
  readonly unrecordedReactions: readonly BriefUnrecordedReaction[];
  readonly ruleWarnings: readonly BriefRuleWarning[];
  readonly weightMismatchedBatches: readonly BriefWeightMismatch[];
  /** Days until the last planned meal. Null when no meal is planned at all. */
  readonly planRunwayDays: number | null;
  readonly planRunwayShort: boolean;
}

export interface DailyBrief {
  readonly date: LocalDate;
  readonly dayNumber: number | null;
  readonly slots: readonly BriefSlot[];
  readonly newIngredients: readonly BriefNewIngredient[];
  readonly stock: readonly BriefStockRow[];
  readonly pantryIngredients: readonly BriefPantryIngredient[];
  readonly shortages: readonly BriefShortage[];
  readonly thresholdAlerts: readonly BriefThresholdAlert[];
  readonly expiryAlerts: readonly BriefExpiryAlert[];
  readonly stockAlert: BriefStockAlert;
  readonly attention: BriefAttention;
}

export interface DailyBriefInput {
  readonly state: HouseholdState;
  readonly history: FeedingHistory;
  readonly now: LocalDateTime;
}

/**
 * Assembles chapter 5 of the plan out of the domain functions that already compute each part.
 *
 * Pure, and it writes nothing. The held deductions are the reason this matters: they are not
 * stored, because a stored row would keep saying "short" after the cooking arrives, so the brief
 * runs `reconcileMeals` again and keeps only `held`. The status changes and ledger entries of that
 * run are thrown away here and applied by the scheduler's transaction instead, which is what keeps
 * `get_daily_brief` a read.
 *
 * One consequence worth knowing: within the minute between a meal time and the next reconciliation,
 * the stock table still counts the cube of a meal already eaten. Applying the result to the
 * snapshot would hide that, at the price of `get_daily_brief` and `get_stock_status` reporting
 * different numbers at the same instant.
 */
export function buildDailyBrief(input: DailyBriefInput): DailyBrief {
  const { state, history } = input;
  const today = input.now.date;
  const nameOf = (ingredientId: string): string => state.catalog.getById(ingredientId).name;

  const statuses = introductionStatuses(history, state.ingredients, state.menus);
  const lastPlanned = lastPlannedMealDate(state.meals, state.calendar);
  // 오늘 한 줄과 규칙 검증이 같은 투영을 쓴다. 경고는 남은 식단 전체를 본다. 조합 위반이나
  // 반응있음 재료는 그 날짜가 오기 전에 고쳐야 하고, 고칠 때까지 매일 다시 올라와야 한다.
  const days = projectCalendar(state.meals, state.calendar, today, laterOf(today, lastPlanned));
  const [dayOfToday] = days;

  const stocks = summarizeStock(
    state.ingredients,
    state.batches,
    state.entries,
    today,
    state.alertSettings.shelfLifeDays,
  );
  const plan = {
    ingredients: state.ingredients,
    meals: state.meals,
    calendar: state.calendar,
    menus: state.menus,
    batches: state.batches,
    entries: state.entries,
  };
  const forecasts = forecastsById(forecastShortage({ ...plan, until: null }));
  const horizonForecasts = forecastsById(
    forecastShortage({ ...plan, until: addDays(today, STOCK_ALERT_HORIZON_DAYS) }),
  );
  // 임계개수 알람과 재고 알람이 같은 판정을 쓴다. 닿은 재료만 그 임계개수와 함께 남긴다.
  const reachedThresholds = new Map(
    stocks.flatMap((stock): [string, number][] => {
      const threshold = state.thresholds.get(stock.ingredientId);
      return threshold !== undefined && isAtOrBelowThreshold(stock, threshold)
        ? [[stock.ingredientId, threshold]]
        : [];
    }),
  );

  return {
    date: today,
    dayNumber: dayOfToday.dayNumber,
    slots: briefSlots(state, dayOfToday),
    newIngredients: newIngredientsOf(state, dayOfToday, statuses, nameOf),
    stock: stocks.map((stock) => ({
      ingredientId: stock.ingredientId,
      name: nameOf(stock.ingredientId),
      total: stock.total,
      fresh: stock.fresh,
      overdue: stock.overdue,
      weightMismatched: stock.weightMismatched,
      depletionDate: forecasts.get(stock.ingredientId)?.depletionDate ?? null,
      firstShortageDate: forecasts.get(stock.ingredientId)?.firstShortageDate ?? null,
      // 배치는 조리일 순이라 첫 배치의 임계일이 가장 이르다.
      nextExpiry:
        stock.batches.length === 0
          ? null
          : {
              date: expiryDateOf(stock.batches[0].batch, state.alertSettings.shelfLifeDays),
              stage: stock.batches[0].expiry,
            },
    })),
    pantryIngredients: state.ingredients
      .filter((ingredient) => ingredient.stockTracking === 'pantry')
      .map((ingredient) => ({ ingredientId: ingredient.id, name: ingredient.name })),
    shortages: [...forecasts.values()]
      .filter((forecast) => forecast.firstShortageDate !== null)
      .map((forecast) => ({
        ingredientId: forecast.ingredientId,
        name: nameOf(forecast.ingredientId),
        plannedCubes: forecast.plannedCubes,
        firstShortageDate: forecast.firstShortageDate!,
        shortfallCubes: forecast.shortfallCubes,
      })),
    thresholdAlerts: stocks
      .filter((stock) => reachedThresholds.has(stock.ingredientId))
      .map((stock) => ({
        ingredientId: stock.ingredientId,
        name: nameOf(stock.ingredientId),
        total: stock.total,
        thresholdCubes: reachedThresholds.get(stock.ingredientId)!,
      })),
    expiryAlerts: batchesNeedingExpiryAlert(stocks).map((batchStock) => ({
      batchId: batchStock.batch.id,
      ingredientId: batchStock.batch.ingredientId,
      name: nameOf(batchStock.batch.ingredientId),
      cookedOn: batchStock.batch.cookedOn,
      expiryDate: expiryDateOf(batchStock.batch, state.alertSettings.shelfLifeDays),
      remaining: batchStock.remaining,
      stage: batchStock.expiry,
    })),
    stockAlert: stockAlertOf(stocks, forecasts, horizonForecasts, reachedThresholds, today, nameOf),
    attention: {
      heldDeductions: heldDeductionsOf(input, nameOf),
      unrecordedReactions: unrecordedReactionsOf(state, history, statuses, nameOf),
      ruleWarnings: validateMealPlan({
        days,
        menus: state.menus,
        catalog: state.catalog,
        rules: state.rules,
        alreadyFedIngredientIds: fedIngredientIdsBefore(history, state.calendar, state.menus, today),
        reactedIngredientIds: reactedIngredientIds(statuses),
      }).map((warning) => ({
        code: warning.code,
        date: warning.date,
        slot: warning.slot,
        ingredientNames: warning.ingredientIds.map(nameOf),
      })),
      weightMismatchedBatches: stocks
        .flatMap((stock) => stock.batches)
        .filter((batchStock) => batchStock.weightMismatched)
        .map((batchStock) => ({
          batchId: batchStock.batch.id,
          ingredientId: batchStock.batch.ingredientId,
          name: nameOf(batchStock.batch.ingredientId),
          cookedOn: batchStock.batch.cookedOn,
          remaining: batchStock.remaining,
          cubeWeightGram: batchStock.batch.cubeWeightGram,
          servingWeightGram: state.catalog.getById(batchStock.batch.ingredientId).servingWeightGram,
        })),
      planRunwayDays: lastPlanned === null ? null : daysBetween(today, lastPlanned),
      planRunwayShort: lastPlanned === null || daysBetween(today, lastPlanned) <= PLAN_RUNWAY_WARNING_DAYS,
    },
  };
}

function briefSlots(state: HouseholdState, day: CalendarDay): BriefSlot[] {
  return day.slots.map((entry) => ({
    slot: entry.slot,
    mealTime: state.calendar.slotSchedules.find((schedule) => schedule.slot === entry.slot)!.mealTime,
    meal: entry.meal === null ? null : briefMealItem(state, entry.meal),
    noFeed: entry.noFeed,
  }));
}

function briefMealItem(state: HouseholdState, meal: Meal): BriefMealItem {
  const composition = effectiveComposition(meal);
  return {
    menuName: composition.baseMenuId === null ? null : (state.menus.get(composition.baseMenuId)?.name ?? null),
    toppingNames: composition.toppingIngredientIds.map((id) => state.catalog.getById(id).name),
    memo: meal.memo,
    fed: meal.status === 'consumed',
    corrected: meal.actual !== null,
  };
}

/**
 * Ingredients of today's meals that a parent still has to watch the baby for.
 *
 * Both the not-introduced and the verifying states qualify, and the exposure number is what the
 * parent is told to expect: `nextExposureNumber` counts only the feedings recorded as clear.
 */
function newIngredientsOf(
  state: HouseholdState,
  day: CalendarDay,
  statuses: ReadonlyMap<string, IntroductionStatus>,
  nameOf: (ingredientId: string) => string,
): BriefNewIngredient[] {
  const newIngredients: BriefNewIngredient[] = [];
  for (const entry of day.slots) {
    if (entry.meal === null) continue;
    for (const need of expandToCubeNeeds(effectiveComposition(entry.meal), state.menus)) {
      const status = statuses.get(need.ingredientId);
      const exposureNumber = status === undefined ? null : nextExposureNumber(status);
      if (status === undefined || !needsObservation(status) || exposureNumber === null) continue;
      newIngredients.push({
        ingredientId: need.ingredientId,
        name: nameOf(need.ingredientId),
        slot: entry.slot,
        exposureNumber,
      });
    }
  }
  return newIngredients;
}

/**
 * Ingredients a parent has to cook: short within the horizon by the plan, or at their threshold.
 *
 * The two conditions look at different numbers on purpose. The threshold compares the total in the
 * freezer, while the forecast plays the meals against deductible cubes only. A batch whose cube
 * weight differs from the serving weight counts in the total but no meal deducts from it, so an
 * ingredient can sit above its threshold and still be short tomorrow.
 *
 * Nothing here is stored. An item stays in the alert until cooking or a plan change removes it
 * from the next computation.
 */
function stockAlertOf(
  stocks: readonly IngredientStock[],
  forecasts: ReadonlyMap<string, IngredientForecast>,
  horizonForecasts: ReadonlyMap<string, IngredientForecast>,
  reachedThresholds: ReadonlyMap<string, number>,
  today: LocalDate,
  nameOf: (ingredientId: string) => string,
): BriefStockAlert {
  const items: BriefStockAlertItem[] = [];
  for (const stock of stocks) {
    const firstShortageDate = forecasts.get(stock.ingredientId)?.firstShortageDate ?? null;
    const daysUntilShortage = firstShortageDate === null ? null : daysBetween(today, firstShortageDate);
    const thresholdCubes = reachedThresholds.get(stock.ingredientId) ?? null;
    const shortWithinHorizon = daysUntilShortage !== null && daysUntilShortage <= STOCK_ALERT_HORIZON_DAYS;
    if (!shortWithinHorizon && thresholdCubes === null) continue;
    items.push({
      ingredientId: stock.ingredientId,
      name: nameOf(stock.ingredientId),
      total: stock.total,
      thresholdCubes,
      firstShortageDate,
      daysUntilShortage,
      horizonShortfallCubes: horizonForecasts.get(stock.ingredientId)?.shortfallCubes ?? 0,
      urgency: !shortWithinHorizon
        ? 'low_stock'
        : daysUntilShortage <= STOCK_ALERT_URGENT_DAYS
          ? 'urgent'
          : 'upcoming',
    });
  }
  // 정렬이 안정적이라 첫 부족일이 같은 항목은 재고 표의 순서를 지킨다.
  items.sort((a, b) => compareNullsLast(a.firstShortageDate, b.firstShortageDate));
  return { horizonDays: STOCK_ALERT_HORIZON_DAYS, items };
}

/** Deductions stock was short for. Recomputed here rather than read from a table; see the header. */
function heldDeductionsOf(
  input: DailyBriefInput,
  nameOf: (ingredientId: string) => string,
): BriefHeldDeduction[] {
  const { held } = reconcileMeals(toReconcileInput(input.state, input.now));
  const mealById = new Map(input.state.meals.map((meal) => [meal.id, meal]));
  return held.map((deduction) => ({
    ingredientId: deduction.ingredientId,
    name: nameOf(deduction.ingredientId),
    cubes: deduction.cubes,
    date: deduction.mealDate,
    slot: mealById.get(deduction.mealId)?.slot ?? null,
  }));
}

/**
 * Meals already fed whose new ingredient has no reaction recorded.
 *
 * Migrated meals are left out. Chapter 4.8 says reactions of past meals are not entered one by one:
 * the parent registers the ingredients already verified at migration instead, so a migrated meal
 * would produce a reminder nobody can answer.
 */
function unrecordedReactionsOf(
  state: HouseholdState,
  history: FeedingHistory,
  statuses: ReadonlyMap<string, IntroductionStatus>,
  nameOf: (ingredientId: string) => string,
): BriefUnrecordedReaction[] {
  const unrecorded: BriefUnrecordedReaction[] = [];
  for (const meal of history.consumedMeals) {
    if (meal.migrated || !state.calendar.hasSlot(meal.slot)) continue;
    for (const need of expandToCubeNeeds(effectiveComposition(meal), state.menus)) {
      const status = statuses.get(need.ingredientId);
      if (status === undefined || !needsObservation(status)) continue;
      const recorded = history.reactions.some(
        (reaction) => reaction.mealId === meal.id && reaction.ingredientId === need.ingredientId,
      );
      if (recorded) continue;
      unrecorded.push({
        ingredientId: need.ingredientId,
        name: nameOf(need.ingredientId),
        date: state.calendar.dateOf(meal.slot, meal.order),
        slot: meal.slot,
      });
    }
  }
  return unrecorded;
}

function forecastsById(forecasts: readonly IngredientForecast[]): Map<string, IngredientForecast> {
  return new Map(forecasts.map((forecast) => [forecast.ingredientId, forecast]));
}

function compareNullsLast(a: LocalDate | null, b: LocalDate | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function laterOf(date: LocalDate, other: LocalDate | null): LocalDate {
  return other !== null && other > date ? other : date;
}
