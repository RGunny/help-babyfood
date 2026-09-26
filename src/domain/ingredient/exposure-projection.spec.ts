import { ExposureMeal, advanceIntroduction, projectExposures } from './exposure-projection.js';
import { FeedingReaction, IntroductionStatus } from './introduction-status.js';

function meal(
  mealId: string,
  ingredientIds: string[],
  options: { fed?: boolean; reactions?: Record<string, FeedingReaction> } = {},
): ExposureMeal {
  return {
    mealId,
    ingredientIds,
    fed: options.fed ?? false,
    reactions: new Map(Object.entries(options.reactions ?? {})),
  };
}

const exposuresOf = (result: Map<string, ReadonlyMap<string, number>>, mealId: string) =>
  Object.fromEntries(result.get(mealId) ?? []);

describe('회차 투영', () => {
  it('처음 나오는 재료는 1회차이고, 예정 식단은 이상 없음으로 보고 다음 식단에서 2회차가 된다', () => {
    const result = projectExposures({
      initialStatuses: new Map(),
      meals: [meal('d1', ['pea']), meal('d2', ['pea']), meal('d3', ['pea'])],
    });

    expect(exposuresOf(result, 'd1')).toEqual({ pea: 1 });
    expect(exposuresOf(result, 'd2')).toEqual({ pea: 2 });
    // 이상 없음 2회면 검증완료라 세 번째에는 표시가 없다.
    expect(exposuresOf(result, 'd3')).toEqual({});
  });

  it('창 밖에서 이미 1회 이상 없음이었던 재료는 창 안 첫 식단에서 2회차다', () => {
    const initial: [string, IntroductionStatus][] = [['pea', { kind: 'verifying', clearCount: 1, unrecordedCount: 0 }]];
    const result = projectExposures({
      initialStatuses: new Map(initial),
      meals: [meal('d1', ['pea']), meal('d2', ['pea'])],
    });

    expect(exposuresOf(result, 'd1')).toEqual({ pea: 2 });
    expect(exposuresOf(result, 'd2')).toEqual({});
  });

  it('이미 먹였지만 반응 기록이 없는 식단은 회차를 올리지 않는다', () => {
    const result = projectExposures({
      initialStatuses: new Map(),
      meals: [meal('d1', ['pea'], { fed: true }), meal('d2', ['pea'], { fed: true }), meal('d3', ['pea'])],
    });

    // 4.6절: 횟수는 이상 없음을 기록한 급여만 센다. 미기록이 둘 쌓여도 다음 식단은 여전히 1회차다.
    expect(exposuresOf(result, 'd1')).toEqual({ pea: 1 });
    expect(exposuresOf(result, 'd2')).toEqual({ pea: 1 });
    expect(exposuresOf(result, 'd3')).toEqual({ pea: 1 });
  });

  it('반응 있음이 기록되면 그 뒤 식단에는 회차가 붙지 않는다', () => {
    const result = projectExposures({
      initialStatuses: new Map(),
      meals: [meal('d1', ['pea'], { fed: true, reactions: { pea: 'reacted' } }), meal('d2', ['pea'])],
    });

    expect(exposuresOf(result, 'd1')).toEqual({ pea: 1 });
    expect(exposuresOf(result, 'd2')).toEqual({});
  });

  it('검증완료 재료와 반응있음 재료에는 처음부터 회차가 붙지 않는다', () => {
    const initial: [string, IntroductionStatus][] = [
      ['rice', { kind: 'verified' }],
      ['egg', { kind: 'reacted' }],
    ];
    const result = projectExposures({
      initialStatuses: new Map(initial),
      meals: [meal('d1', ['rice', 'egg', 'pea'])],
    });

    expect(exposuresOf(result, 'd1')).toEqual({ pea: 1 });
  });

  it('같은 날 두 끼니에 같은 재료가 있으면 오전이 1회차, 오후가 2회차다', () => {
    // 식단은 호출자가 날짜 순, 같은 날은 오전부터 넘긴다. 순서가 곧 회차다.
    const result = projectExposures({
      initialStatuses: new Map(),
      meals: [meal('morning', ['pea']), meal('afternoon', ['pea'])],
    });

    expect(exposuresOf(result, 'morning')).toEqual({ pea: 1 });
    expect(exposuresOf(result, 'afternoon')).toEqual({ pea: 2 });
  });

  it('식단마다 항목이 있고 재료가 하나도 관찰 대상이 아니면 빈 맵이다', () => {
    const result = projectExposures({
      initialStatuses: new Map([['rice', { kind: 'verified' }]]),
      meals: [meal('d1', ['rice'])],
    });

    expect(result.has('d1')).toBe(true);
    expect(exposuresOf(result, 'd1')).toEqual({});
  });
});

describe('도입 상태 전이', () => {
  it('미도입에서 이상 없음이면 검증중 1회다', () => {
    expect(advanceIntroduction({ kind: 'not_introduced' }, 'clear')).toEqual({
      kind: 'verifying',
      clearCount: 1,
      unrecordedCount: 0,
    });
  });

  it('미도입에서 미기록이면 검증중 0회에 미기록 1이다', () => {
    expect(advanceIntroduction({ kind: 'not_introduced' }, 'unrecorded')).toEqual({
      kind: 'verifying',
      clearCount: 0,
      unrecordedCount: 1,
    });
  });

  it('검증중 1회에서 이상 없음이면 검증완료다', () => {
    expect(advanceIntroduction({ kind: 'verifying', clearCount: 1, unrecordedCount: 2 }, 'clear')).toEqual({
      kind: 'verified',
    });
  });

  it('어느 상태에서든 반응 있음이면 반응있음이다', () => {
    expect(advanceIntroduction({ kind: 'verified' }, 'reacted')).toEqual({ kind: 'reacted' });
    expect(advanceIntroduction({ kind: 'not_introduced' }, 'reacted')).toEqual({ kind: 'reacted' });
  });

  it('검증완료와 반응있음은 이상 없음이나 미기록으로 바뀌지 않는다', () => {
    expect(advanceIntroduction({ kind: 'verified' }, 'unrecorded')).toEqual({ kind: 'verified' });
    expect(advanceIntroduction({ kind: 'reacted' }, 'clear')).toEqual({ kind: 'reacted' });
  });
});
