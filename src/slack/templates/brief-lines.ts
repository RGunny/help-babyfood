import { BriefAttention, BriefExpiryAlert, BriefStockRow, DailyBrief } from '../../application/daily-brief.js';
import { SLOT_LABEL, RULE_WARNING_LABEL, stageLabel } from './labels.js';

/**
 * The lines and rows the brief and the board share, with no markup of their own.
 *
 * `escape` is the caller's: mrkdwn and canvas markdown reserve different characters, and a name
 * escaped for one breaks in the other.
 */
export type Escape = (text: string) => string;

/** A stock row with the threshold it reached, if it did. */
export interface IngredientRow extends BriefStockRow {
  readonly thresholdCubes: number | null;
}

export interface StockRows {
  /** Rows to put in the table, most urgent first. */
  readonly shown: readonly IngredientRow[];
  /** Ingredients with nothing in the freezer and no threshold, named on one line under the table. */
  readonly empty: readonly IngredientRow[];
}

/**
 * An ingredient that reached its threshold stays in the table even at zero: that is the one row
 * the threshold column exists for.
 */
export function stockRowsOf(brief: DailyBrief): StockRows {
  const thresholds = new Map(brief.thresholdAlerts.map((alert) => [alert.ingredientId, alert.thresholdCubes]));
  const rows = brief.stock.map((row) => ({ ...row, thresholdCubes: thresholds.get(row.ingredientId) ?? null }));
  const isEmpty = (row: IngredientRow): boolean => row.total === 0 && row.thresholdCubes === null;
  return {
    shown: rows.filter((row) => !isEmpty(row)).toSorted(byUrgency),
    empty: rows.filter(isEmpty),
  };
}

/**
 * Soonest to run out first, then those that reached their threshold, then those with batches
 * waiting to be thrown away. Within a group the order of `brief.stock` is kept.
 */
export function byUrgency(a: IngredientRow, b: IngredientRow): number {
  if (a.depletionDate !== b.depletionDate) {
    if (a.depletionDate === null) return 1;
    if (b.depletionDate === null) return -1;
    return a.depletionDate.localeCompare(b.depletionDate);
  }
  const threshold = Number(b.thresholdCubes !== null) - Number(a.thresholdCubes !== null);
  if (threshold !== 0) return threshold;
  return Number(b.overdue > 0) - Number(a.overdue > 0);
}

export function expiryLine(alert: BriefExpiryAlert, escape: Escape): string {
  return `${escape(alert.name)} ${alert.cookedOn} 조리분 ${alert.remaining}개 · 기한 ${alert.expiryDate} · ${stageLabel(alert.stage)}`;
}

export function attentionLines(attention: BriefAttention, escape: Escape): string[] {
  return [
    ...attention.heldDeductions.map(
      (held) =>
        `재고 부족으로 보류된 차감: ${escape(held.name)} ${held.cubes}개 (${held.date}${held.slot === null ? '' : ` ${SLOT_LABEL[held.slot]}`})`,
    ),
    ...attention.unrecordedReactions.map(
      (entry) => `반응 미기록: ${escape(entry.name)} (${entry.date} ${SLOT_LABEL[entry.slot]})`,
    ),
    ...attention.ruleWarnings.map(
      (warning) =>
        `${RULE_WARNING_LABEL[warning.code]}: ${warning.ingredientNames.map(escape).join(', ')} (${warning.date}${warning.slot === null ? '' : ` ${SLOT_LABEL[warning.slot]}`})`,
    ),
    ...attention.weightMismatchedBatches.map(
      (batch) =>
        `중량 불일치: ${escape(batch.name)} ${batch.cookedOn} 조리분 ${batch.remaining}개 (큐브 ${batch.cubeWeightGram}g, 1회분 ${batch.servingWeightGram}g)`,
    ),
    ...(attention.planRunwayShort
      ? [attention.planRunwayDays === null ? '등록된 식단이 없습니다' : `식단이 ${attention.planRunwayDays}일 남았습니다`]
      : []),
  ];
}
