import { escapeMarkdown, heading, markdownList, markdownTable } from './markdown.js';

describe('캔버스 마크다운', () => {
  it('표를 깨뜨리거나 서식을 시작하는 글자를 이스케이프하고 줄바꿈은 공백으로 바꾼다', () => {
    expect(escapeMarkdown('a|b *c* _d_ ~e~ `f` \\g\nh')).toBe('a\\|b \\*c\\* \\_d\\_ \\~e\\~ \\`f\\` \\\\g h');
  });

  it('표는 머리 행, 구분선, 본문 행 순이고 짧은 행은 채우고 긴 행은 자른다', () => {
    expect(markdownTable(['재료', '합계'], [['쌀'], ['오트밀', '15', '남는 칸']])).toBe(
      ['| 재료 | 합계 |', '|--|--|', '| 쌀 |  |', '| 오트밀 | 15 |'].join('\n'),
    );
  });

  it('목록과 제목', () => {
    expect(markdownList(['하나', '둘'])).toBe('- 하나\n- 둘');
    expect(heading(2, '재고')).toBe('## 재고');
  });
});
