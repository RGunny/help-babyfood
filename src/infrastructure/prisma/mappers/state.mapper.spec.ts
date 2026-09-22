import { localDate } from '../../../domain/shared/local-date.js';
import { localTime } from '../../../domain/shared/local-time.js';
import {
  DEFAULT_BRIEF_TIME,
  toAlertSettings,
  toCookedBatch,
  toIngredient,
  toLedgerEntry,
  toMeal,
  toMealPlanningRules,
  toMenu,
  toNoFeedRecord,
  toSlotSchedule,
  toThresholds,
} from './state.mapper.js';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('재료 매핑', () => {
  it('대표 이름은 이름으로, 나머지 호칭은 별칭으로 간다', () => {
    expect(
      toIngredient({
        id: 'broccoli',
        name: '브로콜리',
        category: 'vegetable',
        servingWeightGram: 15,
        labels: [
          { label: '브로콜리', isCanonical: true, position: 0 },
          { label: '브로컬리', isCanonical: false, position: 1 },
        ],
      }),
    ).toEqual({
      id: 'broccoli',
      name: '브로콜리',
      aliases: ['브로컬리'],
      category: 'vegetable',
      servingWeightGram: 15,
    });
  });

  it('별칭은 position 순서를 지킨다', () => {
    const ingredient = toIngredient({
      id: 'broccoli',
      name: '브로콜리',
      category: 'vegetable',
      servingWeightGram: 15,
      labels: [
        { label: '두번째', isCanonical: false, position: 2 },
        { label: '브로콜리', isCanonical: true, position: 0 },
        { label: '첫번째', isCanonical: false, position: 1 },
      ],
    });
    expect(ingredient.aliases).toEqual(['첫번째', '두번째']);
  });

  it('별칭이 없으면 빈 배열이다', () => {
    const ingredient = toIngredient({
      id: 'rice',
      name: '쌀',
      category: 'base',
      servingWeightGram: 30,
      labels: [{ label: '쌀', isCanonical: true, position: 0 }],
    });
    expect(ingredient.aliases).toEqual([]);
  });
});

describe('메뉴 매핑', () => {
  it('구성 큐브를 그대로 옮긴다', () => {
    expect(
      toMenu({
        id: 'rice-oatmeal',
        name: '쌀오트밀죽',
        components: [
          { ingredientId: 'rice', cubes: 1 },
          { ingredientId: 'oatmeal', cubes: 1 },
        ],
      }),
    ).toEqual({
      id: 'rice-oatmeal',
      name: '쌀오트밀죽',
      components: [
        { ingredientId: 'rice', cubes: 1 },
        { ingredientId: 'oatmeal', cubes: 1 },
      ],
    });
  });
});

describe('끼니 설정과 미급여 매핑', () => {
  it('시작일과 식단시간을 값 객체로 바꾼다', () => {
    expect(toSlotSchedule({ slot: 'morning', startDate: date('2026-08-17'), mealTime: '10:00' })).toEqual({
      slot: 'morning',
      startDate: localDate('2026-08-17'),
      mealTime: localTime('10:00'),
    });
  });

  it('미급여 기록의 사유가 없으면 null이다', () => {
    expect(toNoFeedRecord({ date: date('2026-08-20'), slot: 'afternoon', thawed: true, reason: null })).toEqual({
      date: localDate('2026-08-20'),
      slot: 'afternoon',
      thawed: true,
      reason: null,
    });
  });
});

describe('식단 매핑', () => {
  const base = {
    id: 'morning-4',
    slot: 'morning' as const,
    mealOrder: 4,
    plannedBaseMenuId: 'rice-oatmeal',
    memo: '(+10g)',
    status: 'planned' as const,
    migrated: false,
  };

  it('계획 토핑은 position 순서를 지킨다', () => {
    const meal = toMeal({
      ...base,
      actual: null,
      toppings: [
        { kind: 'planned', position: 1, ingredientId: 'broccoli' },
        { kind: 'planned', position: 0, ingredientId: 'beef' },
      ],
    });
    expect(meal.planned).toEqual({ baseMenuId: 'rice-oatmeal', toppingIngredientIds: ['beef', 'broccoli'] });
  });

  it('같은 재료가 두 번 들어간 식단도 그대로 왕복한다', () => {
    const meal = toMeal({
      ...base,
      actual: null,
      toppings: [
        { kind: 'planned', position: 0, ingredientId: 'flour' },
        { kind: 'planned', position: 1, ingredientId: 'flour' },
      ],
    });
    expect(meal.planned.toppingIngredientIds).toEqual(['flour', 'flour']);
  });

  it('실제 급여 행이 없으면 actual은 null이다', () => {
    expect(toMeal({ ...base, actual: null, toppings: [] }).actual).toBeNull();
  });

  it('실제 급여 행이 있고 토핑이 없으면 빈 토핑의 실제 급여다 (null이 아니다)', () => {
    expect(toMeal({ ...base, actual: { actualBaseMenuId: null }, toppings: [] }).actual).toEqual({
      baseMenuId: null,
      toppingIngredientIds: [],
    });
  });

  it('계획과 실제 토핑을 섞지 않는다', () => {
    const meal = toMeal({
      ...base,
      actual: { actualBaseMenuId: 'rice-oatmeal' },
      toppings: [
        { kind: 'planned', position: 0, ingredientId: 'broccoli' },
        { kind: 'actual', position: 0, ingredientId: 'zucchini' },
      ],
    });
    expect(meal.planned.toppingIngredientIds).toEqual(['broccoli']);
    expect(meal.actual?.toppingIngredientIds).toEqual(['zucchini']);
  });

  it('순서 값과 메모, 이관 여부를 옮긴다', () => {
    const meal = toMeal({ ...base, migrated: true, status: 'consumed', actual: null, toppings: [] });
    expect(meal).toMatchObject({ order: 4, memo: '(+10g)', status: 'consumed', migrated: true });
  });
});

