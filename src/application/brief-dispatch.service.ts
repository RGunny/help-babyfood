import { MealSlot } from '../domain/shared/meal-slot.js';
import { CLAIM_LEASE_SECONDS, MAX_DELIVERY_ATTEMPTS, nextAttemptAt } from './brief-dispatch.policy.js';
import { BriefNewIngredient } from './daily-brief.js';
import { DailyBriefService } from './daily-brief.service.js';
import {
  BriefDeliveryLogPort,
  DailyBriefClaim,
  DeliveryClaim,
  DeliveryDue,
  ReactionPromptClaim,
  StockAlertClaim,
} from './ports/brief-delivery-log.port.js';
import { BriefDeliveryPort, DeliveryResult, ReactionPromptIngredient } from './ports/brief-delivery.port.js';
import { ClockPort } from './ports/clock.port.js';

export type DispatchTarget = 'brief' | 'reaction_prompt' | 'stock_alert';

/** 그 끼니에 식단이 없다. 미급여를 등록했거나 식단이 끝난 날이다. */
const NO_MEAL = 'no_meal';
/** 먹이기는 했는데 관찰할 새 재료가 없다. 물어볼 것이 없다. */
const NO_NEW_INGREDIENT = 'no_new_ingredient';
/** 알람 항목이 없다. 재고가 식단을 덮고 임계개수 이하인 재료도 없는 날이다. */
const NO_ALERT = 'no_alert';

/** What one claim's turn in a sweep came to. A failure is a result, not an exception. */
export type DispatchOutcome =
  | { readonly kind: 'sent'; readonly target: DispatchTarget; readonly householdId: string }
  | {
      readonly kind: 'skipped';
      readonly target: DispatchTarget;
      readonly householdId: string;
      readonly reason: string;
    }
  | { readonly kind: 'deferred'; readonly target: DispatchTarget; readonly householdId: string }
  | {
      readonly kind: 'failed';
      readonly target: DispatchTarget;
      readonly householdId: string;
      readonly error: unknown;
    };

/**
 * Sends what is due this minute: today's brief, the follow-up asking about a meal just fed, and
 * the stock alert that goes out on its own every day until stock covers the plan again.
 *
 * Claim first, build the brief after. The claim is a cheap insert that decides who sends, while
 * `DailyBriefService.get` walks the plan, the ledger and the forecast, so the expensive half runs
 * once a day per household rather than once a minute.
 *
 * Every time this needs comes from `ClockPort`, never from the store. The claim query compares a
 * household's brief time against the Asia/Seoul wall clock handed to it, so that the one place
 * deciding what time it is stays the one place (ADR 0005, "대가와 남는 위험").
 */
export class BriefDispatchService {
  constructor(
    private readonly log: BriefDeliveryLogPort,
    private readonly delivery: BriefDeliveryPort,
    private readonly brief: DailyBriefService,
    private readonly clock: ClockPort,
  ) {}

  /**
   * Every household with something due, one claim at a time. This is what the scheduler calls.
   *
   * A household whose delivery throws is reported and the sweep goes on, the way the reconciliation
   * sweep does. What is not swallowed is a failure of the log itself: if the row recording the
   * failure cannot be written the database is gone, and the next tick starts over.
   *
   * The stock alert goes last. Claims sit outside the try, so a claim that throws stops every loop
   * after it, and a server up before the alert table's migration is applied throws on that claim.
   * Last, the only thing it blocks is the alert itself (ADR 0010).
   */
  async runEveryHousehold(): Promise<DispatchOutcome[]> {
    const now = this.clock.now();
    const instant = this.clock.instant();
    const due: DeliveryDue = {
      date: now.date,
      time: now.time,
      instant,
      leaseSeconds: CLAIM_LEASE_SECONDS,
      maxAttempts: MAX_DELIVERY_ATTEMPTS,
    };

    const outcomes: DispatchOutcome[] = [];
    for (const claim of await this.log.claimDueDailyBriefs(due)) {
      outcomes.push(await this.dispatchDailyBrief(claim, instant));
    }
    for (const claim of await this.log.claimDueReactionPrompts(due)) {
      outcomes.push(await this.dispatchReactionPrompt(claim, instant));
    }
    for (const claim of await this.log.claimDueStockAlerts(due)) {
      outcomes.push(await this.dispatchStockAlert(claim, instant));
    }
    return outcomes;
  }

  private async dispatchDailyBrief(claim: DailyBriefClaim, instant: Date): Promise<DispatchOutcome> {
    try {
      const brief = await this.brief.get(claim.householdId);
      return await this.record(
        'brief',
        claim,
        await this.delivery.deliverDailyBrief(claim.householdId, brief),
        instant,
      );
    } catch (error) {
      return await this.fail('brief', claim, error, instant);
    }
  }

