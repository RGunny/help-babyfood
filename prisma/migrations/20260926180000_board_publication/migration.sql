-- CreateEnum
CREATE TYPE "publication_status" AS ENUM ('published', 'skipped', 'failed');

-- AlterTable
ALTER TABLE "household" ADD COLUMN     "state_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "board_publication" (
    "household_id" UUID NOT NULL,
    "status" "publication_status" NOT NULL,
    "synced_state_at" TIMESTAMPTZ(3),
    "synced_on" DATE,
    "attempts" INTEGER NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(3),
    "outcome_reason" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "board_publication_pkey" PRIMARY KEY ("household_id")
);

-- CreateTable
CREATE TABLE "slack_canvas" (
    "household_id" UUID NOT NULL,
    "channel_id" TEXT NOT NULL,
    "canvas_id" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "slack_canvas_pkey" PRIMARY KEY ("household_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slack_canvas_channel_id_canvas_id_key" ON "slack_canvas"("channel_id", "canvas_id");

-- AddForeignKey
ALTER TABLE "board_publication" ADD CONSTRAINT "board_publication_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_canvas" ADD CONSTRAINT "slack_canvas_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 여기부터는 손으로 덧붙인 제약이다. Prisma 스키마 언어에 CHECK가 없다.
-- ============================================================================

-- 연속 실패 횟수다. 성공하면 0이고 음수는 세는 방식이 어긋났다는 뜻이다.
ALTER TABLE "board_publication" ADD CONSTRAINT "board_publication_attempts_check" CHECK ("attempts" >= 0);

-- 발행했거나 건너뛴 행은 어느 상태 시각과 어느 날까지 맞췄는지를 반드시 말한다.
ALTER TABLE "board_publication" ADD CONSTRAINT "board_publication_synced_check"
    CHECK ("status" = 'failed' OR ("synced_state_at" IS NOT NULL AND "synced_on" IS NOT NULL));

-- 실패한 행에는 다음 시도 시각과 사유가 있어야 한다.
ALTER TABLE "board_publication" ADD CONSTRAINT "board_publication_failed_check"
    CHECK ("status" <> 'failed' OR ("next_attempt_at" IS NOT NULL AND "outcome_reason" IS NOT NULL));

-- 건너뛴 이유가 없으면 나중에 왜 안 올라갔는지 알 수 없다.
ALTER TABLE "board_publication" ADD CONSTRAINT "board_publication_skipped_check"
    CHECK ("status" <> 'skipped' OR "outcome_reason" IS NOT NULL);

-- 템플릿 버전은 1부터 센다.
ALTER TABLE "slack_canvas" ADD CONSTRAINT "slack_canvas_template_version_check" CHECK ("template_version" >= 1);