describe('배치와 원장 매핑', () => {
  it('조리일을 달력 날짜로 바꾼다', () => {
    expect(
      toCookedBatch({ id: 'b1', ingredientId: 'broccoli', cubeWeightGram: 15, cookedOn: date('2026-09-20') }),
    ).toEqual({
      id: 'b1',
      ingredientId: 'broccoli',
      cubeWeightGram: 15,
      cookedOn: localDate('2026-09-20'),
    });
  });

  it('미급여 태그가 없는 이벤트에는 noFeedKey 속성을 붙이지 않는다', () => {
    const entry = toLedgerEntry({
      batchId: 'b1',
      type: 'received',
      delta: 10,
      mealId: null,
      reason: null,
      noFeedKey: null,
    });
    expect(entry).toEqual({ batchId: 'b1', type: 'received', delta: 10, mealId: null, reason: null });
    expect('noFeedKey' in entry).toBe(false);
  });

  it('미급여 태그가 있으면 붙인다', () => {
    expect(
      toLedgerEntry({
        batchId: 'b1',
        type: 'discarded',
        delta: -1,
        mealId: 'morning-4',
        reason: 'thawed_not_fed',
        noFeedKey: '2026-08-20/morning',
      }),
    ).toEqual({
      batchId: 'b1',
      type: 'discarded',
      delta: -1,
      mealId: 'morning-4',
      reason: 'thawed_not_fed',
      noFeedKey: '2026-08-20/morning',
    });
  });
});

describe('식단 규칙 매핑', () => {
  it('규칙 행이 없으면 제약을 끈 상태다', () => {
    expect(toMealPlanningRules(null, [])).toEqual({
      forbiddenPairings: [],
      maxFirstIntroductionsPerDay: null,
      firstIntroductionSlot: null,
    });
  });

  it('조합 금지 쌍과 범위를 옮긴다', () => {
    expect(
      toMealPlanningRules({ textGuidance: null, maxFirstIntroductionsPerDay: 1, firstIntroductionSlot: 'morning' }, [
        { ingredientAId: 'beef', ingredientBId: 'sweet-potato', scope: 'same_day' },
      ]),
    ).toEqual({
      forbiddenPairings: [{ ingredientIds: ['beef', 'sweet-potato'], scope: 'same_day' }],
      maxFirstIntroductionsPerDay: 1,
      firstIntroductionSlot: 'morning',
    });
  });
});

describe('알람 설정 매핑', () => {
  it('설정 행이 없으면 기본 브리프 시각과 기본 임계일이다', () => {
    expect(toAlertSettings(null)).toEqual({
      briefTime: localTime(DEFAULT_BRIEF_TIME),
      shelfLifeDays: 14,
    });
  });

  it('저장된 시각과 임계일을 그대로 옮긴다', () => {
    expect(toAlertSettings({ briefTime: '06:45', shelfLifeDays: 10 })).toEqual({
      briefTime: localTime('06:45'),
      shelfLifeDays: 10,
    });
  });

  it('시각 형식이 아니면 거부한다', () => {
    expect(() => toAlertSettings({ briefTime: '7:30', shelfLifeDays: 14 })).toThrow();
  });
});

describe('임계개수 매핑', () => {
  it('재료별 개수를 맵으로 만든다', () => {
    const thresholds = toThresholds([
      { ingredientId: 'beef', thresholdCubes: 3 },
      { ingredientId: 'cucumber', thresholdCubes: 0 },
    ]);
    expect([...thresholds]).toEqual([
      ['beef', 3],
      ['cucumber', 0],
    ]);
  });

  it('행이 없으면 빈 맵이다', () => {
    expect(toThresholds([]).size).toBe(0);
  });
});
