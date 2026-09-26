-- CreateEnum
CREATE TYPE "slack_template_key" AS ENUM ('daily_brief', 'reaction_prompt');

-- CreateTable
CREATE TABLE "slack_message" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "channel_id" TEXT NOT NULL,
    "message_ts" TEXT NOT NULL,
    "template_key" "slack_template_key" NOT NULL,
    "template_version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "posted_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "slack_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slack_message_household_id_posted_at_idx" ON "slack_message"("household_id", "posted_at");

-- CreateIndex
CREATE UNIQUE INDEX "slack_message_channel_id_message_ts_key" ON "slack_message"("channel_id", "message_ts");

-- AddForeignKey
ALTER TABLE "slack_message" ADD CONSTRAINT "slack_message_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 여기부터는 손으로 덧붙인 제약이다. Prisma 스키마 언어에 CHECK가 없다.
-- ============================================================================

-- 버전은 1부터 센다.
ALTER TABLE "slack_message" ADD CONSTRAINT "slack_message_template_version_check" CHECK ("template_version" >= 1);
