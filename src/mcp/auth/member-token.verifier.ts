import type { OAuthTokenVerifier } from '@modelcontextprotocol/express';
import { type AuthInfo, OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { ClockPort } from '../../application/ports/clock.port.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { hashToken, looksLikeToken } from './member-token.js';

/** The one scope. Every tool needs it, and nothing distinguishes the tools yet. */
export const MCP_SCOPE = 'mcp';

/**
 * Turns a bearer token into the member that holds it.
 *
 * This is the whole of our authentication, and it is deliberately the only part that is ours: it
 * sits behind `requireBearerAuth`, which is the OAuth resource-server gate from the SDK. Moving to
 * a real authorization server later replaces the body of this method — verify a JWT instead of
 * looking up a hash — and nothing above it changes.
 */
export class MemberTokenVerifier implements OAuthTokenVerifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!looksLikeToken(token)) throw invalid();
    const record = await this.prisma.memberToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, householdId: true, memberId: true, expiresAt: true, revokedAt: true },
    });
    // 모르는 토큰, 폐기된 토큰, 만료된 토큰을 같은 오류로 돌려준다. 어느 쪽인지 알려 주면
    // 가진 토큰이 존재는 하는지를 밖에서 셀 수 있다.
    if (record === null || record.revokedAt !== null) throw invalid();

    const expiresAt = Math.floor(record.expiresAt.getTime() / 1000);
    // SDK도 만료를 보지만, 우리 시계는 Asia/Seoul을 고정한 ClockPort다. 두 곳이
    // 어긋나지 않도록 여기서도 같은 시계로 판정한다.
    if (record.expiresAt <= this.clock.instant()) throw invalid();

    // lastUsedAt은 요청 경로 밖에서 갱신한다. 인증이 쓰기를 하면 읽기 전용 도구도
    // 쓰기 트랜잭션을 타고, 실패하면 멀쩡한 토큰이 거부된다.
    void this.touch(record.id);

    return {
      token,
      // 구성원 id다. 도구는 이것으로만 수행자를 정한다.
      clientId: record.memberId,
      scopes: [MCP_SCOPE],
      // 비우면 SDK가 정상 토큰까지 401로 돌려준다.
      expiresAt,
      extra: { householdId: record.householdId },
    };
  }

  private async touch(id: string): Promise<void> {
    try {
      await this.prisma.memberToken.update({
        where: { id },
        data: { lastUsedAt: this.clock.instant() },
      });
    } catch {
      // 마지막 사용 시각은 편의 기록이다. 갱신에 실패했다고 호출을 막지 않는다.
    }
  }
}

function invalid(): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, '유효하지 않은 토큰입니다');
}
