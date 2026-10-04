import { DailyBrief } from '../../application/daily-brief.js';
import { BoardBlock, BoardDay, BoardIngredient, BoardMeal, HouseholdBoard } from '../../application/household-board.js';
import { LocalDate, addDays, localDate } from '../../domain/shared/local-date.js';
import { localTime } from '../../domain/shared/local-time.js';
import { householdBoardTemplate } from './household-board.js';

const TODAY = localDate('2026-09-26');

const id = (n: number): string => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const ingredient = (name: string, exposureNumber: number | null = null, reacted = false): BoardIngredient => ({
  ingredientId: name,
  name,
  exposureNumber,
  reacted,
});

const meal = (toppings: BoardIngredient[], overrides: Partial<BoardMeal> = {}): BoardMeal => ({
  menuName: '쌀오트밀죽',
  watchedBaseIngredients: [],
  toppings,
  memo: null,
  fed: false,
  corrected: false,
  ...overrides,
});

/** The migrated household's weeks four to six, as the spreadsheet had them around 27일차. */
const PLAN: Record<string, BoardMeal | 'no_feed'> = {
  '2026-09-21': meal([ingredient('소고기'), ingredient('브로콜리'), ingredient('당근'), ingredient('땅콩버터', 1)], { fed: true }),
  '2026-09-22': meal([ingredient('소고기'), ingredient('애호박'), ingredient('양배추'), ingredient('땅콩버터', 1)], { fed: true }),
  '2026-09-23': meal([ingredient('소고기'), ingredient('단호박'), ingredient('시금치', 1)], { fed: true }),
  '2026-09-24': meal([ingredient('닭고기'), ingredient('양배추'), ingredient('시금치', 2)], { fed: true }),
  '2026-09-25': meal([ingredient('소고기'), ingredient('애호박'), ingredient('당근')], { fed: true }),
  '2026-09-26': meal([ingredient('소고기'), ingredient('청경채'), ingredient('단호박')], { fed: true, memo: '(소량)' }),
  '2026-09-27': 'no_feed',
  '2026-09-28': meal([ingredient('소고기'), ingredient('당근'), ingredient('브로콜리')]),
  '2026-09-29': meal([ingredient('소고기'), ingredient('당근'), ingredient('계란', 1)]),
  '2026-09-30': meal([ingredient('소고기'), ingredient('브로콜리'), ingredient('계란', 2)]),
  '2026-10-01': meal([ingredient('소고기'), ingredient('브로콜리'), ingredient('오이', 1), ingredient('땅콩버터', 2)]),
  '2026-10-02': meal([ingredient('소고기'), ingredient('당근'), ingredient('오이', 2)]),
  '2026-10-03': meal([ingredient('소고기'), ingredient('완두콩', 1), ingredient('청경채')], { menuName: '쌀밀가루죽', watchedBaseIngredients: [ingredient('밀가루', 2)] }),
  '2026-10-04': meal([ingredient('소고기'), ingredient('완두콩', 2), ingredient('단호박'), ingredient('브로콜리')]),
  '2026-10-05': meal([ingredient('소고기'), ingredient('감자', 1), ingredient('당근'), ingredient('시금치'), ingredient('밀가루', null, true)]),
};

/** A week from `start` (a Monday). Day numbers run on from `firstDayNumber`, pausing on a no-feed day. */
function block(number: number, start: string, firstDayNumber: number): BoardBlock {
  let dayNumber = firstDayNumber;
  const days: BoardDay[] = [];
  for (let index = 0; index < 7; index += 1) {
    const date: LocalDate = addDays(localDate(start), index);
    const planned = PLAN[date];
    if (planned === 'no_feed') {
      days.push({ date, dayNumber: null, slots: [{ slot: 'morning', meal: null, noFeed: { date, slot: 'morning', thawed: false, reason: '감기' } }] });
      continue;
    }
    days.push({ date, dayNumber, slots: [{ slot: 'morning', meal: planned ?? null, noFeed: null }] });
    dayNumber += 1;
  }
  return { number, days };
}

