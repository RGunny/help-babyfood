import { BriefDispatchService } from '../../src/application/brief-dispatch.service.js';
import { DailyBrief } from '../../src/application/daily-brief.js';
import {
  BriefDeliveryPort,
  DeliveryResult,
  ReactionPrompt,
} from '../../src/application/ports/brief-delivery.port.js';
import { localDate } from '../../src/domain/shared/local-date.js';
import { PrismaBriefDeliveryLog } from '../../src/infrastructure/prisma/brief-delivery-log.repository.js';
import { Household, TestServices, at, buildServices, seedHousehold, seedHouseholdOnly } from './setup/fixtures.js';

// 진짜 저장소와 진짜 DailyBriefService에 가짜 발송 포트를 끼운다. Slack은 3단계에 붙는다.
// 여기서 보는 것은 "쓸기 한 번이 무엇을 보내고 무엇을 기록으로 남기는가"다.

const TODAY = '2026-09-22';
const WEIGHTS: Record<string, number> = { 쌀: 30, 오트밀: 10, 소고기: 10, 브로콜리: 15, 애호박: 15 };

/** 던지는 것도 결과의 하나로 둔다. 발송 실패는 포트가 예외로 알린다. */
type Outcome = DeliveryResult | { readonly kind: 'throw'; readonly error: string };

class FakeBriefDelivery implements BriefDeliveryPort {
  readonly briefs: DailyBrief[] = [];
  readonly prompts: ReactionPrompt[] = [];
  brief: Outcome = { kind: 'sent', reference: 'ts-brief' };
  prompt: Outcome = { kind: 'sent', reference: 'ts-prompt' };

  async deliverDailyBrief(_householdId: string, brief: DailyBrief): Promise<DeliveryResult> {
    this.briefs.push(brief);
    return settle(this.brief);
  }

  async deliverReactionPrompt(_householdId: string, prompt: ReactionPrompt): Promise<DeliveryResult> {
    this.prompts.push(prompt);
    return settle(this.prompt);
  }
}

function settle(outcome: Outcome): DeliveryResult {
  if (outcome.kind === 'throw') throw new Error(outcome.error);
  return outcome;
}

let services: TestServices;
let delivery: FakeBriefDelivery;
let dispatch: BriefDispatchService;

beforeAll(() => {
  services = buildServices(at(TODAY, '07:00'));
});

beforeEach(() => {
  delivery = new FakeBriefDelivery();
  dispatch = new BriefDispatchService(
    new PrismaBriefDeliveryLog(services.prisma),
    delivery,
    services.dailyBrief,
    services.clock,
  );
  services.clock.set(TODAY, '07:00');
});

afterAll(async () => {
  await services.prisma.$disconnect();
});

const briefRow = async (householdId: string) =>
  await services.prisma.briefDelivery.findFirst({ where: { householdId } });

const promptRow = async (householdId: string) =>
  await services.prisma.reactionPromptDelivery.findFirst({ where: { householdId } });

/** 끼니가 없는 가정. 브리프만 보내므로 후속 메시지가 섞이지 않는다. */
async function briefOnlyHousehold(): Promise<string> {
  const { id } = await seedHouseholdOnly(services.prisma);
  return id;
}

/** 오늘 아침 10시에 식단이 하나 놓인 가정. 재료는 모두 오늘이 첫 노출이다. */
async function plannedHousehold(): Promise<Household> {
  const house = await seedHousehold(services, { mealCount: 3, slotStartDate: TODAY, mealTime: '10:00' });
  for (const [name, cubeWeightGram] of Object.entries(WEIGHTS)) {
    await services.stock.registerCookedBatch({
      householdId: house.id,
      actor: house.actor,
      ingredientName: name,
      cubeWeightGram,
      cookedOn: localDate('2026-09-15'),
      cubes: 10,
    });
  }
  return house;
}

