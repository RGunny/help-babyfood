import type { ContextBlock, HeaderBlock, SectionBlock } from '@slack/types';
import { BriefStockAlertItem } from '../../application/daily-brief.js';
import { localDate } from '../../domain/shared/local-date.js';
import { MAX_BLOCKS, SlackBlock } from './blocks.js';
import { stockAlertTemplate } from './stock-alert.js';
import { MAX_TABLE_CHARACTERS, MAX_TABLE_ROWS, TextTableBlock } from './table.js';

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
const titles = (blocks: SlackBlock[]): string[] =>
  blocks.filter((block): block is SectionBlock => block.type === 'section').map((block) => block.text?.text ?? '');
const tables = (blocks: SlackBlock[]): TextTableBlock[] =>
  blocks.filter((block): block is TextTableBlock => block.type === 'table');
/** The tables as the parent reads them, one array of cell texts per row, header first. */
const tableRows = (blocks: SlackBlock[]): string[][][] =>
  tables(blocks).map((block) => block.rows.map((row) => row.map((cell) => cell.text)));

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

  it('조리가 필요한 재료가 없으면 머리가 임계개수 이하 건수이고 표는 임계개수 이하 하나다', () => {
    const { blocks } = render([lowStock(1, '오트밀'), lowStock(2, '쌀')]);

    expect(headerText(blocks)).toBe('재고 알람 · 임계개수 이하 2건');
    expect(titles(blocks)).toEqual(['*임계개수 이하 · 7일 안에는 부족 없음*']);
    expect(tableRows(blocks)).toEqual([
      [
        ['재료', '부족 시작', '재고'],
        ['오트밀', '–', '2'],
        ['쌀', '–', '2'],
      ],
    ]);
  });

  it('조리 필요와 임계개수 이하가 다른 표이고 항목이 없는 묶음은 제목도 표도 없다', () => {
    expect(titles(render(FIXTURE).blocks)).toEqual(['*조리 필요*', '*임계개수 이하 · 7일 안에는 부족 없음*']);
    expect(tables(render(FIXTURE).blocks)).toHaveLength(2);

    const onlyToCook = render([item(1, '당근')]).blocks;
    expect(titles(onlyToCook)).toEqual(['*조리 필요*']);
    expect(tables(onlyToCook)).toHaveLength(1);
  });

  it('조리 필요 표는 재료마다 한 행이고 부족 시작, 재고, 7일 부족 수량을 칸으로 나눈다', () => {
    expect(tableRows(render(FIXTURE).blocks)[0]).toEqual([
      ['재료', '부족 시작', '재고', '7일 부족'],
      ['🚨 소고기', '10-06 화 · 내일', '1', '6'],
      ['브로콜리', '10-08 목 · D-3', '2', '3'],
      ['당근', '10-11 일 · D-6', '3', '1'],
    ]);
  });

  it('부족 시작 칸은 날짜와 요일 뒤에 지남, 오늘, 내일, D-n을 붙인다', () => {
    const { blocks } = render([
      item(1, '가', { firstShortageDate: localDate('2026-10-03'), daysUntilShortage: -2, urgency: 'urgent' }),
      item(2, '나', { firstShortageDate: DATE, daysUntilShortage: 0, urgency: 'urgent' }),
      item(3, '다', { firstShortageDate: localDate('2026-10-06'), daysUntilShortage: 1, urgency: 'urgent' }),
      item(4, '라', { firstShortageDate: localDate('2026-10-09'), daysUntilShortage: 4 }),
    ]);

    expect(tableRows(blocks)[0].slice(1).map(([name, when]) => [name, when])).toEqual([
      ['🚨 가', '10-03 토 · 지남'],
      ['🚨 나', '10-05 월 · 오늘'],
      ['🚨 다', '10-06 화 · 내일'],
      ['라', '10-09 금 · D-4'],
    ]);
  });

  it('임계개수 이하 표는 부족 시작일이 있으면 날짜와 요일을, 없으면 빈 칸을 보인다', () => {
    expect(tableRows(render(FIXTURE).blocks)[1]).toEqual([
      ['재료', '부족 시작', '재고'],
      ['단호박', '10-20 화', '3'],
      ['오트밀', '–', '4'],
    ]);
  });

  it('숫자 칸도 raw_text이고 오른쪽 정렬이다', () => {
    const [toCook] = tables(render(FIXTURE).blocks);

    expect(toCook.rows[1][2]).toEqual({ type: 'raw_text', text: '1' });
    expect(toCook.column_settings?.map((column) => column.align)).toEqual(['left', 'left', 'right', 'right']);
  });

  it('알림에 뜨는 한 줄은 첫 항목과 나머지 건수다', () => {
    expect(render(FIXTURE).text).toBe('재고 알람: 소고기 내일부터 부족 외 4건');
    expect(render([item(1, '당근')]).text).toBe('재고 알람: 당근 10-08부터 부족');
    expect(render([item(1, '당근', { firstShortageDate: localDate('2026-10-04'), daysUntilShortage: -1, urgency: 'urgent' })]).text).toBe(
      '재고 알람: 당근 이미 부족',
    );
    expect(render([lowStock(1, '오트밀'), lowStock(2, '쌀')]).text).toBe('재고 알람: 임계개수 이하 2건');
  });

  it('재료 이름의 &, <, >는 알림 한 줄에서 이스케이프되고 raw_text 칸에는 그대로 실린다', () => {
    const { text, blocks } = render([item(1, 'R&D <죽>'), lowStock(2, 'a>b')]);

    expect(text).toBe('재고 알람: R&amp;D &lt;죽&gt; 10-08부터 부족 외 1건');
    expect(tableRows(blocks)[0][1][0]).toBe('R&D <죽>');
    expect(tableRows(blocks)[1][1][0]).toBe('a>b');
  });

  it('맨 끝은 입고를 등록하면 빠진다는 안내이고 버튼은 없다', () => {
    const { blocks } = render(FIXTURE);

    expect(blocks.at(-1)).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '조리해 입고를 등록하면 다음 알람에서 빠집니다.' }],
    } satisfies ContextBlock);
    expect(blocks.some((block) => block.type === 'actions')).toBe(false);
  });

  it('항목이 아주 많아도 블록 한도와 표 한도를 넘지 않고 생략한 재료 수를 표 아래에 적는다', () => {
    const name = (index: number) => `아주 긴 이름을 가진 재료 번호 ${index}`;
    const { blocks } = render([
      ...Array.from({ length: 200 }, (_, index) => item(index, name(index), { daysUntilShortage: 1, urgency: 'urgent' })),
      ...Array.from({ length: 200 }, (_, index) => item(200 + index, name(index))),
      ...Array.from({ length: 200 }, (_, index) => lowStock(400 + index, name(index))),
    ]);

    expect(blocks.length).toBeLessThanOrEqual(MAX_BLOCKS);
    for (const block of tables(blocks)) {
      expect(block.rows.length).toBeLessThanOrEqual(MAX_TABLE_ROWS);
      expect(block.rows.flat().reduce((sum, cell) => sum + cell.text.length, 0)).toBeLessThanOrEqual(MAX_TABLE_CHARACTERS);
    }
    const notes = blocks
      .filter((block): block is ContextBlock => block.type === 'context')
      .map((block) => (block.elements[0] as { text: string }).text);
    expect(notes).toEqual([
      '…외 301개 재료는 표에서 생략했습니다.',
      '…외 101개 재료는 표에서 생략했습니다.',
      '조리해 입고를 등록하면 다음 알람에서 빠집니다.',
    ]);
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
