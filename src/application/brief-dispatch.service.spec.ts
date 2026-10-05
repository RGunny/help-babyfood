import { localDate } from '../domain/shared/local-date.js';
import { localTime } from '../domain/shared/local-time.js';
import { MealSlot } from '../domain/shared/meal-slot.js';
import { CLAIM_LEASE_SECONDS, MAX_DELIVERY_ATTEMPTS, nextAttemptAt } from './brief-dispatch.policy.js';
import { BriefDispatchService } from './brief-dispatch.service.js';
import { BriefMealItem, BriefNewIngredient, BriefSlot, DailyBrief } from './daily-brief.js';
import { DailyBriefService } from './daily-brief.service.js';
import {
  BriefDeliveryLogPort,
  DailyBriefClaim,
  DeliveryClaim,
  DeliveryDue,
  ReactionPromptClaim,
  StockAlertClaim,
} from './ports/brief-delivery-log.port.js';
import { BriefDeliveryPort, DeliveryResult, ReactionPrompt } from './ports/brief-delivery.port.js';
import { ClockPort } from './ports/clock.port.js';

const DATE = localDate('2026-09-23');
const INSTANT = new Date('2026-09-22T22:30:00.000Z');
const SENT: DeliveryResult = { kind: 'sent', reference: 'ts-1' };

/**
 * Records what the sweep asked the store to write instead of writing it. What this file is about is
 * which claim goes down which of the four paths, and with which time.
 */
class RecordingLog implements BriefDeliveryLogPort {
  readonly due: DeliveryDue[] = [];
  readonly sent: { claim: DeliveryClaim; reference: string; at: Date }[] = [];
  readonly skipped: { claim: DeliveryClaim; reason: string; at: Date }[] = [];
  readonly failed: { claim: DeliveryClaim; error: string; at: Date; nextAttemptAt: Date }[] = [];
  readonly released: ReactionPromptClaim[] = [];

  constructor(
    private readonly briefs: readonly DailyBriefClaim[] = [],
    private readonly prompts: readonly ReactionPromptClaim[] = [],
    private readonly failingRecord: string | null = null,
  ) {}

  async claimDueDailyBriefs(due: DeliveryDue): Promise<DailyBriefClaim[]> {
    this.due.push(due);
    return [...this.briefs];
  }

  async claimDueReactionPrompts(due: DeliveryDue): Promise<ReactionPromptClaim[]> {
    this.due.push(due);
    return [...this.prompts];
  }

  async claimDueStockAlerts(due: DeliveryDue): Promise<StockAlertClaim[]> {
    this.due.push(due);
    return [];
  }

  async recordSent(claim: DeliveryClaim, reference: string, at: Date): Promise<void> {
    this.sent.push({ claim, reference, at });
  }

  async recordSkipped(claim: DeliveryClaim, reason: string, at: Date): Promise<void> {
    this.skipped.push({ claim, reason, at });
  }

  async recordFailed(claim: DeliveryClaim, error: string, at: Date, next: Date): Promise<void> {
    if (this.failingRecord !== null) throw new Error(this.failingRecord);
    this.failed.push({ claim, error, at, nextAttemptAt: next });
  }

  async releaseClaim(claim: ReactionPromptClaim): Promise<void> {
    this.released.push(claim);
  }
}

class RecordingDelivery implements BriefDeliveryPort {
  readonly briefs: { householdId: string; brief: DailyBrief }[] = [];
  readonly prompts: { householdId: string; prompt: ReactionPrompt }[] = [];

  constructor(private readonly answers: ReadonlyMap<string, DeliveryResult | unknown> = new Map()) {}

  async deliverDailyBrief(householdId: string, brief: DailyBrief): Promise<DeliveryResult> {
    this.briefs.push({ householdId, brief });
    return this.answer(householdId);
  }

  async deliverReactionPrompt(householdId: string, prompt: ReactionPrompt): Promise<DeliveryResult> {
    this.prompts.push({ householdId, prompt });
    return this.answer(householdId);
  }

