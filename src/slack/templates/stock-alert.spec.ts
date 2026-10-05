import type { ContextBlock, HeaderBlock, SectionBlock } from '@slack/types';
import { BriefStockAlertItem } from '../../application/daily-brief.js';
import { localDate } from '../../domain/shared/local-date.js';
import { MAX_BLOCKS, MAX_SECTION_TEXT, SlackBlock } from './blocks.js';
import { stockAlertTemplate } from './stock-alert.js';

const DATE = localDate('2026-10-05');

const id = (n: number): string => `0199a1b2-c3d4-7e5f-8a9b-${String(n).padStart(12, '0')}`;

function item(n: number, name: string, overrides: Partial<BriefStockAlertItem> = {}): BriefStockAlertItem {
  return {
    ingredientId: id(n),
    name,
    total: 2,
    thresholdCubes: null,
    firstShortageDate: localDate('2026-10-08'),
    daysUntilShortage: 3,
    horizonShortfallCubes: 4,
    urgency: 'upcoming',
    ...overrides,
  };
}

const lowStock = (n: number, name: string, overrides: Partial<BriefStockAlertItem> = {}): BriefStockAlertItem =>
  item(n, name, {
    thresholdCubes: 4,
    firstShortageDate: null,
    daysUntilShortage: null,
    horizonShortfallCubes: 0,
    urgency: 'low_stock',
    ...overrides,
  });

const render = (items: readonly BriefStockAlertItem[]) =>
  stockAlertTemplate.render({ date: DATE, alert: { horizonDays: 7, items } });

const headerText = (blocks: SlackBlock[]): string => (blocks[0] as HeaderBlock).text.text;
const sections = (blocks: SlackBlock[]): string[] =>
  blocks.filter((block): block is SectionBlock => block.type === 'section').map((block) => block.text?.text ?? '');

/** 운영 데이터와 같은 모양: 내일 부족 하나, 7일 안 부족 둘, 임계개수 이하 둘. */
const FIXTURE: readonly BriefStockAlertItem[] = [
  item(1, '소고기', {
    total: 1,
    firstShortageDate: localDate('2026-10-06'),
    daysUntilShortage: 1,
    horizonShortfallCubes: 6,
    urgency: 'urgent',
  }),
  item(2, '브로콜리', { total: 2, firstShortageDate: localDate('2026-10-08'), daysUntilShortage: 3, horizonShortfallCubes: 3 }),
  item(3, '당근', { total: 3, firstShortageDate: localDate('2026-10-11'), daysUntilShortage: 6, horizonShortfallCubes: 1 }),
  lowStock(4, '단호박', { total: 3, firstShortageDate: localDate('2026-10-20'), daysUntilShortage: 15 }),
  lowStock(5, '오트밀', { total: 4 }),
];