const BRIEF: DailyBrief = {
  date: TODAY,
  dayNumber: 27,
  slots: [],
  newIngredients: [],
  stock: [
    { ingredientId: id(1), name: '쌀', total: 5, fresh: 5, overdue: 0, weightMismatched: 0, depletionDate: localDate('2026-10-01'), nextExpiry: { date: localDate('2026-10-06'), stage: { kind: 'fresh' } } },
    { ingredientId: id(2), name: '오트밀', total: 13, fresh: 13, overdue: 0, weightMismatched: 0, depletionDate: null, nextExpiry: { date: localDate('2026-09-28'), stage: { kind: 'due_soon', daysLeft: 2 } } },
    { ingredientId: id(3), name: '소고기', total: 16, fresh: 16, overdue: 0, weightMismatched: 0, depletionDate: localDate('2026-10-12'), nextExpiry: { date: localDate('2026-10-08'), stage: { kind: 'fresh' } } },
    { ingredientId: id(4), name: '브로콜리', total: 3, fresh: 0, overdue: 3, weightMismatched: 0, depletionDate: localDate('2026-09-30'), nextExpiry: { date: localDate('2026-09-18'), stage: { kind: 'overdue', overdueDays: 8 } } },
    { ingredientId: id(5), name: '당근', total: 0, fresh: 0, overdue: 0, weightMismatched: 0, depletionDate: null, nextExpiry: null },
    { ingredientId: id(6), name: '오이', total: 0, fresh: 0, overdue: 0, weightMismatched: 0, depletionDate: null, nextExpiry: null },
  ],
  pantryIngredients: [{ ingredientId: id(8), name: '계란' }],
  shortages: [],
  thresholdAlerts: [{ ingredientId: id(6), name: '오이', total: 0, thresholdCubes: 2 }],
  expiryAlerts: [
    {
      batchId: id(40),
      ingredientId: id(4),
      name: '브로콜리',
      cookedOn: localDate('2026-09-04'),
      expiryDate: localDate('2026-09-18'),
      remaining: 3,
      stage: { kind: 'overdue', overdueDays: 8 },
    },
  ],
  attention: {
    heldDeductions: [],
    unrecordedReactions: [{ ingredientId: id(7), name: '청경채', date: TODAY, slot: 'morning' }],
    ruleWarnings: [{ code: 'REACTED_INGREDIENT_PLANNED', date: localDate('2026-10-05'), slot: 'morning', ingredientNames: ['밀가루'] }],
    weightMismatchedBatches: [],
    planRunwayDays: 9,
    planRunwayShort: false,
  },
};

function board(overrides: Partial<HouseholdBoard> = {}): HouseholdBoard {
  return {
    now: { date: TODAY, time: localTime('19:03') },
    brief: BRIEF,
    slots: ['morning'],
    blocks: [block(4, '2026-09-21', 22), block(5, '2026-09-28', 28), block(6, '2026-10-05', 35)],
    omittedBlocks: 0,
    ...overrides,
  };
}

