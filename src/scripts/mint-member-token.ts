import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { readEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { DEFAULT_TOKEN_LIFETIME_DAYS, mintToken } from '../mcp/auth/member-token.js';

/**
 * Provisioning and token issue, from the command line.
 *
 * No MCP tool mints a token. A session that authenticated with a token being able to issue another
 * one would turn one leak into a permanent foothold, so issuing stays on a path that needs database
 * access, not a token.
 *
 * It ships in `dist` rather than staying a dev-only script because the first token has to be minted
 * where the real database is — on Railway, not on a laptop.
 *
 *   node dist/scripts/mint-member-token.js --household 재하네 --member 엄마 --label "엄마 노트북"
 *   node dist/scripts/mint-member-token.js --list
 *   node dist/scripts/mint-member-token.js --revoke <tokenId>
 */
const USAGE = `사용법:
  --household <이름>  가정 이름. 없으면 만든다.
  --member <이름>     구성원 이름. 없으면 만든다.
  --label <이름>      토큰을 쓰는 기기 이름. 예: "엄마 노트북"
  --days <n>          유효 기간. 기본 ${DEFAULT_TOKEN_LIFETIME_DAYS}일
  --list              살아 있는 토큰을 보인다.
  --revoke <토큰 id>  토큰을 폐기한다.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      household: { type: 'string' },
      member: { type: 'string' },
      label: { type: 'string' },
      days: { type: 'string' },
      list: { type: 'boolean' },
      revoke: { type: 'string' },
      help: { type: 'boolean' },
    },
  });

  if (values.help === true) {
    console.log(USAGE);
    return;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: readEnv().databaseUrl, max: 2 }),
  });

  try {
    if (values.list === true) return await list(prisma);
    if (values.revoke !== undefined) return await revoke(prisma, values.revoke);
    await issue(prisma, values);
  } finally {
    await prisma.$disconnect();
  }
}

async function issue(
  prisma: PrismaClient,
  values: { household?: string; member?: string; label?: string; days?: string },
): Promise<void> {
  const householdName = required(values.household, '--household');
  const memberName = required(values.member, '--member');
  const label = required(values.label, '--label');
  const days = values.days === undefined ? DEFAULT_TOKEN_LIFETIME_DAYS : positiveInteger(values.days);

  const household =
    (await prisma.household.findFirst({ where: { name: householdName }, select: { id: true } })) ??
    (await created('가정', prisma.household.create({ data: { name: householdName }, select: { id: true } })));

  const member =
    (await prisma.member.findFirst({
      where: { householdId: household.id, name: memberName },
      select: { id: true },
    })) ??
    (await created(
      '구성원',
      prisma.member.create({
        data: { householdId: household.id, name: memberName },
        select: { id: true },
      }),
    ));

  const { token, tokenHash } = mintToken();
  const row = await prisma.memberToken.create({
    data: {
      householdId: household.id,
      memberId: member.id,
      tokenHash,
      label,
      expiresAt: new Date(Date.now() + days * 86_400_000),
    },
    select: { id: true, expiresAt: true },
  });

  console.log(`
토큰을 발급했습니다. 평문은 지금 한 번만 보입니다.

  id      ${row.id}
  가정    ${householdName}
  구성원  ${memberName}
  기기    ${label}
  만료    ${row.expiresAt.toISOString()}

  ${token}

Claude Code에 붙이려면:

  claude mcp add --transport http babyfood https://<서버 주소>/mcp \\
    --header "Authorization: Bearer ${token}"
`);
}

async function list(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.memberToken.findMany({
    where: { revokedAt: null },
    select: {
      id: true,
      label: true,
      expiresAt: true,
      lastUsedAt: true,
      member: { select: { name: true } },
      household: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (rows.length === 0) {
    console.log('살아 있는 토큰이 없습니다.');
    return;
  }
  for (const row of rows) {
    const used = row.lastUsedAt?.toISOString() ?? '쓰인 적 없음';
    console.log(
      `${row.id}  ${row.household.name}/${row.member.name}  ${row.label}  만료 ${row.expiresAt.toISOString()}  마지막 사용 ${used}`,
    );
  }
}

async function revoke(prisma: PrismaClient, id: string): Promise<void> {
  // 행을 지우지 않는다. 언제 발급됐고 언제까지 쓰였는지가 남아야 사고를 되짚을 수 있다.
  const updated = await prisma.memberToken.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  console.log(updated.count === 0 ? '그런 토큰이 없거나 이미 폐기됐습니다.' : '폐기했습니다.');
}

async function created<T>(what: string, creating: Promise<T>): Promise<T> {
  const row = await creating;
  console.log(`${what}을 새로 만들었습니다.`);
  return row;
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === '') {
    console.error(`${flag}이 필요합니다.\n\n${USAGE}`);
    process.exit(1);
  }
  return value;
}

function positiveInteger(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`--days는 1 이상의 정수여야 합니다: ${raw}`);
    process.exit(1);
  }
  return value;
}

await main();
