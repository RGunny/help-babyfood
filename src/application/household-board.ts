import { ExposureMeal, projectExposures } from '../domain/ingredient/exposure-projection.js';
import { FeedingReaction } from '../domain/ingredient/introduction-status.js';
import { CalendarSlotEntry, lastPlannedMealDate, projectCalendar } from '../domain/meal-plan/calendar-projection.js';
import { Meal, effectiveComposition } from '../domain/meal-plan/meal.js';
import { NoFeedRecord } from '../domain/meal-plan/meal-calendar.js';
import { expandToCubeNeeds } from '../domain/menu/menu.js';
import { LocalDate, addDays, daysBetween } from '../domain/shared/local-date.js';
import { LocalDateTime } from '../domain/shared/local-time.js';
import { MealSlot } from '../domain/shared/meal-slot.js';
import { DailyBrief, DailyBriefInput, buildDailyBrief } from './daily-brief.js';
import { introductionStatuses, reactedIngredientIds } from './feeding-history.js';
import { HouseholdState } from './household-state.js';
import { FeedingHistory } from './ports/feeding-history.port.js';

/** One table of the spreadsheet layout is ten days. */
export const BOARD_BLOCK_DAYS = 10;
/** The board starts at the block holding this many days ago, so last week stays visible. */
export const BOARD_LOOKBACK_DAYS = 7;
/** Blocks shown at most. Older ones are dropped and counted. */
export const MAX_BOARD_BLOCKS = 6;
/**
 * How far back the state has to be loaded: the block holding `today - BOARD_LOOKBACK_DAYS` starts
 * at most `BOARD_BLOCK_DAYS - 1` days before that day.
 */
export const BOARD_LOAD_DAYS = BOARD_LOOKBACK_DAYS + BOARD_BLOCK_DAYS - 1;

/** Morning above afternoon, the way the spreadsheet stacks them. */
const SLOT_DISPLAY_ORDER: readonly MealSlot[] = ['morning', 'afternoon'];

export interface BoardIngredient {
  readonly ingredientId: string;
  readonly name: string;
  /** "①", "②": which exposure this meal is, when the ingredient still needs watching. */
  readonly exposureNumber: number | null;
  /** A planned meal still carries an ingredient the baby reacted to. Never set on a fed meal. */
  readonly reacted: boolean;
}

export interface BoardMeal {
  readonly menuName: string | null;
  /** Components of the base menu that need watching, so the base cell can be marked like the toppings. */
  readonly watchedBaseIngredients: readonly BoardIngredient[];
  readonly toppings: readonly BoardIngredient[];
  readonly memo: string | null;
  readonly fed: boolean;
  /** What was really fed differs from the plan, so the names above are the correction. */
  readonly corrected: boolean;
}

export interface BoardSlotEntry {
  readonly slot: MealSlot;
  /** Null when the slot was skipped that day or the plan has no more meals. */
  readonly meal: BoardMeal | null;
  readonly noFeed: NoFeedRecord | null;
}

export interface BoardDay {
  readonly date: LocalDate;
  /** "N일차". Null when nothing was fed that day. */
  readonly dayNumber: number | null;
  /** In display order: morning first. */
  readonly slots: readonly BoardSlotEntry[];
}

/** Ten consecutive days, numbered from the feeding start date. */
export interface BoardBlock {
  /** 1-based. Block 1 starts on the feeding start date. */
  readonly number: number;
  readonly days: readonly BoardDay[];
}

export interface HouseholdBoard {
  readonly now: LocalDateTime;
  /** Stock, expiry and attention are the brief's; the board shows the same things. */
  readonly brief: DailyBrief;
  /** Slots that have a meal anywhere in the window, in display order. */
  readonly slots: readonly MealSlot[];
  readonly blocks: readonly BoardBlock[];
  /** Blocks older than the ones shown, dropped to stay within `MAX_BOARD_BLOCKS`. */
  readonly omittedBlocks: number;
}

/**
 * The board of ADR 0008: today's brief plus the calendar laid out the way the spreadsheet was.
 *
 * Pure, like `buildDailyBrief`. The exposure numbers of every meal in the window come from
 * `projectExposures`, started from the introduction status the history gives at the window start,
 * so that a meal before the window counts and a meal inside it is not counted twice.
 */
