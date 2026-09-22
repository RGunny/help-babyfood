import type { CallToolResult } from '@modelcontextprotocol/server';
import { ApplicationError } from '../application/errors.js';
import { DomainError } from '../domain/errors.js';
import { ok, toolResult } from './tool-result.js';

/** The first block is always text; the union the SDK declares allows images we never produce. */
function body(result: CallToolResult): string {
  const block = result.content[0];
  if (block === undefined || block.type !== 'text') throw new Error('텍스트 블록이 아닙니다');
  return block.text;
}

describe('도구 결과', () => {
  it('성공하면 값을 JSON 본문으로 싣는다', async () => {
    const result = await toolResult(async () => ({ batchId: 'b1', cubes: 6 }));

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(body(result))).toEqual({ batchId: 'b1', cubes: 6 });
  });

  it('ok는 같은 모양을 만든다', () => {
    expect(JSON.parse(body(ok({ a: 1 })))).toEqual({ a: 1 });
  });

  it('도메인 오류는 코드와 함께 도구 오류로 돌아온다', async () => {
    const result = await toolResult(async () => {
      throw new DomainError('UNKNOWN_INGREDIENT', '등록되지 않은 재료입니다: 당근');
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: 'UNKNOWN_INGREDIENT',
      message: '등록되지 않은 재료입니다: 당근',
    });
    expect(body(result)).toContain('UNKNOWN_INGREDIENT');
  });

  it('애플리케이션 오류도 같은 모양이다', async () => {
    const result = await toolResult(async () => {
      throw new ApplicationError('IDEMPOTENCY_KEY_REUSED', '같은 멱등키에 다른 요청이 왔습니다: k1');
    });

    expect(result.structuredContent).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('그 밖의 예외는 잡지 않고 던진다', async () => {
    // 모델이 고칠 수 없는 실패를 도구 오류로 돌려주면 같은 호출을 되풀이하게 만든다.
    await expect(
      toolResult(async () => {
        throw new Error('connection terminated unexpectedly');
      }),
    ).rejects.toThrow('connection terminated unexpectedly');
  });
});
