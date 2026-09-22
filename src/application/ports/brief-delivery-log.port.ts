import { LocalDate } from '../../domain/shared/local-date.js';
import { LocalTime } from '../../domain/shared/local-time.js';
import { MealSlot } from '../../domain/shared/meal-slot.js';

export interface DailyBriefClaim {
  readonly kind: 'brief';
  readonly householdId: string;
  readonly date: LocalDate;
  /** 이번이 몇 번째 시도인가. 1부터 시작한다. */
  readonly attempts: number;
}

export interface ReactionPromptClaim {
  readonly kind: 'reaction_prompt';
  readonly householdId: string;
  readonly date: LocalDate;
  readonly slot: MealSlot;
  readonly attempts: number;
}

/**
 * A claim the caller won and now owes a result for.
 *
 * `kind` is the discriminant so that the store is told which record this is rather than guessing it
 * from the shape. A claim without a slot happening to be a brief is true today and stops being true
 * the moment either record grows a field.
 */
export type DeliveryClaim = DailyBriefClaim | ReactionPromptClaim;

/** 한 번의 쓸기가 "지금"을 보는 방식. 시각은 전부 호출자가 준다. */
export interface DeliveryDue {
  readonly date: LocalDate;
  /** Asia/Seoul 벽시계 HH:mm. 저장소는 이것으로 브리프 시각과 식단시간을 비교한다. */
  readonly time: LocalTime;
  readonly instant: Date;
  readonly leaseSeconds: number;
  readonly maxAttempts: number;
}

/**
 * The delivery history of chapter 6: when it was sent, what came of it, how many tries it took.
 *
 * Claiming and recording are the same port because they are the same row. A claim is won by
 * inserting it, so the household that got the row is the one that sends that day, and the result
 * goes back onto the row that was claimed.
 *
 * `nextAttemptAt` is an argument of `recordFailed` rather than something the store works out. The
 * retry table is a pure function (`brief-dispatch.policy.ts`), and letting SQL compute the same
 * delays would make two copies of it that drift apart silently.
 */
export interface BriefDeliveryLogPort {
  claimDueDailyBriefs(due: DeliveryDue): Promise<DailyBriefClaim[]>;
  claimDueReactionPrompts(due: DeliveryDue): Promise<ReactionPromptClaim[]>;
  recordSent(claim: DeliveryClaim, reference: string, at: Date): Promise<void>;
  recordSkipped(claim: DeliveryClaim, reason: string, at: Date): Promise<void>;
  recordFailed(claim: DeliveryClaim, error: string, at: Date, nextAttemptAt: Date): Promise<void>;
  /** 클레임했지만 아직 할 일이 아니었을 때 자기 행을 지운다. 다음 tick이 다시 잡는다. */
  releaseClaim(claim: ReactionPromptClaim): Promise<void>;
}
