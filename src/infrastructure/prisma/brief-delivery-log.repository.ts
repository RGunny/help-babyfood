import {
  BriefDeliveryLogPort,
  DailyBriefClaim,
  DeliveryClaim,
  DeliveryDue,
  ReactionPromptClaim,
  StockAlertClaim,
} from '../../application/ports/brief-delivery-log.port.js';
import { MealSlot } from '../../domain/shared/meal-slot.js';
import { DEFAULT_BRIEF_TIME } from './mappers/state.mapper.js';
import { PrismaTransaction } from './prisma.service.js';

/** RETURNING이 돌려주는 것. 날짜와 끼니는 클레임을 건 쪽이 이미 알고 있다. */
interface BriefClaimRow {
  household_id: string;
  attempts: number;
}

interface ReactionClaimRow extends BriefClaimRow {
  slot: MealSlot;
}

const MS_PER_SECOND = 1_000;

/**
 * Reached only if `DeliveryClaim` grows a kind the `record*` methods do not handle. The `never`
 * parameter is what makes that a type error rather than a write to the wrong table.
 */
function unknownClaim(claim: never): never {
  throw new Error(`unknown delivery claim: ${JSON.stringify(claim)}`);
}

/**
 * The delivery history of chapter 6, and the claim that decides who sends.
 *
 * A claim is won by writing the row, not by asking whether one exists: the primary key is what
 * enforces "once a day", so `INSERT ... ON CONFLICT DO NOTHING RETURNING` is atomic on its own and
 * a second instance simply gets nothing back. No household row is locked, which matters because the
 * reconciliation sweep holds that lock every minute (ADR 0006, "발송 기록과 클레임").
 *
 * Nothing here decides policy. The retry ceiling, the lease and the next attempt time all arrive as
 * arguments, because `brief-dispatch.policy.ts` owns the retry table and a copy of it written in
 * SQL would drift from the original without anything failing.
 */
export class PrismaBriefDeliveryLog implements BriefDeliveryLogPort {
  constructor(private readonly prisma: PrismaTransaction) {}

  /**
   * Today's briefs that are due: the ones not claimed yet, and the ones free to be claimed again.
   *
   * Two statements rather than one because they are two different things. The first takes rows that
   * do not exist yet, the second takes rows that do and whose hold has lapsed, and neither can be
   * expressed as the other.
   */
  async claimDueDailyBriefs(due: DeliveryDue): Promise<DailyBriefClaim[]> {
    const claimed = await this.prisma.$queryRaw<BriefClaimRow[]>`
      INSERT INTO brief_delivery (household_id, brief_date, status, attempts, claimed_at, updated_at)
      SELECT h.id, ${due.date}::date, 'pending'::delivery_status, 1, ${due.instant}, ${due.instant}
      FROM household h
      LEFT JOIN alert_settings a ON a.household_id = h.id
      WHERE COALESCE(a.brief_time, ${DEFAULT_BRIEF_TIME}) <= ${due.time}
      ON CONFLICT (household_id, brief_date) DO NOTHING
      RETURNING household_id, attempts
    `;

    const reclaimed = await this.prisma.$queryRaw<BriefClaimRow[]>`
      UPDATE brief_delivery
      SET status = 'pending'::delivery_status,
          attempts = attempts + 1,
          claimed_at = ${due.instant},
          updated_at = ${due.instant}
      WHERE brief_date = ${due.date}::date
        AND attempts < ${due.maxAttempts}
        AND ( (status = 'pending'::delivery_status AND claimed_at <= ${this.leaseCutoff(due)})
           OR (status = 'failed'::delivery_status AND next_attempt_at <= ${due.instant}) )
      RETURNING household_id, attempts
    `;

    return [...claimed, ...reclaimed].map((row) => ({
      kind: 'brief',
      householdId: row.household_id,
      date: due.date,
      attempts: row.attempts,
    }));
  }

