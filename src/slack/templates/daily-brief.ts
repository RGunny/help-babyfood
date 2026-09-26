import {
  BriefAttention,
  BriefExpiryAlert,
  BriefNewIngredient,
  BriefSlot,
  BriefStockRow,
  DailyBrief,
} from '../../application/daily-brief.js';
import { actionId, encodeDiscard, encodeNoFeed } from '../actions.js';
import {
  MAX_ACTION_ELEMENTS,
  MAX_BLOCKS,
  MAX_SECTION_TEXT,
  SlackBlock,
  actions,
  button,
  context,
  divider,
  escape,
  header,
  linesSection,
  section,
  truncate,
} from './blocks.js';
import { RULE_WARNING_LABEL, SLOT_LABEL, shortDate, stageLabel } from './labels.js';
import { MessageTemplate } from './message-template.js';
import { TableColumn, table } from './table.js';

/** A stock row with the threshold it reached, if it did. */
interface IngredientRow extends BriefStockRow {
  readonly thresholdCubes: number | null;
}

const STOCK_COLUMNS: readonly TableColumn<IngredientRow>[] = [
  { header: '재료', wrapped: true, cell: (row) => row.name },
  { header: '합계', align: 'right', cell: (row) => row.total },
  { header: '가용', align: 'right', cell: (row) => row.fresh },
  { header: '폐기대기', align: 'right', cell: (row) => row.pendingDiscard },
  {
    header: '소진 예상',
    align: 'center',
    cell: (row) => (row.depletionDate === null ? null : shortDate(row.depletionDate)),
  },
  { header: '임계', align: 'right', cell: (row) => row.thresholdCubes },
];

/**
 * Chapter 5 of the plan as a Slack message.
 *
 * Every part of the brief is one function returning its blocks, joined in reading order. Adding a
 * part is one more line in the list. Stock and threshold are one table keyed by ingredient; the
 * shortage forecast is left to MCP, since the depletion date already says when an ingredient
 * runs out (ADR 0007).
 */
export const dailyBriefTemplate: MessageTemplate<DailyBrief> = {
  key: 'daily_brief',
  version: 2,
  render(brief) {
    const dayPart = brief.dayNumber === null ? '' : ` · ${brief.dayNumber}일차`;
    const title = `${brief.date} 이유식 브리프${dayPart}`;
    const blocks: SlackBlock[] = [
      header(title),
      ...slotBlocks(brief),
      ...newIngredientBlocks(brief.newIngredients),
      divider(),
      ...stockBlocks(brief),
      ...expiryBlocks(brief.expiryAlerts),
      ...attentionBlocks(brief.attention),
    ];
    return { text: title, blocks: blocks.slice(0, MAX_BLOCKS) };
  },
};

function slotBlocks(brief: DailyBrief): SlackBlock[] {
  if (brief.slots.length === 0) return [section('오늘 시작된 끼니가 없습니다.')];

  return brief.slots.flatMap((slot) => {
    const line = section(slotLine(slot));
    // 식단이 놓인 끼니에만 미급여 버튼을 단다. 이미 미급여로 기록됐거나 식단이 없는 끼니에는
    // 누를 것이 없다.
    if (slot.meal === null || slot.noFeed !== null) return [line];
    return [
      line,
      actions([
        button(
          actionId('no_feed', 0),
          `${SLOT_LABEL[slot.slot]} 미급여(해동 전)`,
          encodeNoFeed(brief.date, slot.slot, false),
        ),
        button(
          actionId('no_feed', 1),
          `${SLOT_LABEL[slot.slot]} 미급여(해동 후)`,
          encodeNoFeed(brief.date, slot.slot, true),
        ),
      ]),
    ];
  });
}

function slotLine(slot: BriefSlot): string {
  const head = `*${SLOT_LABEL[slot.slot]}* ${slot.mealTime}`;
  if (slot.noFeed !== null) {
    const reason = slot.noFeed.reason === null ? '' : `, ${escape(slot.noFeed.reason)}`;
    return `${head}  미급여 기록됨(${slot.noFeed.thawed ? '해동 후' : '해동 전'}${reason})`;
  }
  if (slot.meal === null) return `${head}  식단 없음`;

  const { meal } = slot;
  const names = [meal.menuName, ...meal.toppingNames].filter((name): name is string => name !== null);
  const flags = [meal.fed ? '급여 완료' : null, meal.corrected ? '실제 급여로 수정됨' : null].filter(
    (flag) => flag !== null,
  );
  const memo = meal.memo === null ? '' : `\n메모: ${escape(meal.memo)}`;
  return truncate(
    `${head}  ${names.map(escape).join(' + ') || '구성 없음'}${flags.length > 0 ? ` (${flags.join(', ')})` : ''}${memo}`,
    MAX_SECTION_TEXT,
  );
}

/** One line per slot and exposure: `• 오전 1회차: 쌀, 오트밀, 소고기`. */
function newIngredientBlocks(entries: readonly BriefNewIngredient[]): SlackBlock[] {
  if (entries.length === 0) return [];

  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    const key = `${SLOT_LABEL[entry.slot]} ${entry.exposureNumber}회차`;
    groups.set(key, [...(groups.get(key) ?? []), escape(entry.name)]);
  }
  return [
    linesSection(
      '새 재료 관찰 · 급여 후 반응을 관찰하세요',
      [...groups].map(([key, names]) => `• ${key}: ${names.join(', ')}`),
    ),
  ];
}

