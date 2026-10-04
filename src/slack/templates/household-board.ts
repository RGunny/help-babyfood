import { DailyBrief } from '../../application/daily-brief.js';
import { HouseholdBoard } from '../../application/household-board.js';
import { IngredientRow, attentionLines, isExpiryHighlighted, pantryLine, stockRowsOf } from './brief-lines.js';
import { GridBlock, calendarGridOf, todayHeader } from './calendar-grid.js';
import { CanvasTemplate } from './canvas-template.js';
import { shortDate } from './labels.js';
import { MAX_TABLE_CELLS, escapeMarkdown, heading, markdownList, markdownTable } from './markdown.js';

const STOCK_HEADER = ['재료', '합계', '가용', '임계 지남', '임계일', '소진 예상', '임계'];
/** Rows the stock table can hold under the cell limit, header included. */
const MAX_STOCK_ROWS = Math.floor(MAX_TABLE_CELLS / STOCK_HEADER.length) - 1;

/**
 * The board of ADR 0008 as canvas markdown: the calendar in the spreadsheet's layout, one table a
 * week, then the same stock table and attention list the brief carries.
 *
 * Every part is one function returning its lines, joined in reading order. Cell texts come from
 * `calendarGridOf` already marked up with ①, ⚠ and ▶; what this file adds is markdown and the
 * stock table's ⏰.
 */
export const householdBoardTemplate: CanvasTemplate<HouseholdBoard> = {
  key: 'household_board',
  version: 4,
  render(board) {
    const parts = [
      titleLines(board),
      calendarLines(board),
      stockLines(board.brief),
      attentionSection(board.brief),
    ];
    return `${parts.map((lines) => lines.join('\n')).join('\n\n')}\n`;
  },
};

/**
 * The canvas title is the name; the body opens with the update line. A body H1 saying the same thing
 * showed under the title as a second "이유식 상태판" in the mobile app (2026-10-04).
 */
function titleLines(board: HouseholdBoard): string[] {
  const { now, brief } = board;
  const today = brief.dayNumber === null ? '오늘은 급여일이 아닙니다' : `오늘 ${brief.dayNumber}일차`;
  return [`_${now.date} ${now.time} 갱신 · ${today}_`];
}

function calendarLines(board: HouseholdBoard): string[] {
  const lines = [heading(2, '식단')];
  const grid = calendarGridOf(board);
  if (grid.blocks.length === 0) return [...lines, '등록된 끼니가 없습니다.'];

  if (grid.omittedBlocks > 0) lines.push(`_지난 ${grid.omittedBlocks}주는 생략했습니다._`);
  for (const block of grid.blocks) {
    const first = board.blocks.find((candidate) => candidate.number === block.number)!.days;
    lines.push('', heading(3, `${block.number}주차 · ${shortDate(first[0].date)} ~ ${shortDate(first.at(-1)!.date)}`), blockTable(block));
    if (block.omittedToppings > 0) lines.push(`_토핑 ${block.omittedToppings}개는 표에 넣지 못했습니다._`);
  }
  return lines;
}

/** Today's column is bold in the header and carries the mark; the rest is the grid as it is. */
function blockTable(block: GridBlock): string {
  const header = block.header.map((cell, index) =>
    index === block.todayColumn ? `**${escapeMarkdown(todayHeader(cell))}**` : escapeMarkdown(cell),
  );
  return markdownTable(
    header,
    block.rows.map((row) => row.map(escapeMarkdown)),
  );
}

function stockLines(brief: DailyBrief): string[] {
  const lines = [heading(2, '재고')];
  const { shown, empty } = stockRowsOf(brief);
  if (shown.length === 0) lines.push('재고가 없습니다.');
  else {
    lines.push(markdownTable(STOCK_HEADER, shown.slice(0, MAX_STOCK_ROWS).map(stockRow)));
    const omitted = shown.length - MAX_STOCK_ROWS;
    if (omitted > 0) lines.push(`_…외 ${omitted}개 재료는 표에서 생략했습니다._`);
  }
  if (empty.length > 0) lines.push(`_재고 0: ${empty.map((row) => escapeMarkdown(row.name)).join(', ')}_`);
  const pantry = pantryLine(brief, escapeMarkdown);
  if (pantry !== null) lines.push(`_${pantry}_`);
  return lines;
}

/** A canvas cell has no colour, so a row near or past its expiry date is marked in its name (ADR 0009). */
function stockRow(row: IngredientRow): string[] {
  return [
    isExpiryHighlighted(row) ? `**⏰ ${escapeMarkdown(row.name)}**` : escapeMarkdown(row.name),
    String(row.total),
    String(row.fresh),
    String(row.overdue),
    row.nextExpiry === null ? '–' : shortDate(row.nextExpiry.date),
    row.depletionDate === null ? '–' : shortDate(row.depletionDate),
    row.thresholdCubes === null ? '–' : String(row.thresholdCubes),
  ];
}

function attentionSection(brief: DailyBrief): string[] {
  const lines = attentionLines(brief.attention, escapeMarkdown);
  return [heading(2, '확인 필요'), lines.length === 0 ? '없습니다.' : markdownList(lines)];
}
