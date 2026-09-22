import type { AuthInfo } from '@modelcontextprotocol/server';
import { Actor } from '../../application/ports/household-write.port.js';

/** Who is calling and whose data they may touch. */
export interface Caller {
  readonly householdId: string;
  readonly actor: Actor;
}

/**
 * Reads the caller out of the verified token.
 *
 * Both values come from the token and from nowhere else. Taking the household from a tool argument
 * would let one household's token read another's data, and taking the member from an argument
 * would let a parent file a change under the other's name.
 */
export function callerOf(authInfo: AuthInfo | undefined): Caller {
  const householdId = authInfo?.extra?.['householdId'];
  if (authInfo === undefined || typeof householdId !== 'string') {
    // 여기에 닿는 것은 인증 없이 핸들러가 마운트됐다는 뜻이다. 요청을 처리하지 않는다.
    throw new Error('인증된 호출자가 없습니다');
  }
  return { householdId, actor: { kind: 'member', memberId: authInfo.clientId } };
}
