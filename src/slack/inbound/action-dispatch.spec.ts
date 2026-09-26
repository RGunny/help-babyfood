import { Logger } from '@nestjs/common';
import { afterEach, vi } from 'vitest';
import { ApplicationError } from '../../application/errors.js';
import { HouseholdState } from '../../application/household-state.js';
import { HouseholdReader } from '../../application/ports/household-write.port.js';
import { DomainError } from '../../domain/errors.js';
import { localDate } from '../../domain/shared/local-date.js';
import { actionId, encodeDiscard, encodeNoFeed, encodeReaction } from '../actions.js';
import { PROCESSING_FAILED, UNKNOWN_BUTTON, UNKNOWN_INGREDIENT, UNKNOWN_SLACK_USER } from '../templates/button-reply.js';
import { ButtonTap, ButtonUseCases, SlackActionDispatcher, idempotencyKeyOf } from './action-dispatch.js';
import { SlackMember } from './slack-member.resolver.js';

const HOUSEHOLD_ID = 'household-1';
const MEMBER: SlackMember = { householdId: HOUSEHOLD_ID, actor: { kind: 'member', memberId: 'member-1' } };
const INGREDIENT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const BATCH_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const MESSAGE_TS = '1758493800.000100';
const RESPONSE_URL = 'https://hooks.slack.com/actions/T0/1/abc';

interface Fixture {
  readonly dispatcher: SlackActionDispatcher;
  readonly useCases: {
    noFeed: { register: ReturnType<typeof vi.fn> };
    reaction: { record: ReturnType<typeof vi.fn> };
    stock: { discardBatch: ReturnType<typeof vi.fn> };
  };
  readonly replies: string[];
}

function fixture(
  options: { member?: SlackMember | null; reply?: () => Promise<void>; ingredients?: { id: string; name: string }[] } = {},
): Fixture {
  const useCases = {
    noFeed: { register: vi.fn(async () => ({ held: [], undiscardable: [] })) },
    reaction: { record: vi.fn(async () => {}) },
    stock: { discardBatch: vi.fn(async () => {}) },
  };
  const ingredients = options.ingredients ?? [{ id: INGREDIENT_ID, name: '브로콜리' }];
  const reader: HouseholdReader = {
    read: async (_householdId, body) => await body({ ingredients } as unknown as HouseholdState),
  };
  const replies: string[] = [];
  const dispatcher = new SlackActionDispatcher(
    { ...useCases, reader } as unknown as ButtonUseCases,
    { resolve: async () => (options.member === undefined ? MEMBER : options.member) },
    options.reply ??
      (async (url, text) => {
        expect(url).toBe(RESPONSE_URL);
        replies.push(text);
      }),
  );
  return { dispatcher, useCases, replies };
}

const tap = (kind: 'no_feed' | 'reaction' | 'discard', value: string, ordinal = 0): ButtonTap => ({
  slackUserId: 'U0123',
  responseUrl: RESPONSE_URL,
  messageTs: MESSAGE_TS,
  actionId: actionId(kind, ordinal),
  value,
});

