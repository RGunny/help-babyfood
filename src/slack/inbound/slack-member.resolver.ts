import { Actor } from '../../application/ports/household-write.port.js';
import { PrismaTransaction } from '../../infrastructure/prisma/prisma.service.js';

/** Who tapped and whose data the tap may touch. The same shape as the MCP caller. */
export interface SlackMember {
  readonly householdId: string;
  readonly actor: Actor;
}

/**
 * Turns the Slack user who tapped a button into the member who acts.
 *
 * Reads Prisma directly: looking up an identifier is not a use case (ADR 0004, "층별 결합"), and
 * this touches nothing but `member.slack_user_id`, which is globally unique.
 */
export class SlackMemberResolver {
  constructor(private readonly prisma: PrismaTransaction) {}

  async resolve(slackUserId: string): Promise<SlackMember | null> {
    const member = await this.prisma.member.findUnique({
      where: { slackUserId },
      select: { id: true, householdId: true },
    });
    if (member === null) return null;
    return { householdId: member.householdId, actor: { kind: 'member', memberId: member.id } };
  }
}