describe('브리프 발송', () => {
  it('브리프 시각 전에는 아무것도 보내지 않는다', async () => {
    const householdId = await briefOnlyHousehold();
    services.clock.set(TODAY, '07:29');

    expect(await dispatch.runEveryHousehold()).toEqual([]);
    expect(delivery.briefs).toEqual([]);
    expect(await briefRow(householdId)).toBeNull();
  });

  it('브리프 시각이 지나면 한 번 보내고 기록이 sent가 된다', async () => {
    const householdId = await briefOnlyHousehold();
    services.clock.set(TODAY, '07:30');

    const outcomes = await dispatch.runEveryHousehold();

    expect(outcomes).toEqual([{ kind: 'sent', target: 'brief', householdId }]);
    expect(delivery.briefs).toHaveLength(1);
    const row = await briefRow(householdId);
    expect(row?.status).toBe('sent');
    expect(row?.messageReference).toBe('ts-brief');
    expect(row?.sentAt).not.toBeNull();
  });

  it('같은 날 다시 돌려도 두 번 보내지 않는다', async () => {
    const householdId = await briefOnlyHousehold();
    services.clock.set(TODAY, '07:30');
    await dispatch.runEveryHousehold();

    services.clock.set(TODAY, '08:30');
    expect(await dispatch.runEveryHousehold()).toEqual([]);
    expect(delivery.briefs).toHaveLength(1);
    expect((await briefRow(householdId))?.attempts).toBe(1);
  });

  it('발송이 실패하면 failed로 남고 다음 시도 시각과 사유가 함께 기록된다', async () => {
    const householdId = await briefOnlyHousehold();
    delivery.brief = { kind: 'throw', error: 'channel_not_found' };
    services.clock.set(TODAY, '07:30');

    const outcomes = await dispatch.runEveryHousehold();

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['failed']);
    const row = await briefRow(householdId);
    expect(row?.status).toBe('failed');
    expect(row?.outcomeReason).toBe('channel_not_found');
    expect(row?.nextAttemptAt).not.toBeNull();
  });

  it('실패한 뒤 간격이 지나기 전에 돌리면 재시도하지 않는다', async () => {
    await briefOnlyHousehold();
    delivery.brief = { kind: 'throw', error: 'channel_not_found' };
    services.clock.set(TODAY, '07:30');
    await dispatch.runEveryHousehold();

    services.clock.set(TODAY, '07:30');
    expect(await dispatch.runEveryHousehold()).toEqual([]);
    expect(delivery.briefs).toHaveLength(1);
  });

  it('실패한 뒤 간격이 지나면 다시 돌릴 때 재시도하고 성공하면 sent가 된다', async () => {
    const householdId = await briefOnlyHousehold();
    delivery.brief = { kind: 'throw', error: 'channel_not_found' };
    services.clock.set(TODAY, '07:30');
    await dispatch.runEveryHousehold();

    delivery.brief = { kind: 'sent', reference: 'ts-retry' };
    services.clock.set(TODAY, '07:31');
    const outcomes = await dispatch.runEveryHousehold();

    expect(outcomes).toEqual([{ kind: 'sent', target: 'brief', householdId }]);
    expect(delivery.briefs).toHaveLength(2);
    const row = await briefRow(householdId);
    expect(row?.status).toBe('sent');
    expect(row?.attempts).toBe(2);
    expect(row?.messageReference).toBe('ts-retry');
  });

  it('발송 포트가 건너뛰었다고 하면 그날은 끝난다', async () => {
    const householdId = await briefOnlyHousehold();
    delivery.brief = { kind: 'skipped', reason: 'no_channel_linked' };
    services.clock.set(TODAY, '07:30');

    const outcomes = await dispatch.runEveryHousehold();

    expect(outcomes).toEqual([
      { kind: 'skipped', target: 'brief', householdId, reason: 'no_channel_linked' },
    ]);
    expect((await briefRow(householdId))?.status).toBe('skipped');

    services.clock.set(TODAY, '09:00');
    expect(await dispatch.runEveryHousehold()).toEqual([]);
    expect(delivery.briefs).toHaveLength(1);
  });
});

describe('후속 메시지의 세 갈래', () => {
  it('정합화 전에는 보내지 않고 잡았던 행이 사라진다', async () => {
    const house = await plannedHousehold();
    services.clock.set(TODAY, '10:00');

    const outcomes = await dispatch.runEveryHousehold();

    expect(outcomes).toContainEqual({ kind: 'deferred', target: 'reaction_prompt', householdId: house.id });
    expect(delivery.prompts).toEqual([]);
    expect(await promptRow(house.id)).toBeNull();
  });

  it('정합화가 돌아 급여가 확정되면 그 끼니의 새 재료를 담아 보낸다', async () => {
    const house = await plannedHousehold();
    services.clock.set(TODAY, '10:00');
    await dispatch.runEveryHousehold();

    await services.reconcile.run(house.id);
    services.clock.set(TODAY, '10:01');
    const outcomes = await dispatch.runEveryHousehold();

    expect(outcomes).toContainEqual({ kind: 'sent', target: 'reaction_prompt', householdId: house.id });
    expect(delivery.prompts).toHaveLength(1);
    expect(delivery.prompts[0]?.slot).toBe('morning');
    expect(delivery.prompts[0]?.ingredients.length).toBeGreaterThan(0);
    expect((await promptRow(house.id))?.status).toBe('sent');
  });

  it('보낸 뒤에는 같은 끼니를 다시 보내지 않는다', async () => {
    const house = await plannedHousehold();
    services.clock.set(TODAY, '10:00');
    await services.reconcile.run(house.id);
    await dispatch.runEveryHousehold();

    services.clock.set(TODAY, '10:30');
    await dispatch.runEveryHousehold();

    expect(delivery.prompts).toHaveLength(1);
  });

  it('미급여를 등록한 날에는 no_meal로 종결되고 다음 tick은 클레임하지 않는다', async () => {
    const house = await plannedHousehold();
    await services.noFeed.register({
      householdId: house.id,
      actor: house.actor,
      date: localDate(TODAY),
      slot: 'morning',
      thawed: false,
      reason: '감기',
    });
    services.clock.set(TODAY, '10:00');

    const outcomes = await dispatch.runEveryHousehold();

    expect(outcomes).toContainEqual({
      kind: 'skipped',
      target: 'reaction_prompt',
      householdId: house.id,
      reason: 'no_meal',
    });
    expect((await promptRow(house.id))?.status).toBe('skipped');

    services.clock.set(TODAY, '10:01');
    const second = await dispatch.runEveryHousehold();

    expect(second.filter((outcome) => outcome.target === 'reaction_prompt')).toEqual([]);
    expect(delivery.prompts).toEqual([]);
  });
});
