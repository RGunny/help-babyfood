import { createHmac } from 'node:crypto';
import { SIGNATURE_TOLERANCE_SECONDS, verifySlackSignature } from './signature.js';

const SECRET = '8f742231b10e8888abcd99yyyzzz85a5';
const NOW = new Date('2026-09-22T00:30:00Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const BODY = 'payload=%7B%22type%22%3A%22block_actions%22%7D';

function sign(body: string, timestamp: number, secret = SECRET): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
}

function verify(overrides: Partial<Parameters<typeof verifySlackSignature>[0]> = {}): boolean {
  return verifySlackSignature({
    signingSecret: SECRET,
    signature: sign(BODY, NOW_SECONDS),
    timestamp: String(NOW_SECONDS),
    rawBody: Buffer.from(BODY),
    now: NOW,
    ...overrides,
  });
}

describe('Slack 서명 검증', () => {
  it('올바른 서명은 통과한다', () => {
    expect(verify()).toBe(true);
  });

  it('본문이 한 글자만 바뀌어도 거부한다', () => {
    expect(verify({ rawBody: Buffer.from(`${BODY}x`) })).toBe(false);
  });

  it('서명 비밀이 다르면 거부한다', () => {
    expect(verify({ signature: sign(BODY, NOW_SECONDS, 'another-secret') })).toBe(false);
  });

  it('타임스탬프가 5분보다 과거면 거부한다', () => {
    const old = NOW_SECONDS - SIGNATURE_TOLERANCE_SECONDS - 1;
    expect(verify({ timestamp: String(old), signature: sign(BODY, old) })).toBe(false);
  });

  it('타임스탬프가 5분보다 미래여도 거부한다', () => {
    const ahead = NOW_SECONDS + SIGNATURE_TOLERANCE_SECONDS + 1;
    expect(verify({ timestamp: String(ahead), signature: sign(BODY, ahead) })).toBe(false);
  });

  it('5분 경계 안쪽의 타임스탬프는 통과한다', () => {
    const edge = NOW_SECONDS - SIGNATURE_TOLERANCE_SECONDS;
    expect(verify({ timestamp: String(edge), signature: sign(BODY, edge) })).toBe(true);
  });

  it('v0= 접두가 없으면 거부한다', () => {
    expect(verify({ signature: sign(BODY, NOW_SECONDS).slice('v0='.length) })).toBe(false);
  });

  it('서명 헤더가 없으면 거부한다', () => {
    expect(verify({ signature: undefined })).toBe(false);
  });

  it('타임스탬프 헤더가 없으면 거부한다', () => {
    expect(verify({ timestamp: undefined })).toBe(false);
  });

  it('숫자가 아닌 타임스탬프는 거부한다', () => {
    expect(verify({ timestamp: 'yesterday' })).toBe(false);
  });

  it('길이가 다른 서명에도 던지지 않고 거짓을 돌려준다', () => {
    expect(() => verify({ signature: 'v0=short' })).not.toThrow();
    expect(verify({ signature: 'v0=short' })).toBe(false);
    expect(verify({ signature: `${sign(BODY, NOW_SECONDS)}00` })).toBe(false);
  });

  it('기준 문자열은 받은 바이트 그대로다', () => {
    // 한글이 든 본문도 URL 인코딩 전후를 오가지 않고 받은 바이트로 계산한다.
    const body = 'payload=%7B%22text%22%3A%22%EC%9D%B4%EC%9C%A0%EC%8B%9D%22%7D';
    expect(verify({ rawBody: Buffer.from(body), signature: sign(body, NOW_SECONDS) })).toBe(true);
  });
});