  /**
   * The follow-up of 4.6, decided against the brief rather than against a query.
   *
   * "Has this meal been fed?" cannot be asked in SQL: a meal carries no date, so which meal sits in
   * today's slot only comes out of the calendar projection. So the claim is made on meal time and
   * the brief settles it, three ways.
   */
  private async dispatchReactionPrompt(claim: ReactionPromptClaim, instant: Date): Promise<DispatchOutcome> {
    const target = 'reaction_prompt';
    const { householdId } = claim;
    try {
      const brief = await this.brief.get(householdId);
      const slot = brief.slots.find((entry) => entry.slot === claim.slot);

      if (slot === undefined || slot.meal === null) {
        // 되돌림이 아니라 종결이다. 미급여를 등록한 날에는 그 끼니에 식단이 영영 놓이지 않아
        // fed가 true가 되는 일이 없고, 되돌림으로 두면 클레임과 삭제가 자정까지 매분 반복된다.
        await this.log.recordSkipped(claim, NO_MEAL, instant);
        return { kind: 'skipped', target, householdId, reason: NO_MEAL };
      }

      if (!slot.meal.fed) {
        // 식단시간이 막 지났고 정합화가 아직 돌지 않은 최대 1분의 창이다(ADR 0005). 자기 행을
        // 지우고 다음 tick에 넘긴다.
        await this.log.releaseClaim(claim);
        return { kind: 'deferred', target, householdId };
      }

      const ingredients = ingredientsOfSlot(brief.newIngredients, claim.slot);
      if (ingredients.length === 0) {
        await this.log.recordSkipped(claim, NO_NEW_INGREDIENT, instant);
        return { kind: 'skipped', target, householdId, reason: NO_NEW_INGREDIENT };
      }

      const result = await this.delivery.deliverReactionPrompt(householdId, {
        date: claim.date,
        slot: claim.slot,
        ingredients,
      });
      return await this.record(target, claim, result, instant);
    } catch (error) {
      return await this.fail(target, claim, error, instant);
    }
  }

  /**
   * The stock alert of ADR 0010, sent as its own message rather than inside the brief.
   *
   * The items are what the brief worked out; this only asks whether there are any. A day with none
   * is closed, not released: stock that runs low later that day is told the next morning.
   */
  private async dispatchStockAlert(claim: StockAlertClaim, instant: Date): Promise<DispatchOutcome> {
    const target = 'stock_alert';
    const { householdId } = claim;
    try {
      const brief = await this.brief.get(householdId);
      if (brief.stockAlert.items.length === 0) {
        await this.log.recordSkipped(claim, NO_ALERT, instant);
        return { kind: 'skipped', target, householdId, reason: NO_ALERT };
      }

      const result = await this.delivery.deliverStockAlert(householdId, {
        date: claim.date,
        alert: brief.stockAlert,
      });
      return await this.record(target, claim, result, instant);
    } catch (error) {
      return await this.fail(target, claim, error, instant);
    }
  }

  private async record(
    target: DispatchTarget,
    claim: DeliveryClaim,
    result: DeliveryResult,
    instant: Date,
  ): Promise<DispatchOutcome> {
    const { householdId } = claim;
    if (result.kind === 'sent') {
      await this.log.recordSent(claim, result.reference, instant);
      return { kind: 'sent', target, householdId };
    }
    // skipped는 종결이다. 재시도 대상으로 두면 채널을 영영 연결하지 않는 가정에 매일 빈 시도가 쌓인다.
    await this.log.recordSkipped(claim, result.reason, instant);
    return { kind: 'skipped', target, householdId, reason: result.reason };
  }

  private async fail(
    target: DispatchTarget,
    claim: DeliveryClaim,
    error: unknown,
    instant: Date,
  ): Promise<DispatchOutcome> {
    await this.log.recordFailed(claim, messageOf(error), instant, nextAttemptAt(claim.attempts, instant));
    return { kind: 'failed', target, householdId: claim.householdId, error };
  }
}

/**
 * The new ingredients of one slot, in the shape the prompt carries.
 *
 * Read off `DailyBrief` rather than added to it: `BriefNewIngredient` already carries the id, the
 * name and the exposure number, and it already says which slot it belongs to.
 */
function ingredientsOfSlot(newIngredients: readonly BriefNewIngredient[], slot: MealSlot): ReactionPromptIngredient[] {
  return newIngredients
    .filter((entry) => entry.slot === slot)
    .map(({ ingredientId, name, exposureNumber }) => ({ ingredientId, name, exposureNumber }));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
