import { randomUUID } from 'node:crypto';
import type { ActionsBlock, Button, KnownBlock, SectionBlock } from '@slack/types';
import { BriefExpiryAlert, BriefStockRow, DailyBrief } from '../../application/daily-brief.js';
import { localDate } from '../../domain/shared/local-date.js';
import { localTime } from '../../domain/shared/local-time.js';
import { decodeAction } from '../actions.js';
import { MAX_ACTION_ELEMENTS, MAX_BLOCKS, MAX_SECTION_TEXT, renderBrief } from './render-brief.js';

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
    pendingDiscard: 2,
    weightMismatched: 1,
    depletionDate: localDate('2026-10-01'),
  }));
}

function pendingDiscard(count: number): BriefExpiryAlert[] {
  return Array.from({ length: count }, (_, index) => ({
    batchId: randomUUID(),
    ingredientId: randomUUID(),
    name: `재료 ${index}`,
    // 뒤에서부터 오래된 순으로 둔다. 렌더러가 조리일로 다시 정렬하는지 보기 위해서다.
    cookedOn: localDate(`2026-08-${String(30 - (index % 30)).padStart(2, '0')}`),
    expiryDate: localDate('2026-09-10'),
    remaining: 3,
    stage: { kind: 'pending_discard', overdueDays: 12 },
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
    expiryAlerts: pendingDiscard(100),
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

const sections = (blocks: KnownBlock[]): SectionBlock[] =>
  blocks.filter((block): block is SectionBlock => block.type === 'section');
const actionBlocks = (blocks: KnownBlock[]): ActionsBlock[] =>
  blocks.filter((block): block is ActionsBlock => block.type === 'actions');
const buttons = (blocks: KnownBlock[]): Button[] => actionBlocks(blocks).flatMap((block) => block.elements as Button[]);
const allText = (blocks: KnownBlock[]): string =>
  sections(blocks)
    .map((block) => block.text?.text ?? '')
    .join('\n');

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

    it('잘라 낸 재고 줄은 몇 줄인지 적는다', () => {
      const stock = sections(blocks).find((block) => block.text?.text.startsWith('*재고현황*'));
      expect(stock?.text?.text).toMatch(/…외 \d+줄 생략$/);
    });

    it('폐기 버튼은 오래된 배치부터 25개만 싣고 나머지는 텍스트로 알린다', () => {
      const discards = buttons(blocks).filter(
        (button) => decodeAction(button.action_id!, button.value!)?.kind === 'discard',
      );
      expect(discards).toHaveLength(MAX_ACTION_ELEMENTS);
      expect(discards[0].text.text).toContain('2026-08-01');
      expect(JSON.stringify(blocks)).toContain('폐기 대기 배치가 75개 더 있습니다');
    });
  });

  it('폐기 대기 배치마다 폐기 버튼이 하나이고 값은 그 배치를 가리킨다', () => {
    const alerts = [
      ...pendingDiscard(3),
      { ...pendingDiscard(1)[0], stage: { kind: 'due_today' } } satisfies BriefExpiryAlert,
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
  });

  it('알림 한 줄에는 날짜와 일차가 실린다', () => {
    expect(renderBrief(brief()).text).toBe('2026-09-22 이유식 브리프 · 12일차');
  });

  it('새 재료가 있으면 관찰 안내 문구가 들어간다', () => {
    const { blocks } = renderBrief(
      brief({ newIngredients: [{ ingredientId: randomUUID(), name: '완두콩', slot: 'morning', exposureNumber: 2 }] }),
    );

    expect(allText(blocks)).toContain('완두콩 (오전, 2회차) 급여 후 반응을 관찰하세요');
  });

  it('브리프의 각 항목이 문장으로 실린다', () => {
    const ingredientId = randomUUID();
    const { blocks } = renderBrief(
      brief({
        stock: [
          {
            ingredientId,
            name: '소고기',
            total: 12,
            fresh: 10,
            pendingDiscard: 2,
            weightMismatched: 0,
            depletionDate: null,
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
        expiryAlerts: [
          { ...pendingDiscard(1)[0], name: '애호박', stage: { kind: 'due_tomorrow' } },
          { ...pendingDiscard(1)[0], name: '당근', stage: { kind: 'fresh' } },
        ],
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
    expect(text).toContain('소고기 12개 (가용 10, 폐기 대기 2)');
    expect(text).toContain('소고기: 2026-09-30부터 8개 부족');
    expect(text).toContain('오이 1개 (임계 3개)');
    expect(text).toContain('내일 기한');
    expect(text).toContain('기한 여유');
    expect(text).toContain('재고 부족으로 보류된 차감: 소고기 1개 (2026-09-22)');
    expect(text).toContain('반응 미기록: 완두콩 (2026-09-22 오전)');
    expect(text).toContain('반응 있었던 재료가 식단에 있음: 달걀 (2026-09-22 오후)');
    expect(text).toContain('식단이 5일 남았습니다');
    expect(text).toContain('R&amp;D &lt;죽&gt; (급여 완료, 실제 급여로 수정됨)');
  });
});