/**
 * The stock table, with the rows that have nothing in them named on one line underneath.
 *
 * An ingredient that reached its threshold stays in the table even at zero: that is the one
 * row the threshold column exists for.
 */
function stockBlocks(brief: DailyBrief): SlackBlock[] {
  const thresholds = new Map(brief.thresholdAlerts.map((alert) => [alert.ingredientId, alert.thresholdCubes]));
  const rows = brief.stock.map((row) => ({ ...row, thresholdCubes: thresholds.get(row.ingredientId) ?? null }));
  const isEmpty = (row: IngredientRow): boolean => row.total === 0 && row.thresholdCubes === null;
  const shown = rows.filter((row) => !isEmpty(row)).toSorted(byUrgency);
  const empty = rows.filter(isEmpty);
  const emptyNote = empty.length > 0 ? `재고 0: ${empty.map((row) => escape(row.name)).join(', ')}` : null;

  if (shown.length === 0) return [section('*재고현황*\n재고가 없습니다.'), ...notes([emptyNote])];

  const { block, omitted } = table(STOCK_COLUMNS, shown);
  const omittedNote = omitted > 0 ? `…외 ${omitted}개 재료는 표에서 생략했습니다.` : null;
  return [section('*재고현황*'), block, ...notes([omittedNote, emptyNote])];
}

/** The lines under the table, as one context block, or nothing when there is nothing to say. */
function notes(lines: readonly (string | null)[]): SlackBlock[] {
  const kept = lines.filter((line) => line !== null);
  return kept.length > 0 ? [context(kept.join('\n'))] : [];
}

/**
 * Soonest to run out first, then those that reached their threshold, then those with batches
 * waiting to be thrown away. Within a group the order of `brief.stock` is kept.
 */
function byUrgency(a: IngredientRow, b: IngredientRow): number {
  if (a.depletionDate !== b.depletionDate) {
    if (a.depletionDate === null) return 1;
    if (b.depletionDate === null) return -1;
    return a.depletionDate.localeCompare(b.depletionDate);
  }
  const threshold = Number(b.thresholdCubes !== null) - Number(a.thresholdCubes !== null);
  if (threshold !== 0) return threshold;
  return Number(b.pendingDiscard > 0) - Number(a.pendingDiscard > 0);
}

function expiryBlocks(alerts: readonly BriefExpiryAlert[]): SlackBlock[] {
  if (alerts.length === 0) return [];
  return [linesSection('임계일 알람', alerts.map(expiryLine)), ...discardButtons(alerts)];
}

function expiryLine(alert: BriefExpiryAlert): string {
  return `• ${escape(alert.name)} ${alert.cookedOn} 조리분 ${alert.remaining}개 · 기한 ${alert.expiryDate} · ${stageLabel(alert.stage)}`;
}

/**
 * One "폐기 완료" button per batch waiting to be thrown away, oldest first.
 *
 * An actions block holds 25 elements. Past that the oldest 25 get a button and the rest are named
 * in a line underneath: the oldest are the ones most overdue, and a second block would only move
 * the limit to the block count.
 */
function discardButtons(alerts: readonly BriefExpiryAlert[]): SlackBlock[] {
  const pending = alerts
    .filter((alert) => alert.stage.kind === 'pending_discard')
    .toSorted((a, b) => a.cookedOn.localeCompare(b.cookedOn));
  if (pending.length === 0) return [];

  const shown = pending.slice(0, MAX_ACTION_ELEMENTS);
  const blocks: SlackBlock[] = [
    actions(
      shown.map((alert, index) =>
        button(actionId('discard', index), `폐기 완료: ${alert.name} ${alert.cookedOn}`, encodeDiscard(alert.batchId)),
      ),
    ),
  ];
  const rest = pending.length - shown.length;
  if (rest > 0) {
    blocks.push(context(`폐기 대기 배치가 ${rest}개 더 있습니다. 위 배치를 처리하면 다음 브리프에 버튼이 붙습니다.`));
  }
  return blocks;
}

function attentionBlocks(attention: BriefAttention): SlackBlock[] {
  const lines = attentionLines(attention);
  return lines.length > 0 ? [linesSection('확인 필요', lines)] : [];
}

function attentionLines(attention: BriefAttention): string[] {
  return [
    ...attention.heldDeductions.map(
      (held) =>
        `• 재고 부족으로 보류된 차감: ${escape(held.name)} ${held.cubes}개 (${held.date}${held.slot === null ? '' : ` ${SLOT_LABEL[held.slot]}`})`,
    ),
    ...attention.unrecordedReactions.map(
      (entry) => `• 반응 미기록: ${escape(entry.name)} (${entry.date} ${SLOT_LABEL[entry.slot]})`,
    ),
    ...attention.ruleWarnings.map(
      (warning) =>
        `• ${RULE_WARNING_LABEL[warning.code]}: ${warning.ingredientNames.map(escape).join(', ')} (${warning.date}${warning.slot === null ? '' : ` ${SLOT_LABEL[warning.slot]}`})`,
    ),
    ...attention.weightMismatchedBatches.map(
      (batch) =>
        `• 중량 불일치: ${escape(batch.name)} ${batch.cookedOn} 조리분 ${batch.remaining}개 (큐브 ${batch.cubeWeightGram}g, 1회분 ${batch.servingWeightGram}g)`,
    ),
    ...(attention.planRunwayShort
      ? [
          attention.planRunwayDays === null
            ? '• 등록된 식단이 없습니다'
            : `• 식단이 ${attention.planRunwayDays}일 남았습니다`,
        ]
      : []),
  ];
}
