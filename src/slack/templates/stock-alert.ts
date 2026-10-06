import { BriefStockAlertItem } from '../../application/daily-brief.js';
import { StockAlertMessage } from '../../application/ports/brief-delivery.port.js';
import { LocalDate } from '../../domain/shared/local-date.js';
import { MAX_BLOCKS, SlackBlock, context, escape, header, section } from './blocks.js';
import { shortDate, weekdayLabel } from './labels.js';
import { MessageTemplate } from './message-template.js';
import { TableColumn, table } from './table.js';

const cookColumns = (horizonDays: number): readonly TableColumn<BriefStockAlertItem>[] => [
  // raw_text 셀은 굵게가 없어서 기호만 붙인다(ADR 0009).
  { header: '재료', wrapped: true, cell: (item) => (item.urgency === 'urgent' ? `🚨 ${item.name}` : item.name) },
  { header: '부족 시작', cell: when },
  { header: '재고', align: 'right', cell: (item) => item.total },
  { header: `${horizonDays}일 부족`, align: 'right', cell: (item) => item.horizonShortfallCubes },
];

const LOW_STOCK_COLUMNS: readonly TableColumn<BriefStockAlertItem>[] = [
  { header: '재료', wrapped: true, cell: (item) => item.name },
  { header: '부족 시작', cell: (item) => (item.firstShortageDate === null ? null : dated(item.firstShortageDate)) },
  { header: '재고', align: 'right', cell: (item) => item.total },
];

/**
 * The stock alert of ADR 0010: the ingredients to cook, sent beside the brief.
 *
 * The application has already sorted the items by first shortage and marked how urgent each is, so
 * this only lays them out: one table of what to cook within the horizon, one of what is merely at
 * its threshold. Expiry dates stay in the brief's table (ADR 0009), and there is no button: cooking
 * is recorded by registering the batch.
 */
export const stockAlertTemplate: MessageTemplate<StockAlertMessage> = {
  key: 'stock_alert',
  version: 2,
  render({ alert }) {
    const toCook = alert.items.filter((item) => item.urgency !== 'low_stock');
    const lowStock = alert.items.filter((item) => item.urgency === 'low_stock');

    const blocks: SlackBlock[] = [
      header(
        toCook.length > 0 ? `재고 알람 · 조리 필요 ${toCook.length}건` : `재고 알람 · 임계개수 이하 ${lowStock.length}건`,
      ),
      ...tableBlocks('조리 필요', cookColumns(alert.horizonDays), toCook),
      ...tableBlocks(`임계개수 이하 · ${alert.horizonDays}일 안에는 부족 없음`, LOW_STOCK_COLUMNS, lowStock),
      context('조리해 입고를 등록하면 다음 알람에서 빠집니다.'),
    ];

    return { text: notificationLine(alert.items, lowStock.length), blocks: blocks.slice(0, MAX_BLOCKS) };
  },
};

/** One titled table, or nothing for an empty group. Rows cut to fit the table are counted under it. */
function tableBlocks(
  title: string,
  columns: readonly TableColumn<BriefStockAlertItem>[],
  items: readonly BriefStockAlertItem[],
): SlackBlock[] {
  if (items.length === 0) return [];

  const { block, omitted } = table(columns, items);
  const blocks: SlackBlock[] = [section(`*${title}*`), block];
  if (omitted > 0) blocks.push(context(`…외 ${omitted}개 재료는 표에서 생략했습니다.`));
  return blocks;
}

/** When the first meal goes short, as `10-08 목 · D-2`, from the day count the application gave. */
function when(item: BriefStockAlertItem): string {
  const days = item.daysUntilShortage!;
  return `${dated(item.firstShortageDate!)} · ${daysLabel(days)}`;
}

function daysLabel(days: number): string {
  if (days < 0) return '지남';
  if (days === 0) return '오늘';
  if (days === 1) return '내일';
  return `D-${days}`;
}

/** `2026-10-08` as `10-08 목`. The weekday is what a parent plans the cooking by. */
function dated(date: LocalDate): string {
  return `${shortDate(date)} ${weekdayLabel(date)}`;
}

function shortWhen(item: BriefStockAlertItem): string {
  const days = item.daysUntilShortage!;
  if (days < 0) return '이미 부족';
  if (days === 0) return '오늘부터 부족';
  if (days === 1) return '내일부터 부족';
  return `${shortDate(item.firstShortageDate!)}부터 부족`;
}

/** The one line a push notification shows: the first item and how many more there are. */
function notificationLine(items: readonly BriefStockAlertItem[], lowStockCount: number): string {
  const [first] = items;
  if (first === undefined || first.urgency === 'low_stock') return `재고 알람: 임계개수 이하 ${lowStockCount}건`;
  const rest = items.length > 1 ? ` 외 ${items.length - 1}건` : '';
  return `재고 알람: ${escape(first.name)} ${shortWhen(first)}${rest}`;
}
