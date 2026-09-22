import { localDate } from '../domain/shared/local-date.js';
import { actionId, decodeAction, encodeDiscard, encodeNoFeed, encodeReaction } from './actions.js';

const DATE = localDate('2026-09-22');
const INGREDIENT_ID = '3f1c2a4e-7b8d-4c9e-a1f2-0123456789ab';
const BATCH_ID = '9a8b7c6d-5e4f-4a3b-8c2d-fedcba987654';

describe('버튼 값 인코딩', () => {
  it.each([true, false])('미급여 버튼(해동 %s)의 값은 인코딩과 디코딩을 왕복한다', (thawed) => {
    expect(decodeAction(actionId('no_feed', 0), encodeNoFeed(DATE, 'afternoon', thawed))).toEqual({
      kind: 'no_feed',
      date: DATE,
      slot: 'afternoon',
      thawed,
    });
  });

  it.each(['clear', 'reacted'] as const)('반응 버튼(%s)의 값은 인코딩과 디코딩을 왕복한다', (result) => {
    expect(decodeAction(actionId('reaction', 1), encodeReaction(DATE, 'morning', INGREDIENT_ID, result))).toEqual({
      kind: 'reaction',
      date: DATE,
      slot: 'morning',
      ingredientId: INGREDIENT_ID,
      result,
    });
  });

  it('폐기 버튼의 값은 인코딩과 디코딩을 왕복한다', () => {
    expect(decodeAction(actionId('discard', 24), encodeDiscard(BATCH_ID))).toEqual({
      kind: 'discard',
      batchId: BATCH_ID,
    });
  });

  it('action_id의 블록 안 순번은 버튼의 뜻에 영향을 주지 않는다', () => {
    const value = encodeDiscard(BATCH_ID);
    expect(decodeAction('discard', value)).toEqual(decodeAction(actionId('discard', 7), value));
  });

  it('같은 블록의 버튼은 순번이 달라 action_id가 겹치지 않는다', () => {
    expect(actionId('no_feed', 0)).not.toBe(actionId('no_feed', 1));
  });

  it('모르는 action_id는 null이다', () => {
    expect(decodeAction('cook', encodeDiscard(BATCH_ID))).toBeNull();
    expect(decodeAction('', '')).toBeNull();
  });

  it.each([
    ['no_feed', ''],
    ['no_feed', '2026-09-22|morning'],
    ['no_feed', '2026-09-22|evening|thawed'],
    ['no_feed', '2026/09/22|morning|thawed'],
    ['no_feed', '2026-09-22|morning|maybe'],
    ['no_feed', '2026-09-22|morning|thawed|extra'],
    ['reaction', `2026-09-22|morning|not-a-uuid|clear`],
    ['reaction', `2026-09-22|morning|${INGREDIENT_ID}|fine`],
    ['reaction', `2026-09-22|night|${INGREDIENT_ID}|clear`],
    ['reaction', `xx|morning|${INGREDIENT_ID}|clear`],
    ['discard', 'not-a-uuid'],
    ['discard', `${BATCH_ID}|${BATCH_ID}`],
  ])('형식이 깨진 값은 던지지 않고 null이다 (%s: "%s")', (id, value) => {
    expect(() => decodeAction(id, value)).not.toThrow();
    expect(decodeAction(id, value)).toBeNull();
  });
});
