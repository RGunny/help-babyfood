import {
  BoardBlock,
  BoardDay,
  BoardIngredient,
  BoardMeal,
  BoardSlotEntry,
  HouseholdBoard,
} from '../../application/household-board.js';
import { DailyBrief } from '../../application/daily-brief.js';
import { LocalDate, addDays, localDate } from '../../domain/shared/local-date.js';
import { localTime } from '../../domain/shared/local-time.js';
import { MealSlot } from '../../domain/shared/meal-slot.js';
import { calendarGridOf, todayHeader } from './calendar-grid.js';
import { MAX_TABLE_CELLS } from './markdown.js';

const TODAY = localDate('2026-09-26');

const ingredient = (name: string, exposureNumber: number | null = null, reacted = false): BoardIngredient => ({
  ingredientId: name,
  name,
  exposureNumber,
  reacted,
});

function meal(toppings: BoardIngredient[], overrides: Partial<BoardMeal> = {}): BoardMeal {
  return {
    menuName: '쌀오트밀죽',
    watchedBaseIngredients: [],
    toppings,
    memo: null,
    fed: false,
    corrected: false,
    ...overrides,
  };
}

function entry(slot: MealSlot, mealOf: BoardMeal | null, noFeed: BoardSlotEntry['noFeed'] = null): BoardSlotEntry {
  return { slot, meal: mealOf, noFeed };
}

/** Ten days from `start`; `slotsOf` decides what each day holds. */
function block(number: number, start: string, slotsOf: (date: LocalDate, index: number) => BoardSlotEntry[]): BoardBlock {
  const days: BoardDay[] = Array.from({ length: 10 }, (_, index) => {
    const date = addDays(localDate(start), index);
    const slots = slotsOf(date, index);
    return { date, dayNumber: slots.every((slot) => slot.noFeed !== null) && slots.length > 0 ? null : 20 + index, slots };
  });
  return { number, days };
}

function board(blocks: BoardBlock[], slots: MealSlot[] = ['morning'], omittedBlocks = 0): HouseholdBoard {
  return {
    now: { date: TODAY, time: localTime('19:00') },
    brief: { date: TODAY } as unknown as DailyBrief,
    slots,
    blocks,
    omittedBlocks,
  };
}

describe('식단 격자', () => {
  it('열은 날짜, 행은 일차·날짜·베이스·토핑이고 토핑 행 수는 블록에서 가장 많은 토핑 수다', () => {
    const grid = calendarGridOf(
      board([
        block(3, '2026-09-20', (_, index) => [
          entry('morning', meal(index === 2 ? [ingredient('소고기'), ingredient('당근'), ingredient('시금치')] : [ingredient('소고기')])),
        ]),
      ]),
    );

    const [only] = grid.blocks;
    expect(only.header).toEqual(['일차', '20일차', '21일차', '22일차', '23일차', '24일차', '25일차', '26일차', '27일차', '28일차', '29일차']);
    expect(only.rows.map((row) => row[0])).toEqual(['날짜', '오전 베이스', '오전 토핑', '', '']);
    expect(only.rows[0][1]).toBe('09-20 일');
    expect(only.rows[1][1]).toBe('쌀오트밀죽');
    expect(only.rows[2][3]).toBe('소고기');
    expect(only.rows[4][3]).toBe('시금치');
    expect(only.rows[4][1]).toBe('');
    expect(only.omittedToppings).toBe(0);
  });

  it('오늘 열의 위치를 알려 주고 급여 완료된 날에는 ✓가 붙는다', () => {
    const grid = calendarGridOf(
      board([block(3, '2026-09-20', (date) => [entry('morning', meal([ingredient('소고기')], { fed: date <= TODAY }))])]),
    );

    const [only] = grid.blocks;
    // 09-26은 09-20부터 일곱 번째 날이라 머리 행에서는 7번째(0은 모서리)다.
    expect(only.todayColumn).toBe(7);
    expect(only.header[7]).toBe('26일차 ✓');
    expect(only.header[8]).toBe('27일차');
    expect(todayHeader(only.header[7])).toBe('▶ 26일차 ✓');
  });

  it('미급여 날은 머리가 미급여이고 베이스 칸에 사유가 들어간다', () => {
    const grid = calendarGridOf(
      board([
        block(3, '2026-09-20', (_, index) =>
          index === 1
            ? [entry('morning', null, { date: localDate('2026-09-21'), slot: 'morning', thawed: false, reason: '감기' })]
            : [entry('morning', meal([ingredient('소고기')]))],
        ),
      ]),
    );

    const [only] = grid.blocks;
    expect(only.header[2]).toBe('미급여');
    expect(only.rows[1][2]).toBe('미급여 (감기)');
    expect(only.rows[2][2]).toBe('');
  });

  it('회차는 ①②로, 반응있음은 ⚠로, 베이스의 관찰 재료는 괄호로, 메모와 수정은 뒤에 붙는다', () => {
    const grid = calendarGridOf(
      board([
        block(3, '2026-09-20', () => [
          entry(
            'morning',
            meal([ingredient('완두콩', 1), ingredient('계란', 2), ingredient('오이', null, true)], {
              menuName: '쌀밀가루죽',
              watchedBaseIngredients: [ingredient('밀가루', 1)],
              memo: '(+10g)',
              corrected: true,
            }),
          ),
        ]),
      ]),
    );

    const [only] = grid.blocks;
    expect(only.rows[1][1]).toBe('쌀밀가루죽 (밀가루 ①) (+10g) (수정)');
    expect(only.rows[2][1]).toBe('완두콩 ①');
    expect(only.rows[3][1]).toBe('계란 ②');
    expect(only.rows[4][1]).toBe('오이 ⚠');
  });

  it('끼니가 둘이면 오후 행이 오전 아래 이어지고, 식단이 없는 날의 칸은 빈다', () => {
    const grid = calendarGridOf(
      board(
        [
          block(3, '2026-09-20', (_, index) => [
            entry('morning', meal([ingredient('소고기')])),
            entry('afternoon', index < 5 ? null : meal([ingredient('당근'), ingredient('시금치')])),
          ]),
        ],
        ['morning', 'afternoon'],
      ),
    );

    const [only] = grid.blocks;
    expect(only.rows.map((row) => row[0])).toEqual(['날짜', '오전 베이스', '오전 토핑', '오후 베이스', '오후 토핑', '']);
    expect(only.rows[3][1]).toBe('');
    expect(only.rows[3][10]).toBe('쌀오트밀죽');
    expect(only.rows[5][10]).toBe('시금치');
  });

  it('표가 300셀을 넘으면 토핑 행을 줄이고 넣지 못한 토핑을 센다', () => {
    // 토핑 30개짜리 식단은 11열 × (머리 1 + 날짜 1 + 베이스 1 + 토핑 30)행 = 363셀이다.
    // 머리 행을 포함해 27행(297셀)까지만 남으므로 본문은 26행, 토핑 행은 24개다.
    const many = Array.from({ length: 30 }, (_, index) => ingredient(`토핑${index}`));
    const grid = calendarGridOf(board([block(3, '2026-09-20', (_, index) => [entry('morning', meal(index === 0 ? many : []))])]));

    const [only] = grid.blocks;
    expect((only.rows.length + 1) * only.header.length).toBeLessThanOrEqual(MAX_TABLE_CELLS);
    expect(only.rows.length).toBe(26);
    expect(only.omittedToppings).toBe(30 - (26 - 2));
  });

  it('버린 블록 수를 그대로 넘긴다', () => {
    expect(calendarGridOf(board([], [], 2)).omittedBlocks).toBe(2);
  });
});
