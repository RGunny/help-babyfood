import type { ActionsBlock, Button, ContextBlock, KnownBlock, SectionBlock } from '@slack/types';
import {
  BriefAttention,
  BriefExpiryAlert,
  BriefSlot,
  BriefStockRow,
  DailyBrief,
} from '../../application/daily-brief.js';
import { RuleWarningCode } from '../../domain/rules/meal-rules.js';
import { MealSlot } from '../../domain/shared/meal-slot.js';
import { ExpiryStage } from '../../domain/stock/expiry.js';
import { actionId, encodeDiscard, encodeNoFeed } from '../actions.js';

/** What `chat.postMessage` takes besides the channel. `text` is the one line a notification shows. */
export interface SlackMessage {
  readonly text: string;
  readonly blocks: KnownBlock[];
}

// Slack이 이 값을 넘는 메시지를 통째로 거부한다. 넘기는 대신 잘라 낸다. 브리프 하나가 가지
// 않는 것이 재고 몇 줄이 빠지는 것보다 나쁘다.
// 출처: docs.slack.dev/reference/block-kit/blocks, .../blocks/section-block, .../blocks/actions-block,
// .../block-elements/button-element
export const MAX_BLOCKS = 50;
export const MAX_SECTION_TEXT = 3000;
export const MAX_ACTION_ELEMENTS = 25;
export const MAX_BUTTON_TEXT = 75;

export const SLOT_LABEL: Record<MealSlot, string> = { morning: '오전', afternoon: '오후' };

const RULE_WARNING_LABEL: Record<RuleWarningCode, string> = {
  FORBIDDEN_PAIRING: '금지 조합',
  TOO_MANY_FIRST_INTRODUCTIONS: '하루 첫 도입 재료가 너무 많음',
  FIRST_INTRODUCTION_IN_WRONG_SLOT: '첫 도입이 오전 끼니가 아님',
  REACTED_INGREDIENT_PLANNED: '반응 있었던 재료가 식단에 있음',
};

/**
 * Chapter 5 of the plan as a Slack message. Pure: it knows neither the network nor the store.
 *
 * Every part of the brief gets a section of its own, joined as lines, so that the block count
 * stays fixed however many ingredients there are. Only the text inside a section grows, and
 * `linesSection` cuts it at the section limit and says how many lines it left out.
 */
