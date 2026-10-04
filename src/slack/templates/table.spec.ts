import { EMPTY_CELL, MAX_TABLE_CHARACTERS, MAX_TABLE_ROWS, TableColumn, table, textCell } from './table.js';

interface Row {
  readonly name: string;
  readonly count: number | null;
}

const COLUMNS: readonly TableColumn<Row>[] = [
  { header: '이름', wrapped: true, cell: (row) => row.name },
  { header: '개수', align: 'right', cell: (row) => row.count },
];

const rows = (count: number, name = (index: number) => `재료 ${index}`): Row[] =>
  Array.from({ length: count }, (_, index) => ({ name: name(index), count: index }));

describe('표', () => {
  it('숫자 칸도 raw_text다. 모바일 앱이 raw_number 셀을 그리지 않는다', () => {
    expect(table(COLUMNS, [{ name: '쌀', count: 3 }]).block.rows[1][1]).toEqual({ type: 'raw_text', text: '3' });
  });

  it('raw_text는 빈 문자열을 받지 않으므로 빈 칸은 –로 채운다', () => {
    expect(textCell('')).toEqual({ type: 'raw_text', text: EMPTY_CELL });
    expect(table(COLUMNS, [{ name: '쌀', count: null }]).block.rows[1][1]).toEqual({
      type: 'raw_text',
      text: EMPTY_CELL,
    });
  });

  it('첫 행은 머리 행이고 열 설정은 열마다 하나다', () => {
    const { block } = table(COLUMNS, rows(1));

    expect(block.rows[0]).toEqual([textCell('이름'), textCell('개수')]);
    expect(block.column_settings).toEqual([
      { align: 'left', is_wrapped: true },
      { align: 'right', is_wrapped: false },
    ]);
  });

  it('머리 행을 포함해 100행에서 자르고 뺀 행 수를 돌려준다', () => {
    const { block, omitted } = table(COLUMNS, rows(150));

    expect(block.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(omitted).toBe(150 - (MAX_TABLE_ROWS - 1));
  });

  it('셀 합계가 1만 자를 넘기 전에 자른다', () => {
    const { block, omitted } = table(
      COLUMNS,
      rows(50, (index) => `${'가'.repeat(300)}${index}`),
    );

    const characters = block.rows.flat().reduce((sum, cell) => sum + cell.text.length, 0);
    expect(characters).toBeLessThanOrEqual(MAX_TABLE_CHARACTERS);
    expect(omitted).toBeGreaterThan(0);
    expect(block.rows.length - 1 + omitted).toBe(50);
  });

  it('한 행이 넘치면 뒤의 짧은 행도 싣지 않는다. 순서를 건너뛰어 끼워 넣지 않는다', () => {
    const input: Row[] = [
      { name: '가'.repeat(9_990), count: 1 },
      { name: '나'.repeat(20), count: 2 },
      { name: '다', count: 3 },
    ];

    const { block, omitted } = table(COLUMNS, input);

    expect(block.rows.map(([name]) => name.text[0])).toEqual(['이', '가']);
    expect(omitted).toBe(2);
  });
});