const noFeedTap = tap('no_feed', encodeNoFeed(localDate('2026-09-22'), 'morning', true));
const reactionTap = tap('reaction', encodeReaction(localDate('2026-09-21'), 'afternoon', INGREDIENT_ID, 'reacted'));
const discardTap = tap('discard', encodeDiscard(BATCH_ID), 1);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Slack 버튼 디스패치', () => {
  it('미급여 버튼은 미급여 등록을 부른다', async () => {
    const { dispatcher, useCases, replies } = fixture();

    await dispatcher.handle(noFeedTap);

    expect(useCases.noFeed.register).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      actor: MEMBER.actor,
      idempotencyKey: `slack:${MESSAGE_TS}:no_feed.0:2026-09-22|morning|thawed`,
      date: '2026-09-22',
      slot: 'morning',
      thawed: true,
      reason: null,
    });
    expect(useCases.reaction.record).not.toHaveBeenCalled();
    expect(useCases.stock.discardBatch).not.toHaveBeenCalled();
    expect(replies).toEqual(['2026-09-22 오전 미급여(해동 후)를 기록했습니다']);
  });

  it('해동 전 미급여는 해동 전으로 알린다', async () => {
    const { dispatcher, replies } = fixture();

    await dispatcher.handle(tap('no_feed', encodeNoFeed(localDate('2026-09-22'), 'afternoon', false)));

    expect(replies).toEqual(['2026-09-22 오후 미급여(해동 전)를 기록했습니다']);
  });

  it('반응 버튼은 재료 id를 이름으로 바꿔 반응 기록을 부른다', async () => {
    const { dispatcher, useCases, replies } = fixture();

    await dispatcher.handle(reactionTap);

    expect(useCases.reaction.record).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      actor: MEMBER.actor,
      idempotencyKey: `slack:${MESSAGE_TS}:reaction.0:2026-09-21|afternoon|${INGREDIENT_ID}|reacted`,
      date: '2026-09-21',
      slot: 'afternoon',
      ingredientName: '브로콜리',
      result: 'reacted',
    });
    expect(replies).toEqual(['2026-09-21 오후 브로콜리: 반응 있음으로 기록했습니다']);
  });

  it('반응 버튼의 재료가 가정에 없으면 알리고 아무것도 부르지 않는다', async () => {
    const { dispatcher, useCases, replies } = fixture({ ingredients: [] });

    await dispatcher.handle(reactionTap);

    expect(useCases.reaction.record).not.toHaveBeenCalled();
    expect(replies).toEqual([UNKNOWN_INGREDIENT]);
  });

  it('폐기 버튼은 임계일 초과 사유로 배치 폐기를 부른다', async () => {
    const { dispatcher, useCases, replies } = fixture();

    await dispatcher.handle(discardTap);

    expect(useCases.stock.discardBatch).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      actor: MEMBER.actor,
      idempotencyKey: `slack:${MESSAGE_TS}:discard.1:${BATCH_ID}`,
      batchId: BATCH_ID,
      reason: 'expired',
    });
    expect(replies).toEqual(['배치를 폐기했습니다']);
  });

  it('멱등키는 slack:{ts}:{action_id}:{value} 모양이다', () => {
    expect(idempotencyKeyOf(discardTap)).toBe(`slack:${MESSAGE_TS}:discard.1:${BATCH_ID}`);
  });

  it('같은 메시지의 폐기 버튼이라도 배치가 다르면 멱등키가 다르다', () => {
    const other = tap('discard', encodeDiscard(INGREDIENT_ID), 1);
    expect(idempotencyKeyOf(other)).not.toBe(idempotencyKeyOf(discardTap));
  });

  it('모르는 Slack 사용자면 안내만 보내고 아무것도 부르지 않는다', async () => {
    const { dispatcher, useCases, replies } = fixture({ member: null });

    await dispatcher.handle(noFeedTap);

    expect(useCases.noFeed.register).not.toHaveBeenCalled();
    expect(replies).toEqual([UNKNOWN_SLACK_USER]);
  });

  it('풀 수 없는 버튼이면 안내만 보내고 아무것도 부르지 않는다', async () => {
    const { dispatcher, useCases, replies } = fixture();

    await dispatcher.handle(tap('no_feed', 'not-a-value'));

    expect(useCases.noFeed.register).not.toHaveBeenCalled();
    expect(replies).toEqual([UNKNOWN_BUTTON]);
  });

  it('도메인 오류는 부모가 읽을 문장으로 알린다', async () => {
    const { dispatcher, useCases, replies } = fixture();
    useCases.noFeed.register.mockRejectedValueOnce(
      new DomainError('NO_FEED_ALREADY_REGISTERED', '이미 미급여로 등록된 끼니입니다'),
    );

    await dispatcher.handle(noFeedTap);

    expect(replies).toEqual(['처리하지 못했습니다: 이미 미급여로 등록된 끼니입니다']);
  });

  it('애플리케이션 오류도 부모가 읽을 문장으로 알린다', async () => {
    const { dispatcher, useCases, replies } = fixture();
    useCases.reaction.record.mockRejectedValueOnce(new ApplicationError('MEAL_NOT_FED', '아직 먹이지 않은 식단입니다'));

    await dispatcher.handle(reactionTap);

    expect(replies).toEqual(['처리하지 못했습니다: 아직 먹이지 않은 식단입니다']);
  });

  it('그 밖의 예외는 내부 문장을 보내지 않고 일반 실패 문구로 알린 뒤 로그에 남긴다', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { dispatcher, useCases, replies } = fixture();
    useCases.stock.discardBatch.mockRejectedValueOnce(new Error('connection terminated: pg 10.0.0.3'));

    await dispatcher.handle(discardTap);

    expect(replies).toEqual([PROCESSING_FAILED]);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('구성원 조회가 던져도 일반 실패 문구로 알린다', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const replies: string[] = [];
    const dispatcher = new SlackActionDispatcher(
      {} as ButtonUseCases,
      {
        resolve: async () => {
          throw new Error('pool timeout');
        },
      },
      async (_url, text) => {
        replies.push(text);
      },
    );

    await dispatcher.handle(noFeedTap);

    expect(replies).toEqual([PROCESSING_FAILED]);
  });

  it('유스케이스가 던져도 rejected promise가 밖으로 나가지 않는다', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { dispatcher, useCases } = fixture();
    useCases.noFeed.register.mockRejectedValueOnce(new Error('boom'));

    await expect(dispatcher.handle(noFeedTap)).resolves.toBeUndefined();
  });

  it('통보가 실패해도 rejected promise가 밖으로 나가지 않고 로그에 남긴다', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { dispatcher } = fixture({
      reply: async () => {
        throw new Error('response_url이 HTTP 404로 응답했습니다');
      },
    });

    await expect(dispatcher.handle(noFeedTap)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
