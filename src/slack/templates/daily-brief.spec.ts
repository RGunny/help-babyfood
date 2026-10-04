import { randomUUID } from 'node:crypto';
import type { ActionsBlock, Button, ContextBlock, HeaderBlock, SectionBlock } from '@slack/types';
import { BriefExpiryAlert, BriefStockRow, DailyBrief } from '../../application/daily-brief.js';
import { localDate } from '../../domain/shared/local-date.js';
import { localTime } from '../../domain/shared/local-time.js';
import { decodeAction } from '../actions.js';
import { MAX_ACTION_ELEMENTS, MAX_BLOCKS, MAX_SECTION_TEXT, SlackBlock } from './blocks.js';
import { dailyBriefTemplate } from './daily-brief.js';
import { MAX_TABLE_CHARACTERS, MAX_TABLE_ROWS, TextTableBlock } from './table.js';

const renderBrief = (input: DailyBrief) => dailyBriefTemplate.render(input);

const DATE = localDate('2026-09-22');

function brief(overrides: Partial<DailyBrief> = {}): DailyBrief {
  return {
    date: DATE,
    dayNumber: 12,
    slots: [
      {
        slot: 'morning',
        mealTime: localTime('10:00'),
        meal: { menuName: '쌀오트밀죽', toppingNames: ['소고기', '완두콩'], memo: null, fed: false, corrected: false },
        noFeed: null,
      },
      {
        slot: 'afternoon',
        mealTime: localTime('15:00'),
        meal: { menuName: '쌀죽', toppingNames: ['브로콜리'], memo: '묽게', fed: false, corrected: false },
        noFeed: null,
      },
    ],
    newIngredients: [],
    stock: [],
    pantryIngredients: [],
    shortages: [],
    thresholdAlerts: [],
    expiryAlerts: [],
    attention: {
      heldDeductions: [],
      unrecordedReactions: [],
      ruleWarnings: [],
      weightMismatchedBatches: [],
      planRunwayDays: 20,
      planRunwayShort: false,
    },
    ...overrides,
  };
}

function stockRows(count: number): BriefStockRow[] {
  return Array.from({ length: count }, (_, index) => ({
    ingredientId: randomUUID(),
    name: `아주 긴 이름을 가진 재료 번호 ${index}`,
    total: 12,
    fresh: 10,
    overdue: 2,
    weightMismatched: 1,
    depletionDate: localDate('2026-10-01'),
    nextExpiry: null,
  }));
}

function overdue(count: number): BriefExpiryAlert[] {
  return Array.from({ length: count }, (_, index) => ({
    batchId: randomUUID(),
    ingredientId: randomUUID(),
    name: `재료 ${index}`,
    // 뒤에서부터 오래된 순으로 둔다. 렌더러가 조리일로 다시 정렬하는지 보기 위해서다.
    cookedOn: localDate(`2026-08-${String(30 - (index % 30)).padStart(2, '0')}`),
    expiryDate: localDate('2026-09-10'),
    remaining: 3,
    stage: { kind: 'overdue', overdueDays: 12 },
  }));
}

/** 재료 100개가 브리프의 모든 목록을 채운 상태. */
function crowdedBrief(): DailyBrief {
  const rows = stockRows(100);
  return brief({
    newIngredients: rows.map((row) => ({
      ingredientId: row.ingredientId,
      name: row.name,
      slot: 'morning',
      exposureNumber: 1,
    })),
    stock: rows,
    shortages: rows.map((row) => ({
      ingredientId: row.ingredientId,
      name: row.name,
      plannedCubes: 30,
      firstShortageDate: localDate('2026-09-30'),
      shortfallCubes: 5,
    })),
    thresholdAlerts: rows.map((row) => ({
      ingredientId: row.ingredientId,
      name: row.name,
      total: 1,
      thresholdCubes: 5,
    })),
    expiryAlerts: overdue(100),
    attention: {
      heldDeductions: rows.map((row) => ({
        ingredientId: row.ingredientId,
        name: row.name,
        cubes: 2,
        date: DATE,
        slot: 'morning',
      })),
      unrecordedReactions: rows.map((row) => ({
        ingredientId: row.ingredientId,
        name: row.name,
        date: DATE,
        slot: 'afternoon',
      })),
      ruleWarnings: rows.map((row) => ({
        code: 'FORBIDDEN_PAIRING',
        date: DATE,
        slot: null,
        ingredientNames: [row.name, row.name],
      })),
      weightMismatchedBatches: rows.map((row) => ({
        batchId: randomUUID(),
        ingredientId: row.ingredientId,
        name: row.name,
        cookedOn: DATE,
        remaining: 3,
        cubeWeightGram: 20,
        servingWeightGram: 10,
      })),
      planRunwayDays: null,
      planRunwayShort: true,
    },
  });
}