  /**
   * The follow-ups whose meal time has passed. `slot_schedule` is joined straight, not left: a
   * household that never set a meal time has no slot to ask about.
   */
  async claimDueReactionPrompts(due: DeliveryDue): Promise<ReactionPromptClaim[]> {
    const claimed = await this.prisma.$queryRaw<ReactionClaimRow[]>`
      INSERT INTO reaction_prompt_delivery (household_id, date, slot, status, attempts, claimed_at, updated_at)
      SELECT s.household_id, ${due.date}::date, s.slot, 'pending'::delivery_status, 1, ${due.instant}, ${due.instant}
      FROM slot_schedule s
      WHERE s.meal_time <= ${due.time}
      ON CONFLICT (household_id, date, slot) DO NOTHING
      RETURNING household_id, slot, attempts
    `;

    const reclaimed = await this.prisma.$queryRaw<ReactionClaimRow[]>`
      UPDATE reaction_prompt_delivery
      SET status = 'pending'::delivery_status,
          attempts = attempts + 1,
          claimed_at = ${due.instant},
          updated_at = ${due.instant}
      WHERE date = ${due.date}::date
        AND attempts < ${due.maxAttempts}
        AND ( (status = 'pending'::delivery_status AND claimed_at <= ${this.leaseCutoff(due)})
           OR (status = 'failed'::delivery_status AND next_attempt_at <= ${due.instant}) )
      RETURNING household_id, slot, attempts
    `;

    return [...claimed, ...reclaimed].map((row) => ({
      kind: 'reaction_prompt',
      householdId: row.household_id,
      date: due.date,
      slot: row.slot,
      attempts: row.attempts,
    }));
  }

  /**
   * Today's stock alerts that are due. The alert goes out at the brief time, because ADR 0010 adds no
   * setting of its own, so the condition is the one the brief claim uses.
   */
  async claimDueStockAlerts(due: DeliveryDue): Promise<StockAlertClaim[]> {
    const claimed = await this.prisma.$queryRaw<BriefClaimRow[]>`
      INSERT INTO stock_alert_delivery (household_id, date, status, attempts, claimed_at, updated_at)
      SELECT h.id, ${due.date}::date, 'pending'::delivery_status, 1, ${due.instant}, ${due.instant}
      FROM household h
      LEFT JOIN alert_settings a ON a.household_id = h.id
      WHERE COALESCE(a.brief_time, ${DEFAULT_BRIEF_TIME}) <= ${due.time}
      ON CONFLICT (household_id, date) DO NOTHING
      RETURNING household_id, attempts
    `;

    const reclaimed = await this.prisma.$queryRaw<BriefClaimRow[]>`
      UPDATE stock_alert_delivery
      SET status = 'pending'::delivery_status,
          attempts = attempts + 1,
          claimed_at = ${due.instant},
          updated_at = ${due.instant}
      WHERE date = ${due.date}::date
        AND attempts < ${due.maxAttempts}
        AND ( (status = 'pending'::delivery_status AND claimed_at <= ${this.leaseCutoff(due)})
           OR (status = 'failed'::delivery_status AND next_attempt_at <= ${due.instant}) )
      RETURNING household_id, attempts
    `;

    return [...claimed, ...reclaimed].map((row) => ({
      kind: 'stock_alert',
      householdId: row.household_id,
      date: due.date,
      attempts: row.attempts,
    }));
  }

  async recordSent(claim: DeliveryClaim, reference: string, at: Date): Promise<void> {
    if (claim.kind === 'brief') {
      await this.prisma.$executeRaw`
        UPDATE brief_delivery
        SET status = 'sent'::delivery_status, sent_at = ${at}, message_reference = ${reference}, updated_at = ${at}
        WHERE household_id = ${claim.householdId}::uuid AND brief_date = ${claim.date}::date
      `;
      return;
    }
    if (claim.kind === 'stock_alert') {
      await this.prisma.$executeRaw`
        UPDATE stock_alert_delivery
        SET status = 'sent'::delivery_status, sent_at = ${at}, message_reference = ${reference}, updated_at = ${at}
        WHERE household_id = ${claim.householdId}::uuid AND date = ${claim.date}::date
      `;
      return;
    }
    if (claim.kind === 'reaction_prompt') {
      await this.prisma.$executeRaw`
        UPDATE reaction_prompt_delivery
        SET status = 'sent'::delivery_status, sent_at = ${at}, message_reference = ${reference}, updated_at = ${at}
        WHERE household_id = ${claim.householdId}::uuid
          AND date = ${claim.date}::date
          AND slot = ${claim.slot}::meal_slot
      `;
      return;
    }
    unknownClaim(claim);
  }

