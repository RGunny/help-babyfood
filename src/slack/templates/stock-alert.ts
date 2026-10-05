import { BriefStockAlertItem } from '../../application/daily-brief.js';
import { StockAlertMessage } from '../../application/ports/brief-delivery.port.js';
import { MAX_BLOCKS, SlackBlock, context, escape, header, linesSection, section } from './blocks.js';
import { shortDate } from './labels.js';
import { MessageTemplate } from './message-template.js';

/**
 * The stock alert of ADR 0010: the ingredients to cook, sent beside the brief.
 *
 * The application has already sorted the items into urgency groups and counted the days to each
 * shortage, so this only words them. Expiry dates stay in the brief's table (ADR 0009), and there
 * is no button: cooking is recorded by registering the batch.
 */
export const stockAlertTemplate: MessageTemplate<StockAlertMessage> = {
  key: 'stock_alert',
  version: 1,
  render({ alert }) {
    const urgent = alert.items.filter((item) => item.urgency === 'urgent');
    const upcoming = alert.items.filter((item) => item.urgency === 'upcoming');
    const lowStock = alert.items.filter((item) => item.urgency === 'low_stock');
    const toCook = urgent.length + upcoming.length;
    const shortageLine = (item: BriefStockAlertItem): string =>
      `• ${escape(item.name)}  재고 ${item.total}개 · ${when(item)} · ${alert.horizonDays}일 안에 ${item.horizonShortfallCubes}개 부족`;

    const blocks: SlackBlock[] = [
      header(toCook > 0 ? `재고 알람 · 조리 필요 ${toCook}건` : `재고 알람 · 임계개수 이하 ${lowStock.length}건`),
    ];
    if (urgent.length > 0) blocks.push(linesSection('오늘·내일 부족', urgent.map(shortageLine)));
    if (upcoming.length > 0) blocks.push(linesSection(`${alert.horizonDays}일 안에 부족`, upcoming.map(shortageLine)));
    if (lowStock.length > 0) blocks.push(section(`*임계개수 이하*\n${lowStock.map(lowStockEntry).join(', ')}`));
    blocks.push(context('조리해 입고를 등록하면 다음 알람에서 빠집니다.'));

    return { text: notificationLine(alert.items, lowStock.length), blocks: blocks.slice(0, MAX_BLOCKS) };
  },
};

/** When the first meal goes short, from the day count the application gave. */
function when(item: BriefStockAlertItem): string {
  const days = item.daysUntilShortage!;
  const date = shortDate(item.firstShortageDate!);
  if (days < 0) return `${date}부터 이미 부족`;
  if (days === 0) return '오늘부터 부족';
  if (days === 1) return `내일(${date})부터 부족`;
  return `${date}부터(D-${days})`;
}

function shortWhen(item: BriefStockAlertItem): string {
  const days = item.daysUntilShortage!;
  if (days < 0) return '이미 부족';
  if (days === 0) return '오늘부터 부족';
  if (days === 1) return '내일부터 부족';
  return `${shortDate(item.firstShortageDate!)}부터 부족`;
}

function lowStockEntry(item: BriefStockAlertItem): string {
  const since = item.firstShortageDate === null ? '' : `(${shortDate(item.firstShortageDate)}부터)`;
  return `${escape(item.name)} ${item.total}개${since}`;
}

/** The one line a push notification shows: the first item and how many more there are. */
function notificationLine(items: readonly BriefStockAlertItem[], lowStockCount: number): string {
  const [first] = items;
  if (first === undefined || first.urgency === 'low_stock') return `재고 알람: 임계개수 이하 ${lowStockCount}건`;
  const rest = items.length > 1 ? ` 외 ${items.length - 1}건` : '';
  return `재고 알람: ${escape(first.name)} ${shortWhen(first)}${rest}`;
}
