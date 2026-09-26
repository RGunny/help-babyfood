/**
 * The little markdown a canvas needs: escaped text, a table, a list.
 *
 * Canvas markdown is documented by example only (https://docs.slack.dev/surfaces/canvases), so
 * this sticks to the constructs shown there: `|` tables with a `|--|` line, `-` lists, `**bold**`,
 * `_italic_` and `#` headings.
 */

// 출처: https://docs.slack.dev/surfaces/canvases . "Canvas tables have a limit of 300 cells per table".
export const MAX_TABLE_CELLS = 300;

/** A cell or list item never breaks the table or starts formatting of its own. */
export function escapeMarkdown(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('*', '\\*')
    .replaceAll('_', '\\_')
    .replaceAll('~', '\\~')
    .replaceAll('`', '\\`')
    .replaceAll(/\r?\n/g, ' ');
}

/** `header` is the first row. Every row is padded or cut to the header's width. */
export function markdownTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const width = header.length;
  const line = (cells: readonly string[]): string =>
    `| ${Array.from({ length: width }, (_, index) => cells[index] ?? '').join(' | ')} |`;
  return [line(header), `|${'--|'.repeat(width)}`, ...rows.map(line)].join('\n');
}

export function markdownList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

export function heading(level: 1 | 2 | 3, text: string): string {
  return `${'#'.repeat(level)} ${text}`;
}