  private answer(householdId: string): DeliveryResult {
    const answer = this.answers.get(householdId) ?? SENT;
    if (!isResult(answer)) throw answer;
    return answer;
  }
}

function isResult(answer: unknown): answer is DeliveryResult {
  return typeof answer === 'object' && answer !== null && 'kind' in answer;
}

function clockAt(time: string): ClockPort {
  return {
    now: () => ({ date: DATE, time: localTime(time) }),
    today: () => DATE,
    instant: () => INSTANT,
  };
}

function briefService(briefs: ReadonlyMap<string, DailyBrief | Error>): DailyBriefService {
  const service = {
    get: async (householdId: string): Promise<DailyBrief> => {
      const brief = briefs.get(householdId);
      if (brief === undefined) throw new Error(`브리프를 만들 수 없는 가정: ${householdId}`);
      if (brief instanceof Error) throw brief;
      return brief;
    },
  };
  return service as unknown as DailyBriefService;
}

function fedMeal(fed: boolean): BriefMealItem {
  return { menuName: '소고기미음', toppingNames: [], memo: null, fed, corrected: false };
}

function slotOf(slot: MealSlot, meal: BriefMealItem | null): BriefSlot {
  return { slot, mealTime: localTime('11:30'), meal, noFeed: null };
}

function newIngredient(name: string, slot: MealSlot, exposureNumber = 1): BriefNewIngredient {
  return { ingredientId: `${name}-id`, name, slot, exposureNumber };
}

function briefOf(slots: readonly BriefSlot[] = [], newIngredients: readonly BriefNewIngredient[] = []): DailyBrief {
  return {
    date: DATE,
    dayNumber: 1,
    slots,
    newIngredients,
    stock: [],
    pantryIngredients: [],
    shortages: [],
    thresholdAlerts: [],
    expiryAlerts: [],
    attention: {
      heldDeductions: [],
      unrecordedReactions: [],
      ruleWarnings: [],
      weightMismatchedBatches: [],
      planRunwayDays: null,
      planRunwayShort: false,
    },
  };
}

function briefClaim(householdId: string, attempts = 1): DailyBriefClaim {
  return { kind: 'brief', householdId, date: DATE, attempts };
}

function promptClaim(householdId: string, slot: MealSlot = 'morning', attempts = 1): ReactionPromptClaim {
  return { kind: 'reaction_prompt', householdId, date: DATE, slot, attempts };
}

