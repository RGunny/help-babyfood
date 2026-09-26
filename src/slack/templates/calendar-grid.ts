import { BoardBlock, BoardDay, BoardIngredient, BoardMeal, BoardSlotEntry, HouseholdBoard } from '../../application/household-board.js';
import { LocalDate } from '../../domain/shared/local-date.js';
import { MealSlot } from '../../domain/shared/meal-slot.js';
import { SLOT_LABEL, shortDate, weekdayLabel } from './labels.js';
import { MAX_TABLE_CELLS } from './markdown.js';

/** One week's table, laid out the way the spreadsheet was: a column per day, a row per line. */
export interface GridBlock {
  readonly number: number;
  /** The corner label, then one header per day. */
  readonly header: readonly string[];
  /** Index into `header` of today's column, or null when today is not in this block. */
  readonly todayColumn: number | null;
  /** Each row starts with its label. */
  readonly rows: readonly (readonly string[])[];
  /** Toppings that did not fit in the rows the cell limit allows. */
  readonly omittedToppings: number;
}

export interface CalendarGrid {
  readonly blocks: readonly GridBlock[];
  readonly omittedBlocks: number;
}

/** Circled digits for the exposure number, the way the spreadsheet coloured a first introduction. */
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
const REACTED_MARK = '⚠';
const TODAY_MARK = '▶';
const FED_MARK = '✓';

/**
 * Turns the board's blocks into tables without deciding how they are drawn. The markdown renderer
 * and a Block Kit renderer would both start from this, so the cell texts are plain: no markup.
 */
export function calendarGridOf(board: HouseholdBoard): CalendarGrid {
  return {
    blocks: board.blocks.map((block) => gridBlockOf(block, board.slots, board.now.date)),
    omittedBlocks: board.omittedBlocks,
  };
}

function gridBlockOf(block: BoardBlock, slots: readonly MealSlot[], today: LocalDate): GridBlock {
  const header = ['일차', ...block.days.map(dayHeader)];
  const todayIndex = block.days.findIndex((day) => day.date === today);
  const rows: string[][] = [['날짜', ...block.days.map((day) => `${shortDate(day.date)} ${weekdayLabel(day.date)}`)]];

  const toppingRows = fitToppingRows(block, slots, header.length, rows.length);
  let omittedToppings = 0;
  for (const slot of slots) {
    const entries = block.days.map((day) => day.slots.find((entry) => entry.slot === slot) ?? null);
    rows.push([`${SLOT_LABEL[slot]} 베이스`, ...entries.map(baseCell)]);
    const rowCount = toppingRows.get(slot) ?? 1;
    for (let index = 0; index < rowCount; index += 1) {
      rows.push([index === 0 ? `${SLOT_LABEL[slot]} 토핑` : '', ...entries.map((entry) => toppingCell(entry, index))]);
    }
    omittedToppings += entries.reduce(
      (sum, entry) => sum + Math.max(0, (entry?.meal?.toppings.length ?? 0) - rowCount),
      0,
    );
  }

  return {
    number: block.number,
    header,
    todayColumn: todayIndex === -1 ? null : todayIndex + 1,
    rows,
    omittedToppings,
  };
}

/**
 * Topping rows per slot: as many as the block's fullest meal needs, at least one, cut back from the
 * fullest slot first until the table fits in `MAX_TABLE_CELLS`.
 */
function fitToppingRows(
  block: BoardBlock,
  slots: readonly MealSlot[],
  columns: number,
  fixedRows: number,
): Map<MealSlot, number> {
  const rowsBySlot = new Map<MealSlot, number>(
    slots.map((slot) => [
      slot,
      Math.max(
        1,
        ...block.days.map((day) => day.slots.find((entry) => entry.slot === slot)?.meal?.toppings.length ?? 0),
      ),
    ]),
  );
  const rowCount = (): number =>
    1 + fixedRows + [...rowsBySlot.values()].reduce((sum, toppingRows) => sum + 1 + toppingRows, 0);

  while (rowCount() * columns > MAX_TABLE_CELLS) {
    const [fullest] = [...rowsBySlot.entries()].sort(([, a], [, b]) => b - a);
    if (fullest === undefined || fullest[1] <= 1) break;
    rowsBySlot.set(fullest[0], fullest[1] - 1);
  }
  return rowsBySlot;
}

function dayHeader(day: BoardDay): string {
  if (day.dayNumber === null) return day.slots.some((entry) => entry.noFeed !== null) ? '미급여' : '';
  const fed = day.slots.some((entry) => entry.meal?.fed === true);
  return `${day.dayNumber}일차${fed ? ` ${FED_MARK}` : ''}`;
}

/** Only the header carries the mark; the renderer decides how else to set the column apart. */
export function todayHeader(header: string): string {
  return `${TODAY_MARK} ${header}`;
}

function baseCell(entry: BoardSlotEntry | null): string {
  if (entry === null) return '';
  if (entry.noFeed !== null) return entry.noFeed.reason === null ? '미급여' : `미급여 (${entry.noFeed.reason})`;
  if (entry.meal === null) return '';
  return baseText(entry.meal);
}

function baseText(meal: BoardMeal): string {
  const parts = [meal.menuName ?? '베이스 없음'];
  if (meal.watchedBaseIngredients.length > 0) {
    parts.push(`(${meal.watchedBaseIngredients.map(ingredientText).join(', ')})`);
  }
  if (meal.memo !== null) parts.push(meal.memo);
  if (meal.corrected) parts.push('(수정)');
  return parts.join(' ');
}

function toppingCell(entry: BoardSlotEntry | null, index: number): string {
  const topping = entry?.meal?.toppings[index];
  return topping === undefined ? '' : ingredientText(topping);
}

function ingredientText(ingredient: BoardIngredient): string {
  const marks = [
    ingredient.exposureNumber === null ? null : (CIRCLED[ingredient.exposureNumber - 1] ?? `${ingredient.exposureNumber}회`),
    ingredient.reacted ? REACTED_MARK : null,
  ].filter((mark) => mark !== null);
  return marks.length === 0 ? ingredient.name : `${ingredient.name} ${marks.join('')}`;
}
