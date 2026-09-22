import { CLAIM_LEASE_SECONDS, MAX_DELIVERY_ATTEMPTS } from '../../src/application/brief-dispatch.policy.js';
import { DeliveryDue } from '../../src/application/ports/brief-delivery-log.port.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { localTime } from '../../src/domain/shared/local-time.js';
import { PrismaBriefDeliveryLog } from '../../src/infrastructure/prisma/brief-delivery-log.repository.js';
import { TestServices, at, buildServices, seedHouseholdOnly } from './setup/fixtures.js';

// 발송 이력과 클레임만 본다. 무엇을 보낼지는 brief-dispatch.int-spec.ts가 본다.
// 여기서 지키는 것은 "하루 한 건"과 "종결한 것은 다시 잡히지 않는다"이다.

const TODAY = '2026-09-22';

let services: TestServices;
let log: PrismaBriefDeliveryLog;

beforeAll(() => {
  services = buildServices(at(TODAY, '07:00'));
  log = new PrismaBriefDeliveryLog(services.prisma);
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

/**
 * 한 번의 쓸기가 보는 "지금". 벽시계와 절대 시각이 같은 순간을 가리키게 묶어 두어,
 * 테스트가 시각을 하나만 옮기면 둘 다 따라간다.
 */
function due(time: string, overrides: Partial<DeliveryDue> = {}): DeliveryDue {
  return {
    date: localDate(TODAY),
    time: localTime(time),
    instant: new Date(`${TODAY}T${time}:00+09:00`),
    leaseSeconds: CLAIM_LEASE_SECONDS,
    maxAttempts: MAX_DELIVERY_ATTEMPTS,
    ...overrides,
  };
}

/** 가정 하나. 알람 설정도 끼니도 없는, pnpm member-token이 막 만든 상태다. */
async function household(): Promise<{ id: string; actor: { kind: 'member'; memberId: string } }> {
  const { id, actor } = await seedHouseholdOnly(services.prisma);
  return { id, actor: actor as { kind: 'member'; memberId: string } };
}

async function setBriefTime(house: { id: string; actor: unknown }, time: string): Promise<void> {
  await services.alertSettings.update({
    householdId: house.id,
    actor: house.actor as never,
    briefTime: localTime(time),
    shelfLifeDays: 30,
    thresholds: [],
  });
}

async function startSlot(
  house: { id: string; actor: unknown },
  slot: 'morning' | 'afternoon',
  mealTime: string,
): Promise<void> {
  await services.mealSlot.start({
    householdId: house.id,
    actor: house.actor as never,
    slot,
    startDate: localDate(TODAY),
    mealTime: localTime(mealTime),
  });
}

describe('브리프 클레임', () => {
  it('알람 설정을 한 번도 저장하지 않은 가정도 기본 시각 07:30에 클레임된다', async () => {
    const house = await household();

    expect(await log.claimDueDailyBriefs(due('07:29'))).toEqual([]);

    const claims = await log.claimDueDailyBriefs(due('07:30'));
    expect(claims).toEqual([
      { kind: 'brief', householdId: house.id, date: localDate(TODAY), attempts: 1 },
    ]);
  });

  it('알람 설정이 있으면 그 시각을 쓰고, 그 전에는 클레임되지 않는다', async () => {
    const house = await household();
    await setBriefTime(house, '09:00');

    expect(await log.claimDueDailyBriefs(due('08:59'))).toEqual([]);
    expect(await log.claimDueDailyBriefs(due('09:00'))).toHaveLength(1);
  });

  it('설정한 시각이 기본 시각보다 이르면 그 시각에 클레임된다', async () => {
    const house = await household();
    await setBriefTime(house, '06:00');

    expect(await log.claimDueDailyBriefs(due('06:00'))).toHaveLength(1);
  });

  it('같은 가정과 날짜를 동시에 두 번 클레임하면 한쪽만 행을 얻는다', async () => {
    await household();

    const [first, second] = await Promise.all([
      log.claimDueDailyBriefs(due('07:30')),
      log.claimDueDailyBriefs(due('07:30')),
    ]);

    expect(first.length + second.length).toBe(1);
  });

  it('보냈다고 기록한 뒤에는 다시 클레임되지 않는다', async () => {
    await household();
    const [claim] = await log.claimDueDailyBriefs(due('07:30'));
    await log.recordSent(claim!, '1726980000.000100', due('07:30').instant);

    expect(await log.claimDueDailyBriefs(due('09:00'))).toEqual([]);
  });

  it('건너뛰었다고 기록한 뒤에도 다시 클레임되지 않는다. 종결 상태다', async () => {
    await household();
    const [claim] = await log.claimDueDailyBriefs(due('07:30'));
    await log.recordSkipped(claim!, 'no_channel_linked', due('07:30').instant);

    expect(await log.claimDueDailyBriefs(due('09:00'))).toEqual([]);
  });

  it('실패한 행은 다음 시도 시각 전에는 잡히지 않는다', async () => {
    await household();
    const [claim] = await log.claimDueDailyBriefs(due('07:30'));
    await log.recordFailed(claim!, 'channel_not_found', due('07:30').instant, due('07:31').instant);

    expect(await log.claimDueDailyBriefs(due('07:30'))).toEqual([]);
  });

  it('실패한 행은 다음 시도 시각이 지나면 잡히고 시도 횟수가 1 늘어난다', async () => {
    const house = await household();
    const [claim] = await log.claimDueDailyBriefs(due('07:30'));
    await log.recordFailed(claim!, 'channel_not_found', due('07:30').instant, due('07:31').instant);

    const retried = await log.claimDueDailyBriefs(due('07:31'));

    expect(retried).toEqual([
      { kind: 'brief', householdId: house.id, date: localDate(TODAY), attempts: 2 },
    ]);
  });

  it('시도 횟수가 상한이면 다음 시도 시각이 지나도 잡히지 않는다', async () => {
    await household();
    const ceiling = { maxAttempts: 1 };
    const [claim] = await log.claimDueDailyBriefs(due('07:30', ceiling));
    await log.recordFailed(claim!, 'channel_not_found', due('07:30').instant, due('07:31').instant);

    expect(await log.claimDueDailyBriefs(due('07:31', ceiling))).toEqual([]);
  });

  it('잡아 둔 pending 행은 리스가 남아 있는 동안 다시 잡히지 않는다', async () => {
    await household();
    await log.claimDueDailyBriefs(due('07:30'));

    expect(await log.claimDueDailyBriefs(due('07:34'))).toEqual([]);
  });

  it('발송 중에 죽어 pending으로 남은 행은 리스가 지나면 다시 잡힌다', async () => {
    const house = await household();
    await log.claimDueDailyBriefs(due('07:30'));

    const retaken = await log.claimDueDailyBriefs(due('07:35'));

    expect(retaken).toEqual([
      { kind: 'brief', householdId: house.id, date: localDate(TODAY), attempts: 2 },
    ]);
  });
});

describe('후속 메시지 클레임', () => {
  it('식단시간이 지난 끼니만 고른다', async () => {
    const house = await household();
    await startSlot(house, 'morning', '10:00');
    await startSlot(house, 'afternoon', '18:00');

    const claims = await log.claimDueReactionPrompts(due('10:00'));

    expect(claims).toEqual([
      { kind: 'reaction_prompt', householdId: house.id, date: localDate(TODAY), slot: 'morning', attempts: 1 },
    ]);
  });

  it('식단시간 전에는 아무 끼니도 클레임되지 않는다', async () => {
    const house = await household();
    await startSlot(house, 'morning', '10:00');

    expect(await log.claimDueReactionPrompts(due('09:59'))).toEqual([]);
  });

  it('끼니 시각이 모두 지나면 두 끼니가 함께 클레임된다', async () => {
    const house = await household();
    await startSlot(house, 'morning', '10:00');
    await startSlot(house, 'afternoon', '18:00');

    const claims = await log.claimDueReactionPrompts(due('18:00'));

    expect(claims.map((claim) => claim.slot).sort()).toEqual(['afternoon', 'morning']);
  });

  it('클레임을 되돌린 뒤에는 같은 끼니가 다시 클레임된다', async () => {
    const house = await household();
    await startSlot(house, 'morning', '10:00');
    const [claim] = await log.claimDueReactionPrompts(due('10:00'));

    await log.releaseClaim(claim!);

    const again = await log.claimDueReactionPrompts(due('10:01'));
    expect(again).toEqual([
      { kind: 'reaction_prompt', householdId: house.id, date: localDate(TODAY), slot: 'morning', attempts: 1 },
    ]);
  });

  it('되돌리지 않으면 같은 끼니가 같은 tick 뒤에 다시 클레임되지 않는다', async () => {
    const house = await household();
    await startSlot(house, 'morning', '10:00');
    await log.claimDueReactionPrompts(due('10:00'));

    expect(await log.claimDueReactionPrompts(due('10:01'))).toEqual([]);
  });

  it('보냈다고 기록한 끼니는 다시 클레임되지 않는다', async () => {
    const house = await household();
    await startSlot(house, 'morning', '10:00');
    const [claim] = await log.claimDueReactionPrompts(due('10:00'));
    await log.recordSent(claim!, '1726980000.000200', due('10:00').instant);

    expect(await log.claimDueReactionPrompts(due('10:30'))).toEqual([]);
  });
});

describe('발송 이력의 제약', () => {
  it('보냈다면서 보낸 시각이 없는 행은 거부한다', async () => {
    const house = await household();
    const instant = due('07:30').instant;

    await expect(
      services.prisma.$executeRaw`
        INSERT INTO brief_delivery (household_id, brief_date, status, attempts, claimed_at, updated_at)
        VALUES (${house.id}::uuid, ${TODAY}::date, 'sent'::delivery_status, 1, ${instant}, ${instant})
      `,
    ).rejects.toThrow(/brief_delivery_sent_check/);
  });

  it('보냈다면서 메시지 참조가 없는 행은 거부한다', async () => {
    const house = await household();
    const instant = due('07:30').instant;

    await expect(
      services.prisma.$executeRaw`
        INSERT INTO brief_delivery (household_id, brief_date, status, attempts, claimed_at, updated_at, sent_at)
        VALUES (${house.id}::uuid, ${TODAY}::date, 'sent'::delivery_status, 1, ${instant}, ${instant}, ${instant})
      `,
    ).rejects.toThrow(/brief_delivery_sent_check/);
  });

  it('실패했다면서 다음 시도 시각이 없는 행은 거부한다', async () => {
    const house = await household();
    const instant = due('07:30').instant;

    await expect(
      services.prisma.$executeRaw`
        INSERT INTO brief_delivery
          (household_id, brief_date, status, attempts, claimed_at, updated_at, outcome_reason)
        VALUES (${house.id}::uuid, ${TODAY}::date, 'failed'::delivery_status, 1, ${instant}, ${instant}, 'boom')
      `,
    ).rejects.toThrow(/brief_delivery_failed_check/);
  });

  it('건너뛰었다면서 사유가 없는 행은 거부한다', async () => {
    const house = await household();
    const instant = due('07:30').instant;

    await expect(
      services.prisma.$executeRaw`
        INSERT INTO brief_delivery (household_id, brief_date, status, attempts, claimed_at, updated_at)
        VALUES (${house.id}::uuid, ${TODAY}::date, 'skipped'::delivery_status, 1, ${instant}, ${instant})
      `,
    ).rejects.toThrow(/brief_delivery_skipped_check/);
  });

  it('시도 횟수가 0인 행은 거부한다', async () => {
    const house = await household();
    const instant = due('07:30').instant;

    await expect(
      services.prisma.$executeRaw`
        INSERT INTO brief_delivery (household_id, brief_date, status, attempts, claimed_at, updated_at)
        VALUES (${house.id}::uuid, ${TODAY}::date, 'pending'::delivery_status, 0, ${instant}, ${instant})
      `,
    ).rejects.toThrow(/brief_delivery_attempts_check/);
  });

  it('후속 메시지 이력에도 같은 제약이 걸려 있다', async () => {
    const house = await household();
    const instant = due('10:00').instant;

    await expect(
      services.prisma.$executeRaw`
        INSERT INTO reaction_prompt_delivery
          (household_id, date, slot, status, attempts, claimed_at, updated_at)
        VALUES (${house.id}::uuid, ${TODAY}::date, 'morning'::meal_slot, 'sent'::delivery_status, 1, ${instant}, ${instant})
      `,
    ).rejects.toThrow(/reaction_prompt_delivery_sent_check/);
  });
});
