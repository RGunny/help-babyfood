/**
 * A table cell. Slack's reference shows `raw_number` with `value` alone, and that is rejected with
 * `invalid_blocks` ("missing required field: text"); a string `value` is rejected too ("must
 * provide a number"). What Slack accepts, as posted to the channel on 2026-09-26, is a numeric
 * `value` and the `text` to show, together (ADR 0007). `numberCell` is the one place that builds it.
 */
export type TableCell =
  | { readonly type: 'raw_text'; readonly text: string }
  | { readonly type: 'raw_number'; readonly value: number; readonly text: string };

export interface NumberTableBlock {
  readonly type: 'table';
  readonly rows: TableCell[][];
  readonly column_settings?: { readonly align?: 'left' | 'center' | 'right'; readonly is_wrapped?: boolean }[];
}

/** What a column shows for a row. `null` is an empty cell, drawn as {@link EMPTY_CELL}. */
export type CellValue = string | number | null;

export interface TableColumn<Row> {
  readonly header: string;
  readonly align?: 'left' | 'center' | 'right';
  readonly wrapped?: boolean;
  readonly cell: (row: Row) => CellValue;
}

export interface TableResult {
  readonly block: NumberTableBlock;
  /** Rows left out to stay within the limits. The caller says so under the table. */
  readonly omitted: number;
}

// 출처: docs.slack.dev/reference/block-kit/blocks/table-block. 머리 행도 100행에 들어간다.
export const MAX_TABLE_ROWS = 100;
export const MAX_TABLE_CHARACTERS = 10_000;

// raw_text는 빈 문자열을 받지 않는다(최소 1자).
export const EMPTY_CELL = '–';

export function textCell(text: string): TableCell {
  return { type: 'raw_text', text: text === '' ? EMPTY_CELL : text };
}

export function numberCell(value: number): TableCell {
  return { type: 'raw_number', value, text: String(value) };
}

/**
 * Lays rows out under a header row, cut to Slack's limits.
 *
 * Rows are kept from the top while both the row count and the character count across every cell
 * fit, so the caller orders the rows by what matters most. The first row that does not fit ends
 * the table; the rest are counted, not skipped over, so no later row slips in out of order.
 */
export function table<Row>(columns: readonly TableColumn<Row>[], rows: readonly Row[]): TableResult {
  const head = columns.map((column) => textCell(column.header));
  const kept: TableCell[][] = [head];
  let characters = charactersOf(head);

  for (const row of rows) {
    const cells = columns.map((column) => toCell(column.cell(row)));
    const next = characters + charactersOf(cells);
    if (kept.length >= MAX_TABLE_ROWS || next > MAX_TABLE_CHARACTERS) break;
    kept.push(cells);
    characters = next;
  }

  return {
    block: {
      type: 'table',
      rows: kept,
      column_settings: columns.map((column) => ({
        align: column.align ?? 'left',
        is_wrapped: column.wrapped ?? false,
      })),
    },
    omitted: rows.length - (kept.length - 1),
  };
}

function toCell(value: CellValue): TableCell {
  if (value === null) return textCell(EMPTY_CELL);
  return typeof value === 'number' ? numberCell(value) : textCell(value);
}

function charactersOf(cells: readonly TableCell[]): number {
  return cells.reduce((sum, cell) => sum + cell.text.length, 0);
}