const sections = (blocks: SlackBlock[]): SectionBlock[] =>
  blocks.filter((block): block is SectionBlock => block.type === 'section');
const actionBlocks = (blocks: SlackBlock[]): ActionsBlock[] =>
  blocks.filter((block): block is ActionsBlock => block.type === 'actions');
const buttons = (blocks: SlackBlock[]): Button[] => actionBlocks(blocks).flatMap((block) => block.elements as Button[]);
const allText = (blocks: SlackBlock[]): string =>
  sections(blocks)
    .map((block) => block.text?.text ?? '')
    .join('\n');
const contextText = (blocks: SlackBlock[]): string =>
  blocks
    .filter((block): block is ContextBlock => block.type === 'context')
    .flatMap((block) => block.elements.map((element) => ('text' in element ? element.text : '')))
    .join('\n');
const stockTable = (blocks: SlackBlock[]): TextTableBlock | undefined =>
  blocks.find((block): block is TextTableBlock => block.type === 'table');
/** The table as the parent reads it, one array of cell texts per row, header first. */
const tableRows = (blocks: SlackBlock[]): string[][] =>
  stockTable(blocks)?.rows.map((row) => row.map((cell) => cell.text)) ?? [];

function stockRow(name: string, overrides: Partial<BriefStockRow> = {}): BriefStockRow {
  return {
    ingredientId: randomUUID(),
    name,
    total: 5,
    fresh: 5,
    overdue: 0,
    weightMismatched: 0,
    depletionDate: null,
    nextExpiry: null,
    ...overrides,
  };
}