describe('브리프 발송 쓸기', () => {
  it('클레임에 넘기는 날짜와 시각은 시계가 준 것이다', async () => {
    // 시각을 저장소가 정하면 get_daily_brief와 발송이 서로 다른 "지금"을 말하게 된다.
    const log = new RecordingLog();
    const service = new BriefDispatchService(log, new RecordingDelivery(), briefService(new Map()), clockAt('07:30'));

    await service.runEveryHousehold();

    expect(log.due).toEqual([
      {
        date: DATE,
        time: '07:30',
        instant: INSTANT,
        leaseSeconds: CLAIM_LEASE_SECONDS,
        maxAttempts: MAX_DELIVERY_ATTEMPTS,
      },
      {
        date: DATE,
        time: '07:30',
        instant: INSTANT,
        leaseSeconds: CLAIM_LEASE_SECONDS,
        maxAttempts: MAX_DELIVERY_ATTEMPTS,
      },
    ]);
  });

  it('클레임이 비면 아무것도 보내지 않고 빈 결과를 돌려준다', async () => {
    const delivery = new RecordingDelivery();
    const service = new BriefDispatchService(new RecordingLog(), delivery, briefService(new Map()), clockAt('07:30'));

    expect(await service.runEveryHousehold()).toEqual([]);
    expect(delivery.briefs).toEqual([]);
    expect(delivery.prompts).toEqual([]);
  });

  it('브리프를 보냈으면 발송이 돌려준 참조로 기록한다', async () => {
    const log = new RecordingLog([briefClaim('재하네')]);
    const delivery = new RecordingDelivery(new Map([['재하네', { kind: 'sent', reference: 'ts-9' }]]));
    const brief = briefOf();
    const service = new BriefDispatchService(
      log,
      delivery,
      briefService(new Map([['재하네', brief]])),
      clockAt('07:30'),
    );

    const outcomes = await service.runEveryHousehold();

    expect(delivery.briefs).toEqual([{ householdId: '재하네', brief }]);
    expect(log.sent).toEqual([{ claim: briefClaim('재하네'), reference: 'ts-9', at: INSTANT }]);
    expect(outcomes).toEqual([{ kind: 'sent', target: 'brief', householdId: '재하네' }]);
  });

  it('보낼 곳이 없으면 그날은 종결이고 재시도 대상이 되지 않는다', async () => {
    // 채널을 연결하지 않은 가정을 재시도로 두면 매일 다섯 번씩 빈 시도가 쌓인다.
    const log = new RecordingLog([briefClaim('재하네')]);
    const delivery = new RecordingDelivery(new Map([['재하네', { kind: 'skipped', reason: 'no_channel' }]]));
    const service = new BriefDispatchService(
      log,
      delivery,
      briefService(new Map([['재하네', briefOf()]])),
      clockAt('07:30'),
    );

    const outcomes = await service.runEveryHousehold();

    expect(log.skipped).toEqual([{ claim: briefClaim('재하네'), reason: 'no_channel', at: INSTANT }]);
    expect(log.failed).toEqual([]);
    expect(outcomes).toEqual([{ kind: 'skipped', target: 'brief', householdId: '재하네', reason: 'no_channel' }]);
  });

  it('발송이 던지면 정책이 정한 다음 시각으로 실패를 기록한다', async () => {
    const log = new RecordingLog([briefClaim('재하네', 3)]);
    const delivery = new RecordingDelivery(new Map([['재하네', new Error('발송 대상이 응답하지 않습니다')]]));
    const service = new BriefDispatchService(
      log,
      delivery,
      briefService(new Map([['재하네', briefOf()]])),
      clockAt('07:30'),
    );

    const outcomes = await service.runEveryHousehold();

    expect(log.failed).toEqual([
      {
        claim: briefClaim('재하네', 3),
        error: '발송 대상이 응답하지 않습니다',
        at: INSTANT,
        nextAttemptAt: nextAttemptAt(3, INSTANT),
      },
    ]);
    expect(outcomes[0]).toMatchObject({ kind: 'failed', target: 'brief', householdId: '재하네' });
  });

  it('브리프를 만들지 못한 것도 발송 실패와 같은 자리에 기록한다', async () => {
    const log = new RecordingLog([briefClaim('재하네')]);
    const service = new BriefDispatchService(
      log,
      new RecordingDelivery(),
      briefService(new Map([['재하네', new Error('상태를 읽지 못했습니다')]])),
      clockAt('07:30'),
    );

    await service.runEveryHousehold();

    expect(log.failed.map((record) => record.error)).toEqual(['상태를 읽지 못했습니다']);
  });

  it('Error가 아닌 것이 올라와도 기록할 내용을 만든다', async () => {
    const log = new RecordingLog([briefClaim('재하네')]);
    const delivery = new RecordingDelivery(new Map([['재하네', 'socket hang up']]));
    const service = new BriefDispatchService(
      log,
      delivery,
      briefService(new Map([['재하네', briefOf()]])),
      clockAt('07:30'),
    );

    await service.runEveryHousehold();

    expect(log.failed.map((record) => record.error)).toEqual(['socket hang up']);
  });

  it('한 가정의 발송이 던져도 다음 가정의 발송은 일어난다', async () => {
    const log = new RecordingLog([briefClaim('재하네'), briefClaim('민준네')]);
    const delivery = new RecordingDelivery(new Map([['재하네', new Error('끊겼습니다')]]));
    const service = new BriefDispatchService(
      log,
      delivery,
      briefService(
        new Map([
          ['재하네', briefOf()],
          ['민준네', briefOf()],
        ]),
      ),
      clockAt('07:30'),
    );

    const outcomes = await service.runEveryHousehold();

    expect(delivery.briefs.map((call) => call.householdId)).toEqual(['재하네', '민준네']);
    expect(outcomes[0]).toMatchObject({ kind: 'failed', householdId: '재하네' });
    expect(outcomes[1]).toMatchObject({ kind: 'sent', householdId: '민준네' });
  });

  it('실패를 기록하지도 못하면 쓸기 밖으로 나간다', async () => {
    // DB가 죽은 것이다. 다음 tick이 그대로 다시 시도한다.
    const log = new RecordingLog([briefClaim('재하네')], [], '커넥션을 얻지 못했습니다');
    const delivery = new RecordingDelivery(new Map([['재하네', new Error('끊겼습니다')]]));
    const service = new BriefDispatchService(
      log,
      delivery,
      briefService(new Map([['재하네', briefOf()]])),
      clockAt('07:30'),
    );

    await expect(service.runEveryHousehold()).rejects.toThrow('커넥션을 얻지 못했습니다');
  });
});