export function renderBrief(brief: DailyBrief): SlackMessage {
  const dayPart = brief.dayNumber === null ? '' : ` · ${brief.dayNumber}일차`;
  const blocks: KnownBlock[] = [section(`*${brief.date} 이유식 브리프*${dayPart}`)];

  for (const slot of brief.slots) {
    blocks.push(section(slotLine(slot)));
    // 식단이 놓인 끼니에만 미급여 버튼을 단다. 이미 미급여로 기록됐거나 식단이 없는 끼니에는
    // 누를 것이 없다.
    if (slot.meal !== null && slot.noFeed === null) {
      blocks.push(
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
      );
    }
  }
  if (brief.slots.length === 0) blocks.push(section('오늘 시작된 끼니가 없습니다.'));

  if (brief.newIngredients.length > 0) {
    blocks.push(
      linesSection(
        '새 재료 관찰',
        brief.newIngredients.map(
          (entry) =>
            `• ${escape(entry.name)} (${SLOT_LABEL[entry.slot]}, ${entry.exposureNumber}회차) 급여 후 반응을 관찰하세요`,
        ),
      ),
    );
  }

  blocks.push(linesSection('재고현황', brief.stock.map(stockLine), '재고가 없습니다.'));

  if (brief.shortages.length > 0) {
    blocks.push(
      linesSection(
        '부족 예측',
        brief.shortages.map(
          (shortage) =>
            `• ${escape(shortage.name)}: ${shortage.firstShortageDate}부터 ${shortage.shortfallCubes}개 부족 (식단 소요 ${shortage.plannedCubes}개)`,
        ),
      ),
    );
  }

  if (brief.thresholdAlerts.length > 0) {
    blocks.push(
      linesSection(
        '임계개수 도달',
        brief.thresholdAlerts.map(
          (alert) => `• ${escape(alert.name)} ${alert.total}개 (임계 ${alert.thresholdCubes}개)`,
        ),
      ),
    );
  }

  if (brief.expiryAlerts.length > 0) {
    blocks.push(linesSection('임계일 알람', brief.expiryAlerts.map(expiryLine)));
    blocks.push(...discardButtons(brief.expiryAlerts));
  }

  const attention = attentionLines(brief.attention);
  if (attention.length > 0) blocks.push(linesSection('확인 필요', attention));

  return { text: `${brief.date} 이유식 브리프${dayPart}`, blocks: blocks.slice(0, MAX_BLOCKS) };
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

function stockLine(row: BriefStockRow): string {
  const detail = [`가용 ${row.fresh}`, `폐기 대기 ${row.pendingDiscard}`];
  if (row.weightMismatched > 0) detail.push(`중량 불일치 ${row.weightMismatched}`);
  const depletion = row.depletionDate === null ? '' : ` · 소진 예상 ${row.depletionDate}`;
  return `• ${escape(row.name)} ${row.total}개 (${detail.join(', ')})${depletion}`;
}

function expiryLine(alert: BriefExpiryAlert): string {
  return `• ${escape(alert.name)} ${alert.cookedOn} 조리분 ${alert.remaining}개 · 기한 ${alert.expiryDate} · ${stageLabel(alert.stage)}`;
}

function stageLabel(stage: ExpiryStage): string {
  switch (stage.kind) {
    case 'fresh':
      return '기한 여유';
    case 'due_tomorrow':
      return '내일 기한';
    case 'due_today':
      return '오늘 기한';
    case 'pending_discard':
      return `기한 ${stage.overdueDays}일 초과, 폐기 대기`;
  }
}

/**
 * One "폐기 완료" button per batch waiting to be thrown away, oldest first.
 *
 * An actions block holds 25 elements. Past that the oldest 25 get a button and the rest are named
 * in a line underneath: the oldest are the ones most overdue, and a second block would only move
 * the limit to the block count.
 */
function discardButtons(alerts: readonly BriefExpiryAlert[]): KnownBlock[] {
  const pending = alerts
    .filter((alert) => alert.stage.kind === 'pending_discard')
    .toSorted((a, b) => a.cookedOn.localeCompare(b.cookedOn));
  if (pending.length === 0) return [];

  const shown = pending.slice(0, MAX_ACTION_ELEMENTS);
  const blocks: KnownBlock[] = [
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

/**
 * A titled list in one section, cut to fit the section limit.
 *
 * Whole lines are dropped from the end and the count of them is written in their place, so a cut
 * never ends mid-name and the parent knows the list is longer than what is shown.
 */
export function linesSection(title: string, lines: readonly string[], empty = '없습니다.'): SectionBlock {
  const head = `*${title}*`;
  if (lines.length === 0) return section(`${head}\n${empty}`);

  const kept: string[] = [];
  let length = head.length;
  for (const [index, line] of lines.entries()) {
    const remaining = lines.length - index - 1;
    // 이 줄을 넣은 뒤에도 뒤에 남는 줄이 있으면 생략 문구가 들어갈 자리를 남겨 둔다.
    const reserve = remaining > 0 ? omittedLine(remaining).length + 1 : 0;
    if (length + 1 + line.length + reserve > MAX_SECTION_TEXT) {
      const omitted = lines.length - kept.length;
      return section([head, ...kept, omittedLine(omitted)].join('\n'));
    }
    kept.push(line);
    length += 1 + line.length;
  }
  return section([head, ...kept].join('\n'));
}

function omittedLine(count: number): string {
  return `…외 ${count}줄 생략`;
}

export function section(text: string): SectionBlock {
  return { type: 'section', text: { type: 'mrkdwn', text: truncate(text, MAX_SECTION_TEXT) } };
}

export function actions(elements: Button[]): ActionsBlock {
  return { type: 'actions', elements: elements.slice(0, MAX_ACTION_ELEMENTS) };
}

export function button(id: string, label: string, value: string): Button {
  return {
    type: 'button',
    action_id: id,
    text: { type: 'plain_text', text: truncate(label, MAX_BUTTON_TEXT) },
    value,
  };
}

function context(text: string): ContextBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

/** mrkdwn gives `&`, `<` and `>` a meaning, so a name holding one would break the line around it. */
export function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