describe('브리프 렌더링', () => {
  describe('재료가 100개여도 Block Kit 한계를 넘지 않는다', () => {
    const { blocks } = renderBrief(crowdedBrief());

    it('블록은 50개를 넘지 않는다', () => {
      expect(blocks.length).toBeLessThanOrEqual(MAX_BLOCKS);
    });

    it('어떤 section의 텍스트도 3000자를 넘지 않는다', () => {
      for (const block of sections(blocks)) {
        expect(block.text?.text.length ?? 0).toBeLessThanOrEqual(MAX_SECTION_TEXT);
      }
    });

    it('어떤 actions 블록도 요소 25개를 넘지 않는다', () => {
      for (const block of actionBlocks(blocks)) {
        expect(block.elements.length).toBeLessThanOrEqual(MAX_ACTION_ELEMENTS);
      }
    });

    it('한 블록 안에서 action_id가 겹치지 않는다', () => {
      for (const block of actionBlocks(blocks)) {
        const ids = (block.elements as Button[]).map((element) => element.action_id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    it('재고 표는 머리 행을 포함해 100행, 셀 합계 1만 자를 넘지 않는다', () => {
      const table = stockTable(blocks)!;
      expect(table.rows.length).toBeLessThanOrEqual(MAX_TABLE_ROWS);
      const characters = table.rows.flat().reduce((sum, cell) => sum + cell.text.length, 0);
      expect(characters).toBeLessThanOrEqual(MAX_TABLE_CHARACTERS);
    });

    it('표에서 잘라 낸 재료는 몇 개인지 표 아래에 적는다', () => {
      expect(contextText(blocks)).toContain('…외 1개 재료는 표에서 생략했습니다.');
    });

    it('폐기 버튼은 오래된 배치부터 25개만 싣고 나머지는 텍스트로 알린다', () => {
      const discards = buttons(blocks).filter(
        (button) => decodeAction(button.action_id!, button.value!)?.kind === 'discard',
      );
      expect(discards).toHaveLength(MAX_ACTION_ELEMENTS);
      expect(discards[0].text.text).toContain('2026-08-01');
      expect(JSON.stringify(blocks)).toContain('임계일이 지난 배치가 75개 더 있습니다');
    });
  });

  it('임계일이 지난 배치마다 폐기 버튼이 하나이고 값은 그 배치를 가리킨다', () => {
    const alerts = [
      ...overdue(3),
      { ...overdue(1)[0], stage: { kind: 'due_soon', daysLeft: 0 } } satisfies BriefExpiryAlert,
    ];
    const { blocks } = renderBrief(brief({ expiryAlerts: alerts }));

    const batchIds = buttons(blocks)
      .map((button) => decodeAction(button.action_id!, button.value!))
      .flatMap((action) => (action?.kind === 'discard' ? [action.batchId] : []));
    expect(batchIds.toSorted()).toEqual(
      alerts
        .slice(0, 3)
        .map((alert) => alert.batchId)
        .toSorted(),
    );
  });

  it('끼니마다 해동 전과 해동 후 미급여 버튼이 달리고 값이 되읽힌다', () => {
    const { blocks } = renderBrief(brief());

    const actions = buttons(blocks).map((button) => decodeAction(button.action_id!, button.value!));
    expect(actions).toEqual([
      { kind: 'no_feed', date: DATE, slot: 'morning', thawed: false },
      { kind: 'no_feed', date: DATE, slot: 'morning', thawed: true },
      { kind: 'no_feed', date: DATE, slot: 'afternoon', thawed: false },
      { kind: 'no_feed', date: DATE, slot: 'afternoon', thawed: true },
    ]);
  });

  it('이미 미급여로 기록된 끼니와 식단이 없는 끼니에는 미급여 버튼이 없다', () => {
    const { blocks } = renderBrief(
      brief({
        slots: [
          {
            slot: 'morning',
            mealTime: localTime('10:00'),
            meal: null,
            noFeed: { date: DATE, slot: 'morning', thawed: true, reason: '감기' },
          },
          { slot: 'afternoon', mealTime: localTime('15:00'), meal: null, noFeed: null },
        ],
      }),
    );

    expect(buttons(blocks)).toEqual([]);
    expect(allText(blocks)).toContain('미급여 기록됨(해동 후, 감기)');
    expect(allText(blocks)).toContain('식단 없음');
  });

  it('재고가 비어 있어도 렌더링된다', () => {
    const { text, blocks } = renderBrief(brief({ slots: [], dayNumber: null }));

    expect(text).toBe('2026-09-22 이유식 브리프');
    expect(allText(blocks)).toContain('*재고현황*\n재고가 없습니다.');
    expect(stockTable(blocks)).toBeUndefined();
  });

  it('알림 한 줄과 머리 블록에 날짜와 일차가 실린다', () => {
    const { text, blocks } = renderBrief(brief());

    expect(text).toBe('2026-09-22 이유식 브리프 · 12일차');
    expect(blocks[0]).toEqual({
      type: 'header',
      text: { type: 'plain_text', text: '2026-09-22 이유식 브리프 · 12일차' },
    } satisfies HeaderBlock);
  });

  describe('재고현황 표', () => {
    it('머리 행과 재료마다 한 행이고, 값이 없는 칸은 –다', () => {
      const { blocks } = renderBrief(
        brief({ stock: [stockRow('소고기', { total: 12, fresh: 10, overdue: 2 })] }),
      );

      expect(tableRows(blocks)).toEqual([
        ['재료', '합계', '가용', '임계 지남', '임계일', '소진 예상', '임계'],
        ['소고기', '12', '10', '2', '–', '–', '–'],
      ]);
    });

    it('숫자 칸도 raw_text로 보낸다. 모바일 앱이 raw_number 셀을 비워 두기 때문이다', () => {
      const { blocks } = renderBrief(brief({ stock: [stockRow('소고기', { total: 12 })] }));

      expect(stockTable(blocks)!.rows[1][1]).toEqual({ type: 'raw_text', text: '12' });
    });

    it('소진 예상일은 MM-DD로 줄이고 임계개수에 닿은 재료는 임계 칸에 그 개수를 적는다', () => {
      const cucumber = stockRow('오이', { total: 1, fresh: 1, depletionDate: localDate('2026-09-28') });
      const { blocks } = renderBrief(
        brief({
          stock: [cucumber],
          thresholdAlerts: [{ ingredientId: cucumber.ingredientId, name: '오이', total: 1, thresholdCubes: 3 }],
        }),
      );

      expect(tableRows(blocks)[1]).toEqual(['오이', '1', '1', '0', '–', '09-28', '3']);
    });

    it('소진 예상일이 빠른 재료, 임계개수에 닿은 재료, 임계일이 임박하거나 지난 재료, 나머지 순이다', () => {
      const threshold = stockRow('임계');
      const { blocks } = renderBrief(
        brief({
          stock: [
            stockRow('나머지'),
            stockRow('임박', {
              nextExpiry: { date: localDate('2026-09-24'), stage: { kind: 'due_soon', daysLeft: 2 } },
            }),
            threshold,
            stockRow('늦게 소진', { depletionDate: localDate('2026-10-05') }),
            stockRow('먼저 소진', { depletionDate: localDate('2026-09-25') }),
          ],
          thresholdAlerts: [{ ingredientId: threshold.ingredientId, name: '임계', total: 5, thresholdCubes: 6 }],
        }),
      );

      expect(tableRows(blocks).map(([name]) => name)).toEqual([
        '재료',
        '먼저 소진',
        '늦게 소진',
        '임계',
        '⏰ 임박',
        '나머지',
      ]);
    });

    it('재고가 0인 재료는 표에서 빼고 아래 한 줄에 이름만 적는다. 임계개수에 닿았으면 표에 남긴다', () => {
      const egg = stockRow('계란', { total: 0, fresh: 0 });
      const { blocks } = renderBrief(
        brief({
          stock: [
            stockRow('쌀'),
            stockRow('오이', { total: 0, fresh: 0 }),
            stockRow('땅콩버터', { total: 0, fresh: 0 }),
            egg,
          ],
          thresholdAlerts: [{ ingredientId: egg.ingredientId, name: '계란', total: 0, thresholdCubes: 2 }],
        }),
      );

      expect(tableRows(blocks).map(([name]) => name)).toEqual(['재료', '계란', '쌀']);
      expect(contextText(blocks)).toBe('재고 0: 오이, 땅콩버터');
    });

    it('재료가 전부 0이면 표 없이 재고가 없다고 말하고 이름을 적는다', () => {
      const { blocks } = renderBrief(brief({ stock: [stockRow('오이', { total: 0, fresh: 0 })] }));

      expect(stockTable(blocks)).toBeUndefined();
      expect(allText(blocks)).toContain('*재고현황*\n재고가 없습니다.');
      expect(contextText(blocks)).toBe('재고 0: 오이');
    });

    it('부족 예측은 브리프에 싣지 않는다. 소진 예상 칸이 대신하고 수량은 MCP가 답한다', () => {
      const row = stockRow('소고기');
      const { blocks } = renderBrief(
        brief({
          stock: [row],
          shortages: [
            {
              ingredientId: row.ingredientId,
              name: '소고기',
              plannedCubes: 20,
              firstShortageDate: localDate('2026-09-30'),
              shortfallCubes: 8,
            },
          ],
        }),
      );

      expect(JSON.stringify(blocks)).not.toContain('부족');
    });
  });

  describe('임계일 강조와 상비 재료', () => {
    it('임계일이 3일 안이거나 지난 재료는 재료 칸에 ⏰가 붙는다', () => {
      const { blocks } = renderBrief(
        brief({
          stock: [
            stockRow('여유', { nextExpiry: { date: localDate('2026-09-26'), stage: { kind: 'fresh' } } }),
            stockRow('임박', { nextExpiry: { date: localDate('2026-09-25'), stage: { kind: 'due_soon', daysLeft: 3 } } }),
            stockRow('지남', { nextExpiry: { date: localDate('2026-09-20'), stage: { kind: 'overdue', overdueDays: 2 } } }),
          ],
        }),
      );

      expect(tableRows(blocks).map(([name]) => name)).toEqual(['재료', '⏰ 임박', '⏰ 지남', '여유']);
    });

    it('임계일 칸은 가장 이른 배치의 임계일이고 배치가 없으면 –다', () => {
      const cucumber = stockRow('오이', { total: 0, fresh: 0 });
      const { blocks } = renderBrief(
        brief({
          stock: [stockRow('쌀', { nextExpiry: { date: localDate('2026-10-03'), stage: { kind: 'fresh' } } }), cucumber],
          thresholdAlerts: [{ ingredientId: cucumber.ingredientId, name: '오이', total: 0, thresholdCubes: 2 }],
        }),
      );

      expect(tableRows(blocks).map((row) => [row[0], row[4]])).toEqual([
        ['재료', '임계일'],
        ['오이', '–'],
        ['쌀', '10-03'],
      ]);
    });

    it('상비 재료는 표 아래 한 줄에 이름만 적힌다', () => {
      const { blocks } = renderBrief(
        brief({
          stock: [stockRow('쌀'), stockRow('오이', { total: 0, fresh: 0 })],
          pantryIngredients: [
            { ingredientId: randomUUID(), name: '땅콩버터' },
            { ingredientId: randomUUID(), name: '계란' },
            { ingredientId: randomUUID(), name: '밀가루' },
          ],
        }),
      );

      expect(tableRows(blocks).map(([name]) => name)).toEqual(['재료', '쌀']);
      expect(contextText(blocks)).toBe('재고 0: 오이\n상비: 땅콩버터, 계란, 밀가루');
    });

    it('임계일 목록은 없고 폐기 버튼은 재고 표 바로 뒤에 온다', () => {
      const alerts = overdue(2);
      const { blocks } = renderBrief(
        brief({ stock: [stockRow('쌀')], expiryAlerts: alerts, attention: { ...brief().attention, planRunwayShort: true } }),
      );

      const tableIndex = blocks.findIndex((block) => block.type === 'table');
      const discards = blocks[tableIndex + 1] as ActionsBlock;
      expect(discards.type).toBe('actions');
      expect((discards.elements as Button[]).map((button) => button.text.text)).toEqual([
        `폐기 완료: ${alerts[1].name} ${alerts[1].cookedOn}`,
        `폐기 완료: ${alerts[0].name} ${alerts[0].cookedOn}`,
      ]);
      expect(JSON.stringify(blocks)).not.toContain('임계일 알람');
    });
  });

  it('새 재료가 있으면 관찰 안내 문구가 들어간다', () => {
    const { blocks } = renderBrief(
      brief({ newIngredients: [{ ingredientId: randomUUID(), name: '완두콩', slot: 'morning', exposureNumber: 2 }] }),
    );

    expect(allText(blocks)).toContain('*새 재료 관찰 · 급여 후 반응을 관찰하세요*\n• 오전 2회차: 완두콩');
  });

  it('새 재료는 끼니와 회차가 같으면 한 줄에 모인다', () => {
    const entry = (name: string, exposureNumber: number) => ({
      ingredientId: randomUUID(),
      name,
      slot: 'morning' as const,
      exposureNumber,
    });
    const { blocks } = renderBrief(brief({ newIngredients: [entry('쌀', 1), entry('오트밀', 1), entry('달걀', 3)] }));

    expect(allText(blocks)).toContain('• 오전 1회차: 쌀, 오트밀\n• 오전 3회차: 달걀');
  });

  it('표 밖의 항목은 문장으로 실린다', () => {
    const ingredientId = randomUUID();
    const { blocks } = renderBrief(
      brief({
        stock: [
          {
            ingredientId,
            name: '소고기',
            total: 12,
            fresh: 10,
            overdue: 2,
            weightMismatched: 0,
            depletionDate: null,
            nextExpiry: null,
          },
        ],
        shortages: [
          {
            ingredientId,
            name: '소고기',
            plannedCubes: 20,
            firstShortageDate: localDate('2026-09-30'),
            shortfallCubes: 8,
          },
        ],
        thresholdAlerts: [{ ingredientId, name: '오이', total: 1, thresholdCubes: 3 }],
        attention: {
          heldDeductions: [{ ingredientId, name: '소고기', cubes: 1, date: DATE, slot: null }],
          unrecordedReactions: [{ ingredientId, name: '완두콩', date: DATE, slot: 'morning' }],
          ruleWarnings: [
            { code: 'REACTED_INGREDIENT_PLANNED', date: DATE, slot: 'afternoon', ingredientNames: ['달걀'] },
          ],
          weightMismatchedBatches: [],
          planRunwayDays: 5,
          planRunwayShort: true,
        },
        slots: [
          {
            slot: 'morning',
            mealTime: localTime('10:00'),
            meal: { menuName: null, toppingNames: ['R&D <죽>'], memo: null, fed: true, corrected: true },
            noFeed: null,
          },
        ],
      }),
    );

    const text = allText(blocks);
    expect(text).toContain('재고 부족으로 보류된 차감: 소고기 1개 (2026-09-22)');
    expect(text).toContain('반응 미기록: 완두콩 (2026-09-22 오전)');
    expect(text).toContain('반응 있었던 재료가 식단에 있음: 달걀 (2026-09-22 오후)');
    expect(text).toContain('식단이 5일 남았습니다');
    expect(text).toContain('R&amp;D &lt;죽&gt; (급여 완료, 실제 급여로 수정됨)');
  });
});

describe('브리프 v4 페이로드', () => {
  // 레이아웃이 바뀌면 이 파일이 바뀐다. 그때 dailyBriefTemplate.version도 올렸는지 본다(ADR 0007).
  it('2026-09-26 운영 브리프와 같은 모양의 입력이 고정된 페이로드를 낸다', async () => {
    const id = (n: number) => `0199a1b2-c3d4-7e5f-8a9b-${String(n).padStart(12, '0')}`;
    const row = (
      n: number,
      name: string,
      total: number,
      fresh: number,
      overdue: number,
      depletion: string | null,
      nextExpiry: BriefStockRow['nextExpiry'] = null,
    ) => ({
      ingredientId: id(n),
      name,
      total,
      fresh,
      overdue,
      weightMismatched: 0,
      depletionDate: depletion === null ? null : localDate(depletion),
      nextExpiry,
    });
    const discard = (
      n: number,
      name: string,
      cookedOn: string,
      expiryDate: string,
      remaining: number,
      overdueDays: number,
    ) => ({
      batchId: id(100 + n),
      ingredientId: id(n),
      name,
      cookedOn: localDate(cookedOn),
      expiryDate: localDate(expiryDate),
      remaining,
      stage: { kind: 'overdue' as const, overdueDays },
    });

    const message = renderBrief(
      brief({
        date: localDate('2026-09-26'),
        dayNumber: 27,
        slots: [
          {
            slot: 'morning',
            mealTime: localTime('10:00'),
            meal: {
              menuName: '쌀오트밀죽',
              toppingNames: ['소고기', '청경채', '단호박'],
              memo: null,
              fed: true,
              corrected: false,
            },
            noFeed: null,
          },
        ],
        newIngredients: [
          { ingredientId: id(1), name: '쌀', slot: 'morning', exposureNumber: 1 },
          { ingredientId: id(2), name: '오트밀', slot: 'morning', exposureNumber: 1 },
        ],
        stock: [
          row(1, '쌀', 5, 5, 0, '2026-10-01', { date: localDate('2026-10-08'), stage: { kind: 'fresh' } }),
          row(2, '오트밀', 15, 15, 0, null, { date: localDate('2026-09-28'), stage: { kind: 'due_soon', daysLeft: 2 } }),
          row(3, '소고기', 2, 0, 2, '2026-09-28', { date: localDate('2026-09-16'), stage: { kind: 'overdue', overdueDays: 10 } }),
          row(4, '브로콜리', 3, 0, 3, '2026-09-30', { date: localDate('2026-09-18'), stage: { kind: 'overdue', overdueDays: 8 } }),
          row(5, '당근', 0, 0, 0, null),
          row(6, '오이', 0, 0, 0, null),
        ],
        pantryIngredients: [{ ingredientId: id(7), name: '계란' }],
        thresholdAlerts: [{ ingredientId: id(6), name: '오이', total: 0, thresholdCubes: 2 }],
        expiryAlerts: [
          discard(3, '소고기', '2026-09-02', '2026-09-16', 2, 10),
          discard(4, '브로콜리', '2026-09-04', '2026-09-18', 3, 8),
        ],
      }),
    );

    await expect(`${JSON.stringify(message, null, 2)}\n`).toMatchFileSnapshot('./__snapshots__/daily-brief.v4.json');
  });
});