describe('후속 메시지의 세 갈래', () => {
  it('그 끼니에 식단이 없으면 되돌리지 않고 종결한다', async () => {
    // 미급여를 등록한 날에는 fed가 영영 true가 되지 않는다. 되돌림으로 두면 클레임과 삭제가
    // 자정까지 매분 반복된다.
    const log = new RecordingLog([], [promptClaim('재하네')]);
    const delivery = new RecordingDelivery();
    const service = new BriefDispatchService(
      log,
      delivery,
      briefService(new Map([['재하네', briefOf([slotOf('morning', null)])]])),
      clockAt('11:30'),
    );

    const outcomes = await service.runEveryHousehold();

    expect(log.skipped).toEqual([{ claim: promptClaim('재하네'), reason: 'no_meal', at: INSTANT }]);
    expect(log.released).toEqual([]);
    expect(delivery.prompts).toEqual([]);
    expect(outcomes).toEqual([
      { kind: 'skipped', target: 'reaction_prompt', householdId: '재하네', reason: 'no_meal' },
    ]);
  });

  it('브리프에 그 끼니 항목 자체가 없어도 종결한다', async () => {
    const log = new RecordingLog([], [promptClaim('재하네', 'afternoon')]);
    const service = new BriefDispatchService(
      log,
      new RecordingDelivery(),
      briefService(new Map([['재하네', briefOf([slotOf('morning', fedMeal(true))])]])),
      clockAt('17:30'),
    );

    await service.runEveryHousehold();

    expect(log.skipped.map((record) => record.reason)).toEqual(['no_meal']);
  });

  it('식단이 아직 급여로 넘어가지 않았으면 자기 행을 지우고 다음 tick에 넘긴다', async () => {
    // 식단시간 직후 최대 1분, 정합화가 아직 돌지 않은 창이다.
    const log = new RecordingLog([], [promptClaim('재하네')]);
    const delivery = new RecordingDelivery();
    const service = new BriefDispatchService(
      log,
      delivery,
      briefService(new Map([['재하네', briefOf([slotOf('morning', fedMeal(false))])]])),
      clockAt('11:30'),
    );

    const outcomes = await service.runEveryHousehold();

    expect(log.released).toEqual([promptClaim('재하네')]);
    expect(log.skipped).toEqual([]);
    expect(delivery.prompts).toEqual([]);
    expect(outcomes).toEqual([{ kind: 'deferred', target: 'reaction_prompt', householdId: '재하네' }]);
  });

  it('먹였는데 그 끼니에 새 재료가 없으면 물어볼 것이 없으므로 종결한다', async () => {
    const log = new RecordingLog([], [promptClaim('재하네')]);
    const delivery = new RecordingDelivery();
    const service = new BriefDispatchService(
      log,
      delivery,
      briefService(new Map([['재하네', briefOf([slotOf('morning', fedMeal(true))])]])),
      clockAt('11:30'),
    );

    const outcomes = await service.runEveryHousehold();

    expect(log.skipped.map((record) => record.reason)).toEqual(['no_new_ingredient']);
    expect(delivery.prompts).toEqual([]);
    expect(outcomes).toEqual([
      { kind: 'skipped', target: 'reaction_prompt', householdId: '재하네', reason: 'no_new_ingredient' },
    ]);
  });

  it('먹인 끼니의 새 재료만 싣는다', async () => {
    const log = new RecordingLog([], [promptClaim('재하네', 'morning')]);
    const delivery = new RecordingDelivery();
    const brief = briefOf(
      [slotOf('morning', fedMeal(true)), slotOf('afternoon', fedMeal(true))],
      [newIngredient('완두콩', 'morning'), newIngredient('브로콜리', 'afternoon', 2)],
    );
    const service = new BriefDispatchService(
      log,
      delivery,
      briefService(new Map([['재하네', brief]])),
      clockAt('11:30'),
    );

    const outcomes = await service.runEveryHousehold();

    expect(delivery.prompts).toEqual([
      {
        householdId: '재하네',
        prompt: {
          date: DATE,
          slot: 'morning',
          ingredients: [{ ingredientId: '완두콩-id', name: '완두콩', exposureNumber: 1 }],
        },
      },
    ]);
    expect(log.sent).toEqual([{ claim: promptClaim('재하네'), reference: 'ts-1', at: INSTANT }]);
    expect(outcomes).toEqual([{ kind: 'sent', target: 'reaction_prompt', householdId: '재하네' }]);
  });

  it('후속 메시지를 보낼 곳이 없으면 그 끼니는 종결한다', async () => {
    const log = new RecordingLog([], [promptClaim('재하네')]);
    const delivery = new RecordingDelivery(new Map([['재하네', { kind: 'skipped', reason: 'no_channel' }]]));
    const brief = briefOf([slotOf('morning', fedMeal(true))], [newIngredient('완두콩', 'morning')]);
    const service = new BriefDispatchService(
      log,
      delivery,
      briefService(new Map([['재하네', brief]])),
      clockAt('11:30'),
    );

    await service.runEveryHousehold();

    expect(log.skipped.map((record) => record.reason)).toEqual(['no_channel']);
    expect(log.failed).toEqual([]);
  });

  it('후속 메시지 발송이 던지면 정책이 정한 다음 시각으로 실패를 기록한다', async () => {
    const log = new RecordingLog([], [promptClaim('재하네', 'morning', 4)]);
    const delivery = new RecordingDelivery(new Map([['재하네', new Error('발송 대상이 응답하지 않습니다')]]));
    const brief = briefOf([slotOf('morning', fedMeal(true))], [newIngredient('완두콩', 'morning')]);
    const service = new BriefDispatchService(
      log,
      delivery,
      briefService(new Map([['재하네', brief]])),
      clockAt('11:30'),
    );

    const outcomes = await service.runEveryHousehold();

    expect(log.failed).toEqual([
      {
        claim: promptClaim('재하네', 'morning', 4),
        error: '발송 대상이 응답하지 않습니다',
        at: INSTANT,
        nextAttemptAt: nextAttemptAt(4, INSTANT),
      },
    ]);
    expect(outcomes[0]).toMatchObject({ kind: 'failed', target: 'reaction_prompt' });
  });

  it('브리프와 후속 메시지를 한 쓸기에서 함께 처리한다', async () => {
    const log = new RecordingLog([briefClaim('재하네')], [promptClaim('민준네')]);
    const delivery = new RecordingDelivery();
    const service = new BriefDispatchService(
      log,
      delivery,
      briefService(
        new Map([
          ['재하네', briefOf()],
          ['민준네', briefOf([slotOf('morning', fedMeal(false))])],
        ]),
      ),
      clockAt('11:30'),
    );

    const outcomes = await service.runEveryHousehold();

    expect(outcomes).toEqual([
      { kind: 'sent', target: 'brief', householdId: '재하네' },
      { kind: 'deferred', target: 'reaction_prompt', householdId: '민준네' },
    ]);
  });
});