  /** 종결이다. 보낼 곳이 없었다는 기록이고, 다음 클레임 질의가 이 행을 다시 잡지 않는다. */
  async recordSkipped(claim: DeliveryClaim, reason: string, at: Date): Promise<void> {
    if (claim.kind === 'brief') {
      await this.prisma.$executeRaw`
        UPDATE brief_delivery
        SET status = 'skipped'::delivery_status, outcome_reason = ${reason}, updated_at = ${at}
        WHERE household_id = ${claim.householdId}::uuid AND brief_date = ${claim.date}::date
      `;
      return;
    }
    if (claim.kind === 'stock_alert') {
      await this.prisma.$executeRaw`
        UPDATE stock_alert_delivery
        SET status = 'skipped'::delivery_status, outcome_reason = ${reason}, updated_at = ${at}
        WHERE household_id = ${claim.householdId}::uuid AND date = ${claim.date}::date
      `;
      return;
    }
    if (claim.kind === 'reaction_prompt') {
      await this.prisma.$executeRaw`
        UPDATE reaction_prompt_delivery
        SET status = 'skipped'::delivery_status, outcome_reason = ${reason}, updated_at = ${at}
        WHERE household_id = ${claim.householdId}::uuid
          AND date = ${claim.date}::date
          AND slot = ${claim.slot}::meal_slot
      `;
      return;
    }
    unknownClaim(claim);
  }

  /**
   * `nextAttemptAt` is written even on the last attempt, which is what the CHECK on a `failed` row
   * wants. What keeps that row from being picked up again is the attempts ceiling in the claim
   * query, not this column.
   */
  async recordFailed(claim: DeliveryClaim, error: string, at: Date, nextAttemptAt: Date): Promise<void> {
    if (claim.kind === 'brief') {
      await this.prisma.$executeRaw`
        UPDATE brief_delivery
        SET status = 'failed'::delivery_status,
            next_attempt_at = ${nextAttemptAt},
            outcome_reason = ${error},
            updated_at = ${at}
        WHERE household_id = ${claim.householdId}::uuid AND brief_date = ${claim.date}::date
      `;
      return;
    }
    if (claim.kind === 'stock_alert') {
      await this.prisma.$executeRaw`
        UPDATE stock_alert_delivery
        SET status = 'failed'::delivery_status,
            next_attempt_at = ${nextAttemptAt},
            outcome_reason = ${error},
            updated_at = ${at}
        WHERE household_id = ${claim.householdId}::uuid AND date = ${claim.date}::date
      `;
      return;
    }
    if (claim.kind === 'reaction_prompt') {
      await this.prisma.$executeRaw`
        UPDATE reaction_prompt_delivery
        SET status = 'failed'::delivery_status,
            next_attempt_at = ${nextAttemptAt},
            outcome_reason = ${error},
            updated_at = ${at}
        WHERE household_id = ${claim.householdId}::uuid
          AND date = ${claim.date}::date
          AND slot = ${claim.slot}::meal_slot
      `;
      return;
    }
    unknownClaim(claim);
  }

  /**
   * Gives the claim back by deleting the row this sweep just wrote, so the next tick claims it
   * afresh. `status = 'pending'` is in the condition because the row being removed is the one this
   * caller is holding: a row that has since been finished is not ours to delete.
   */
  async releaseClaim(claim: ReactionPromptClaim): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM reaction_prompt_delivery
      WHERE household_id = ${claim.householdId}::uuid
        AND date = ${claim.date}::date
        AND slot = ${claim.slot}::meal_slot
        AND status = 'pending'::delivery_status
    `;
  }

  /** 이 시각보다 오래 잡혀 있던 pending 행은 발송 중에 죽은 것으로 본다. */
  private leaseCutoff(due: DeliveryDue): Date {
    return new Date(due.instant.getTime() - due.leaseSeconds * MS_PER_SECOND);
  }
}