describe('상태판 캔버스', () => {
  it('세 주의 달력과 재고, 확인 필요를 마크다운으로 낸다', async () => {
    const markdown = householdBoardTemplate.render(board());

    await expect(markdown).toMatchFileSnapshot('./__snapshots__/household-board.v4.md');
  });

  it('오늘 열의 머리만 굵고 ▶가 붙는다', () => {
    const markdown = householdBoardTemplate.render(board());

    expect(markdown).toContain('| **▶ 27일차 ✓** |');
    expect(markdown.match(/\*\*▶/g)).toHaveLength(1);
  });

  it('끼니가 없으면 달력 대신 한 줄이 나오고 나머지 구역은 그대로다', () => {
    const markdown = householdBoardTemplate.render(board({ blocks: [], slots: [] }));

    expect(markdown).toContain('## 식단\n등록된 끼니가 없습니다.');
    expect(markdown).toContain('## 재고');
  });

  it('버린 블록과 넣지 못한 토핑은 표 곁에 적힌다', () => {
    const many = Array.from({ length: 40 }, (_, index) => ingredient(`토핑${index}`));
    const crowded: BoardBlock = {
      number: 9,
      days: block(4, '2026-09-21', 22).days.map((day, index) =>
        index === 0 ? { ...day, slots: [{ slot: 'morning', meal: meal(many), noFeed: null }] } : day,
      ),
    };
    const markdown = householdBoardTemplate.render(board({ blocks: [crowded], omittedBlocks: 2 }));

    expect(markdown).toContain('_지난 2주는 생략했습니다._');
    expect(markdown).toContain('_토핑 6개는 표에 넣지 못했습니다._');
  });

  it('재고가 없으면 표 대신 한 줄이고, 재고 0인 재료는 아래 한 줄로 적힌다', () => {
    const markdown = householdBoardTemplate.render(
      board({ brief: { ...BRIEF, stock: BRIEF.stock.filter((row) => row.total === 0), thresholdAlerts: [] } }),
    );

    expect(markdown).toContain('## 재고\n재고가 없습니다.\n_재고 0: 당근, 오이_\n_상비: 계란_');
  });

  it('재고 표는 300셀 안에서 자르고 뺀 수를 적는다', () => {
    const stock = Array.from({ length: 60 }, (_, index) => ({
      ingredientId: id(100 + index),
      name: `재료${index}`,
      total: 1,
      fresh: 1,
      overdue: 0,
      weightMismatched: 0,
      depletionDate: null,
      nextExpiry: null,
    }));
    const markdown = householdBoardTemplate.render(board({ brief: { ...BRIEF, stock, thresholdAlerts: [] } }));

    // 7열이라 머리 행을 포함해 42행, 재료는 41개까지다.
    expect(markdown).toContain('| 재료40 |');
    expect(markdown).not.toContain('| 재료41 |');
    expect(markdown).toContain('_…외 19개 재료는 표에서 생략했습니다._');
  });

  it('이름의 | 와 * 는 표와 서식을 깨지 않게 이스케이프된다', () => {
    const odd = block(4, '2026-09-21', 22);
    const day = odd.days[0];
    const blocks: BoardBlock[] = [
      { ...odd, days: [{ ...day, slots: [{ slot: 'morning', meal: meal([ingredient('a|b*c')]), noFeed: null }] }, ...odd.days.slice(1)] },
    ];
    const markdown = householdBoardTemplate.render(board({ blocks }));

    expect(markdown).toContain('a\\|b\\*c');
  });

  it('확인 필요가 비면 없습니다로 적는다', () => {
    const markdown = householdBoardTemplate.render(
      board({ brief: { ...BRIEF, attention: { ...BRIEF.attention, unrecordedReactions: [], ruleWarnings: [] } } }),
    );

    expect(markdown).toContain('## 확인 필요\n없습니다.');
  });

  it('임계일이 임박하거나 지난 행은 재료명이 굵고 ⏰가 붙는다', () => {
    const markdown = householdBoardTemplate.render(board());

    expect(markdown).toContain('| **⏰ 오트밀** | 13 | 13 | 0 | 09-28 | – | – |');
    expect(markdown).toContain('| **⏰ 브로콜리** | 3 | 0 | 3 | 09-18 | 09-30 | – |');
    expect(markdown).toContain('| 쌀 | 5 | 5 | 0 | 10-06 | 10-01 | – |');
  });

  it('상비 재료는 표 아래 한 줄이다', () => {
    const markdown = householdBoardTemplate.render(
      board({ brief: { ...BRIEF, pantryIngredients: [{ ingredientId: id(8), name: '땅콩버터' }, { ingredientId: id(9), name: '계란' }] } }),
    );

    expect(markdown).toContain('_재고 0: 당근_\n_상비: 땅콩버터, 계란_\n\n## 확인 필요');
  });

  it('임계일 구역이 없다', () => {
    const markdown = householdBoardTemplate.render(board());

    expect(markdown).not.toMatch(/^## 임계일/m);
    expect(markdown.match(/^## .*/gm)).toEqual(['## 식단', '## 재고', '## 확인 필요']);
  });

  it('오늘 급여일이 아니면 제목 줄이 그렇게 말한다', () => {
    const markdown = householdBoardTemplate.render(board({ brief: { ...BRIEF, dayNumber: null } }));

    expect(markdown).toContain('_2026-09-26 19:03 갱신 · 오늘은 급여일이 아닙니다_');
  });
});