describe('재고 알람 렌더링', () => {
  it('머리는 조리 필요 건수이고 임계개수 이하는 세지 않는다', () => {
    expect(headerText(render(FIXTURE).blocks)).toBe('재고 알람 · 조리 필요 3건');
  });

  it('조리가 필요한 재료가 없으면 머리가 임계개수 이하 건수다', () => {
    const { blocks } = render([lowStock(1, '오트밀'), lowStock(2, '쌀')]);

    expect(headerText(blocks)).toBe('재고 알람 · 임계개수 이하 2건');
    expect(sections(blocks)).toEqual(['*임계개수 이하*\n오트밀 2개, 쌀 2개']);
  });

  it('오늘·내일 부족과 7일 안에 부족이 다른 묶음이고 항목이 없는 묶음은 블록이 없다', () => {
    expect(sections(render(FIXTURE).blocks).map((text) => text.split('\n')[0])).toEqual([
      '*오늘·내일 부족*',
      '*7일 안에 부족*',
      '*임계개수 이하*',
    ]);
    expect(sections(render([item(1, '당근')]).blocks).map((text) => text.split('\n')[0])).toEqual(['*7일 안에 부족*']);
  });

  it('이미 지난 날, 오늘, 내일, 그 뒤가 각각 다른 문구다', () => {
    const { blocks } = render([
      item(1, '가', { firstShortageDate: localDate('2026-10-03'), daysUntilShortage: -2, urgency: 'urgent' }),
      item(2, '나', { firstShortageDate: DATE, daysUntilShortage: 0, urgency: 'urgent' }),
      item(3, '다', { firstShortageDate: localDate('2026-10-06'), daysUntilShortage: 1, urgency: 'urgent' }),
      item(4, '라', { firstShortageDate: localDate('2026-10-09'), daysUntilShortage: 4 }),
    ]);

    expect(sections(blocks).join('\n')).toBe(
      [
        '*오늘·내일 부족*',
        '• 가  재고 2개 · 10-03부터 이미 부족 · 7일 안에 4개 부족',
        '• 나  재고 2개 · 오늘부터 부족 · 7일 안에 4개 부족',
        '• 다  재고 2개 · 내일(10-06)부터 부족 · 7일 안에 4개 부족',
        '*7일 안에 부족*',
        '• 라  재고 2개 · 10-09부터(D-4) · 7일 안에 4개 부족',
      ].join('\n'),
    );
  });

  it('임계개수 이하는 한 줄에 쉼표로 잇는다', () => {
    expect(sections(render(FIXTURE).blocks).at(-1)).toBe('*임계개수 이하*\n단호박 3개(10-20부터), 오트밀 4개');
  });

  it('알림에 뜨는 한 줄은 첫 항목과 나머지 건수다', () => {
    expect(render(FIXTURE).text).toBe('재고 알람: 소고기 내일부터 부족 외 4건');
    expect(render([item(1, '당근')]).text).toBe('재고 알람: 당근 10-08부터 부족');
    expect(render([item(1, '당근', { firstShortageDate: localDate('2026-10-04'), daysUntilShortage: -1, urgency: 'urgent' })]).text).toBe(
      '재고 알람: 당근 이미 부족',
    );
    expect(render([lowStock(1, '오트밀'), lowStock(2, '쌀')]).text).toBe('재고 알람: 임계개수 이하 2건');
  });

  it('재료 이름의 &, <, >는 이스케이프된다', () => {
    const { text, blocks } = render([item(1, 'R&D <죽>'), lowStock(2, 'a>b')]);

    expect(text).toBe('재고 알람: R&amp;D &lt;죽&gt; 10-08부터 부족 외 1건');
    expect(sections(blocks).join('\n')).toContain('• R&amp;D &lt;죽&gt;  재고');
    expect(sections(blocks).join('\n')).toContain('a&gt;b 2개');
  });

  it('맨 끝은 입고를 등록하면 빠진다는 안내이고 버튼은 없다', () => {
    const { blocks } = render(FIXTURE);

    expect(blocks.at(-1)).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '조리해 입고를 등록하면 다음 알람에서 빠집니다.' }],
    } satisfies ContextBlock);
    expect(blocks.some((block) => block.type === 'actions')).toBe(false);
  });

  it('항목이 아주 많아도 블록 한도와 section 길이 한도를 넘지 않는다', () => {
    const name = (index: number) => `아주 긴 이름을 가진 재료 번호 ${index}`;
    const { blocks } = render([
      ...Array.from({ length: 200 }, (_, index) => item(index, name(index), { daysUntilShortage: 1, urgency: 'urgent' })),
      ...Array.from({ length: 200 }, (_, index) => item(200 + index, name(index))),
      ...Array.from({ length: 200 }, (_, index) => lowStock(400 + index, name(index))),
    ]);

    expect(blocks.length).toBeLessThanOrEqual(MAX_BLOCKS);
    for (const text of sections(blocks)) expect(text.length).toBeLessThanOrEqual(MAX_SECTION_TEXT);
    expect(sections(blocks)[0]).toMatch(/…외 \d+줄 생략$/);
  });
});

describe(`재고 알람 v${stockAlertTemplate.version} 페이로드`, () => {
  // 레이아웃이 바뀌면 이 파일이 바뀐다. 그때 stockAlertTemplate.version도 올렸는지 본다(ADR 0007).
  it('내일 부족, 7일 안 부족, 임계개수 이하가 섞인 입력이 고정된 페이로드를 낸다', async () => {
    const message = render(FIXTURE);

    await expect(`${JSON.stringify(message, null, 2)}\n`).toMatchFileSnapshot(
      `./__snapshots__/stock-alert.v${stockAlertTemplate.version}.json`,
    );
  });
});
