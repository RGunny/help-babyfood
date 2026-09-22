import { randomUUID } from 'node:crypto';
import type { ActionsBlock, Button } from '@slack/types';
import { localDate } from '../../domain/shared/local-date.js';
import { decodeAction } from '../actions.js';
import { renderReactionPrompt } from './render-reaction-prompt.js';

const DATE = localDate('2026-09-22');

describe('후속 메시지 렌더링', () => {
  const ingredients = [
    { ingredientId: randomUUID(), name: '완두콩', exposureNumber: 1 },
    { ingredientId: randomUUID(), name: '달걀노른자', exposureNumber: 3 },
  ];
  const message = renderReactionPrompt({ date: DATE, slot: 'morning', ingredients });
  const actionBlocks = message.blocks.filter((block): block is ActionsBlock => block.type === 'actions');

  it('재료마다 이상 없음과 반응 있음 버튼이 둘이다', () => {
    expect(actionBlocks.map((block) => (block.elements as Button[]).map((button) => button.text.text))).toEqual([
      ['완두콩 이상 없음', '완두콩 반응 있음'],
      ['달걀노른자 이상 없음', '달걀노른자 반응 있음'],
    ]);
  });

  it('버튼 값은 그 끼니와 재료와 결과로 되읽힌다', () => {
    const decoded = actionBlocks.flatMap((block) =>
      (block.elements as Button[]).map((button) => decodeAction(button.action_id!, button.value!)),
    );
    expect(decoded).toEqual(
      ingredients.flatMap(({ ingredientId }) => [
        { kind: 'reaction', date: DATE, slot: 'morning', ingredientId, result: 'clear' },
        { kind: 'reaction', date: DATE, slot: 'morning', ingredientId, result: 'reacted' },
      ]),
    );
  });

  it('알림 한 줄에 날짜와 끼니가 실린다', () => {
    expect(message.text).toBe('2026-09-22 오전 새 재료 반응 기록');
  });
});
