-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- AlterTable
ALTER TABLE "household" ADD COLUMN     "slack_channel_id" TEXT;

-- CreateTable
CREATE TABLE "brief_delivery" (
    "household_id" UUID NOT NULL,
    "brief_date" DATE NOT NULL,
    "status" "delivery_status" NOT NULL,
    "attempts" INTEGER NOT NULL,
    "claimed_at" TIMESTAMPTZ(3) NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "outcome_reason" TEXT,
    "message_reference" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "brief_delivery_pkey" PRIMARY KEY ("household_id","brief_date")
);

-- CreateTable
CREATE TABLE "reaction_prompt_delivery" (
    "household_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "slot" "meal_slot" NOT NULL,
    "status" "delivery_status" NOT NULL,
    "attempts" INTEGER NOT NULL,
    "claimed_at" TIMESTAMPTZ(3) NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "outcome_reason" TEXT,
    "message_reference" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reaction_prompt_delivery_pkey" PRIMARY KEY ("household_id","date","slot")
);

-- AddForeignKey
ALTER TABLE "brief_delivery" ADD CONSTRAINT "brief_delivery_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reaction_prompt_delivery" ADD CONSTRAINT "reaction_prompt_delivery_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 여기부터는 손으로 덧붙인 제약이다. Prisma 스키마 언어에 CHECK와 부분 인덱스가 없다.
-- ============================================================================

-- 클레임하는 순간이 1회째다. 0이나 음수는 시도를 세는 방식이 어긋났다는 뜻이다.
ALTER TABLE "brief_delivery" ADD CONSTRAINT "brief_delivery_attempts_check" CHECK ("attempts" >= 1);

-- 보냈다는 기록에는 보낸 시각과 메시지 참조가 반드시 함께 있다.
ALTER TABLE "brief_delivery" ADD CONSTRAINT "brief_delivery_sent_check"
    CHECK (("status" = 'sent') = ("sent_at" IS NOT NULL) AND ("status" = 'sent') = ("message_reference" IS NOT NULL));

-- 실패한 행에는 다음 시도 시각과 사유가 있어야 한다. 마지막 시도도 예외가 아니다.
ALTER TABLE "brief_delivery" ADD CONSTRAINT "brief_delivery_failed_check"
    CHECK ("status" <> 'failed' OR ("next_attempt_at" IS NOT NULL AND "outcome_reason" IS NOT NULL));

-- 건너뛴 이유가 없으면 나중에 왜 안 갔는지 알 수 없다.
ALTER TABLE "brief_delivery" ADD CONSTRAINT "brief_delivery_skipped_check"
    CHECK ("status" <> 'skipped' OR "outcome_reason" IS NOT NULL);

-- 후속 메시지 이력도 같은 넷을 건다. 컬럼 구성이 같으므로 규칙도 같다.
ALTER TABLE "reaction_prompt_delivery" ADD CONSTRAINT "reaction_prompt_delivery_attempts_check" CHECK ("attempts" >= 1);

ALTER TABLE "reaction_prompt_delivery" ADD CONSTRAINT "reaction_prompt_delivery_sent_check"
    CHECK (("status" = 'sent') = ("sent_at" IS NOT NULL) AND ("status" = 'sent') = ("message_reference" IS NOT NULL));

ALTER TABLE "reaction_prompt_delivery" ADD CONSTRAINT "reaction_prompt_delivery_failed_check"
    CHECK ("status" <> 'failed' OR ("next_attempt_at" IS NOT NULL AND "outcome_reason" IS NOT NULL));

ALTER TABLE "reaction_prompt_delivery" ADD CONSTRAINT "reaction_prompt_delivery_skipped_check"
    CHECK ("status" <> 'skipped' OR "outcome_reason" IS NOT NULL);