export function buildHouseholdBoard(input: DailyBriefInput): HouseholdBoard {
  const { state, history, now } = input;
  const brief = buildDailyBrief(input);
  const start = state.calendar.feedingStartDate;
  if (start === null) return { now, brief, slots: [], blocks: [], omittedBlocks: 0 };

  const today = now.date;
  const blockIndexOf = (date: LocalDate): number =>
    Math.max(0, Math.floor(daysBetween(start, date) / BOARD_BLOCK_DAYS));
  const lastPlanned = lastPlannedMealDate(state.meals, state.calendar);
  const lastIndex = blockIndexOf(lastPlanned !== null && lastPlanned > today ? lastPlanned : today);
  const wantedFirst = blockIndexOf(addDays(today, -BOARD_LOOKBACK_DAYS));
  const omittedBlocks = Math.max(0, lastIndex - wantedFirst + 1 - MAX_BOARD_BLOCKS);
  const firstIndex = wantedFirst + omittedBlocks;

  const windowStart = addDays(start, firstIndex * BOARD_BLOCK_DAYS);
  const windowEnd = addDays(start, (lastIndex + 1) * BOARD_BLOCK_DAYS - 1);
  const days = projectCalendar(state.meals, state.calendar, windowStart, windowEnd).map((day) => ({
    ...day,
    slots: orderSlots(day.slots),
  }));

  const exposures = projectExposures({
    initialStatuses: introductionStatuses(historyBefore(history, state, windowStart), state.ingredients, state.menus),
    meals: days.flatMap((day) => day.slots.flatMap((entry) => exposureMealOf(state, history, entry))),
  });
  const reacted = reactedIngredientIds(introductionStatuses(history, state.ingredients, state.menus));

  const boardDays: BoardDay[] = days.map((day) => ({
    date: day.date,
    dayNumber: day.dayNumber,
    slots: day.slots.map((entry) => ({
      slot: entry.slot,
      noFeed: entry.noFeed,
      meal:
        entry.meal === null
          ? null
          : boardMealOf(state, entry.meal, exposures.get(entry.meal.id) ?? new Map(), reacted),
    })),
  }));

  return {
    now,
    brief,
    slots: SLOT_DISPLAY_ORDER.filter((slot) =>
      boardDays.some((day) => day.slots.some((entry) => entry.slot === slot && entry.meal !== null)),
    ),
    blocks: chunk(boardDays, BOARD_BLOCK_DAYS).map((blockDays, index) => ({
      number: firstIndex + index + 1,
      days: blockDays,
    })),
    omittedBlocks,
  };
}

function orderSlots(entries: readonly CalendarSlotEntry[]): CalendarSlotEntry[] {
  return SLOT_DISPLAY_ORDER.flatMap((slot) => entries.filter((entry) => entry.slot === slot));
}

/** The history as it stood before the window: the meals fed before its first day. */
function historyBefore(history: FeedingHistory, state: HouseholdState, windowStart: LocalDate): FeedingHistory {
  const { calendar } = state;
  return {
    ...history,
    consumedMeals: history.consumedMeals.filter(
      (meal) => calendar.hasSlot(meal.slot) && calendar.dateOf(meal.slot, meal.order) < windowStart,
    ),
  };
}

function exposureMealOf(state: HouseholdState, history: FeedingHistory, entry: CalendarSlotEntry): ExposureMeal[] {
  if (entry.meal === null) return [];
  const { meal } = entry;
  const reactions = new Map<string, FeedingReaction>(
    history.reactions
      .filter((reaction) => reaction.mealId === meal.id)
      .map((reaction) => [reaction.ingredientId, reaction.result]),
  );
  return [
    {
      mealId: meal.id,
      ingredientIds: expandToCubeNeeds(effectiveComposition(meal), state.menus).map((need) => need.ingredientId),
      fed: meal.status === 'consumed',
      reactions,
    },
  ];
}

function boardMealOf(
  state: HouseholdState,
  meal: Meal,
  exposures: ReadonlyMap<string, number>,
  reacted: ReadonlySet<string>,
): BoardMeal {
  const composition = effectiveComposition(meal);
  const ingredientOf = (ingredientId: string): BoardIngredient => ({
    ingredientId,
    name: state.catalog.getById(ingredientId).name,
    exposureNumber: exposures.get(ingredientId) ?? null,
    reacted: meal.status === 'planned' && reacted.has(ingredientId),
  });
  const menu = composition.baseMenuId === null ? null : (state.menus.get(composition.baseMenuId) ?? null);
  return {
    menuName: menu?.name ?? null,
    watchedBaseIngredients: (menu?.components ?? [])
      .map((component) => ingredientOf(component.ingredientId))
      .filter((ingredient) => ingredient.exposureNumber !== null || ingredient.reacted),
    toppings: composition.toppingIngredientIds.map(ingredientOf),
    memo: meal.memo,
    fed: meal.status === 'consumed',
    corrected: meal.actual !== null,
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

