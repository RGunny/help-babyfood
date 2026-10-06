import { AlertSettings } from '../../../application/household-state.js';
import { Ingredient } from '../../../domain/ingredient/ingredient.js';
import { Meal } from '../../../domain/meal-plan/meal.js';
import { NoFeedRecord, SlotSchedule } from '../../../domain/meal-plan/meal-calendar.js';
import { MealComposition, Menu } from '../../../domain/menu/menu.js';
import { ForbiddenPairing, MealPlanningRules } from '../../../domain/rules/meal-rules.js';
import { localTime } from '../../../domain/shared/local-time.js';
import { DEFAULT_SHELF_LIFE_DAYS } from '../../../domain/stock/expiry.js';
import { CookedBatch, LedgerEntry } from '../../../domain/stock/ledger.js';
import { toLocalDate } from './local-date.mapper.js';

// enum 값은 도메인 문자열 리터럴과 글자까지 같게 두었으므로 변환이 필요 없다. 행 타입은
// 생성된 Prisma 타입에 묶지 않고 필요한 필드만 구조로 받는다. 저장소가 select를 좁혀도
// 매퍼가 깨지지 않고, 도메인 테스트와 같은 방식으로 단위 테스트를 쓸 수 있다.

export interface IngredientRow {
  id: string;
  name: string;
  category: Ingredient['category'];
  servingWeightGram: number;
  stockTracking: Ingredient['stockTracking'];
  labels: { label: string; isCanonical: boolean; position: number }[];
}

export function toIngredient(row: IngredientRow): Ingredient {
  return {
    id: row.id,
    name: row.name,
    aliases: row.labels
      .filter((label) => !label.isCanonical)
      .sort((a, b) => a.position - b.position)
      .map((label) => label.label),
    category: row.category,
    servingWeightGram: row.servingWeightGram,
    stockTracking: row.stockTracking,
    constituentIngredientIds: [],
  };
}

export interface MenuRow {
  id: string;
  name: string;
  components: { ingredientId: string; cubes: number }[];
}

export function toMenu(row: MenuRow): Menu {
  return {
    id: row.id,
    name: row.name,
    components: row.components.map((component) => ({
      ingredientId: component.ingredientId,
      cubes: component.cubes,
    })),
  };
}

export interface SlotScheduleRow {
  slot: SlotSchedule['slot'];
  startDate: Date;
  mealTime: string;
}

export function toSlotSchedule(row: SlotScheduleRow): SlotSchedule {
  return { slot: row.slot, startDate: toLocalDate(row.startDate), mealTime: localTime(row.mealTime) };
}

export interface NoFeedRow {
  date: Date;
  slot: NoFeedRecord['slot'];
  thawed: boolean;
  reason: string | null;
}

export function toNoFeedRecord(row: NoFeedRow): NoFeedRecord {
  return { date: toLocalDate(row.date), slot: row.slot, thawed: row.thawed, reason: row.reason };
}

export interface MealRow {
  id: string;
  slot: Meal['slot'];
  mealOrder: number;
  plannedBaseMenuId: string | null;
  memo: string | null;
  status: Meal['status'];
  migrated: boolean;
  actual: { actualBaseMenuId: string | null } | null;
  toppings: { kind: 'planned' | 'actual'; position: number; ingredientId: string }[];
}

export function toMeal(row: MealRow): Meal {
  return {
    id: row.id,
    slot: row.slot,
    order: row.mealOrder,
    planned: composition(row.plannedBaseMenuId, row.toppings, 'planned'),
    // 행이 없으면 실제 급여 내용이 입력되지 않은 것이다. 토핑 없는 실제 급여와 구분된다.
    actual: row.actual === null ? null : composition(row.actual.actualBaseMenuId, row.toppings, 'actual'),
    memo: row.memo,
    status: row.status,
    migrated: row.migrated,
  };
}

function composition(
  baseMenuId: string | null,
  toppings: MealRow['toppings'],
  kind: 'planned' | 'actual',
): MealComposition {
  return {
    baseMenuId,
    toppingIngredientIds: toppings
      .filter((topping) => topping.kind === kind)
      .sort((a, b) => a.position - b.position)
      .map((topping) => topping.ingredientId),
  };
}

export interface CookedBatchRow {
  id: string;
  ingredientId: string;
  cubeWeightGram: number;
  cookedOn: Date;
}

export function toCookedBatch(row: CookedBatchRow): CookedBatch {
  return {
    id: row.id,
    ingredientId: row.ingredientId,
    cubeWeightGram: row.cubeWeightGram,
    cookedOn: toLocalDate(row.cookedOn),
  };
}

export interface LedgerEntryRow {
  batchId: string;
  type: LedgerEntry['type'];
  delta: number;
  mealId: string | null;
  reason: string | null;
  noFeedKey: string | null;
}

export function toLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  const entry: LedgerEntry = {
    batchId: row.batchId,
    type: row.type,
    delta: row.delta,
    mealId: row.mealId,
    reason: row.reason,
  };
  // noFeedKey는 선택 속성이라 null을 넣으면 도메인이 만든 값과 toEqual이 어긋난다.
  return row.noFeedKey === null ? entry : { ...entry, noFeedKey: row.noFeedKey };
}

export interface RulesRow {
  textGuidance: string | null;
  maxFirstIntroductionsPerDay: number | null;
  firstIntroductionSlot: MealPlanningRules['firstIntroductionSlot'];
}

export interface PairingRow {
  ingredientAId: string;
  ingredientBId: string;
  scope: ForbiddenPairing['scope'];
}

export const DEFAULT_PLANNING_RULES: MealPlanningRules = {
  forbiddenPairings: [],
  maxFirstIntroductionsPerDay: null,
  firstIntroductionSlot: null,
};

/** Used until parents set their own. 07:30 is the example the plan works from. */
export const DEFAULT_BRIEF_TIME = '07:30';

export interface AlertSettingsRow {
  briefTime: string;
  shelfLifeDays: number;
}

export function toAlertSettings(row: AlertSettingsRow | null): AlertSettings {
  return {
    briefTime: localTime(row?.briefTime ?? DEFAULT_BRIEF_TIME),
    shelfLifeDays: row?.shelfLifeDays ?? DEFAULT_SHELF_LIFE_DAYS,
  };
}

export interface ThresholdRow {
  ingredientId: string;
  thresholdCubes: number;
}

export function toThresholds(rows: readonly ThresholdRow[]): ReadonlyMap<string, number> {
  return new Map(rows.map((row) => [row.ingredientId, row.thresholdCubes]));
}

export function toMealPlanningRules(row: RulesRow | null, pairings: PairingRow[]): MealPlanningRules {
  return {
    forbiddenPairings: pairings.map<ForbiddenPairing>((pairing) => ({
      ingredientIds: [pairing.ingredientAId, pairing.ingredientBId],
      scope: pairing.scope,
    })),
    maxFirstIntroductionsPerDay: row?.maxFirstIntroductionsPerDay ?? null,
    firstIntroductionSlot: row?.firstIntroductionSlot ?? null,
  };
}
