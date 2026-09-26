import type {
  ActionsBlock,
  Button,
  ContextBlock,
  DividerBlock,
  HeaderBlock,
  KnownBlock,
  SectionBlock,
  TableBlock,
} from '@slack/types';
import type { NumberTableBlock } from './table.js';

/**
 * A block this server sends. `@slack/types` 3.1.0 types table cells as `raw_text` or `rich_text`
 * only, so its `TableBlock` is swapped for the one `table.ts` builds, which also carries
 * `raw_number` cells.
 */
export type SlackBlock = Exclude<KnownBlock, TableBlock> | NumberTableBlock;

/** What `chat.postMessage` takes besides the channel. `text` is the one line a notification shows. */
export interface SlackMessage {
  readonly text: string;
  readonly blocks: SlackBlock[];
}

// Slack이 이 값을 넘는 메시지를 통째로 거부한다. 넘기는 대신 잘라 낸다. 브리프 하나가 가지
// 않는 것이 재고 몇 줄이 빠지는 것보다 나쁘다.
// 출처: docs.slack.dev/reference/block-kit/blocks, .../blocks/section-block, .../blocks/actions-block,
// .../blocks/header-block, .../block-elements/button-element
export const MAX_BLOCKS = 50;
export const MAX_SECTION_TEXT = 3000;
export const MAX_ACTION_ELEMENTS = 25;
export const MAX_BUTTON_TEXT = 75;
export const MAX_HEADER_TEXT = 150;

export function header(text: string): HeaderBlock {
  return { type: 'header', text: { type: 'plain_text', text: truncate(text, MAX_HEADER_TEXT) } };
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

export function context(text: string): ContextBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text: truncate(text, MAX_SECTION_TEXT) }] };
}

export function divider(): DividerBlock {
  return { type: 'divider' };
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

/** mrkdwn gives `&`, `<` and `>` a meaning, so a name holding one would break the line around it. */
export function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
