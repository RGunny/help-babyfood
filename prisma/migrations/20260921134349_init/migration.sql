-- CreateEnum
CREATE TYPE "meal_slot" AS ENUM ('morning', 'afternoon');

-- CreateEnum
CREATE TYPE "ingredient_category" AS ENUM ('base', 'meat', 'vegetable', 'high_risk_allergen');

-- CreateEnum
CREATE TYPE "ledger_entry_type" AS ENUM ('received', 'meal_consumed', 'consumption_reverted', 'discarded', 'count_adjusted');

-- CreateEnum
CREATE TYPE "meal_status" AS ENUM ('planned', 'consumed');

-- CreateEnum
CREATE TYPE "composition_kind" AS ENUM ('planned', 'actual');

-- CreateEnum
CREATE TYPE "feeding_reaction_result" AS ENUM ('clear', 'reacted');

-- CreateEnum
CREATE TYPE "pairing_scope" AS ENUM ('same_meal', 'same_day');

-- CreateEnum
CREATE TYPE "actor_source" AS ENUM ('member', 'scheduler');

-- CreateTable
CREATE TABLE "household" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slack_user_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ingredient_category" NOT NULL,
    "serving_weight_gram" INTEGER NOT NULL,
    "verified_before_migration" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_label" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "normalized_label" TEXT NOT NULL,
    "is_canonical" BOOLEAN NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ingredient_label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_component" (
    "menu_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "cubes" INTEGER NOT NULL,

    CONSTRAINT "menu_component_pkey" PRIMARY KEY ("menu_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "cooked_batch" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "cube_weight_gram" INTEGER NOT NULL,
    "cooked_on" DATE NOT NULL,
    "remaining_cubes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_member_id" UUID,

    CONSTRAINT "cooked_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_ledger_entry" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "type" "ledger_entry_type" NOT NULL,
    "delta" INTEGER NOT NULL,
    "meal_id" UUID,
    "reason" TEXT,
    "no_feed_key" TEXT,
    "actor_source" "actor_source" NOT NULL,
    "actor_member_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_schedule" (
    "household_id" UUID NOT NULL,
    "slot" "meal_slot" NOT NULL,
    "start_date" DATE NOT NULL,
    "meal_time" VARCHAR(5) NOT NULL,

    CONSTRAINT "slot_schedule_pkey" PRIMARY KEY ("household_id","slot")
);

-- CreateTable
CREATE TABLE "meal" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "slot" "meal_slot" NOT NULL,
    "meal_order" INTEGER NOT NULL,
    "planned_base_menu_id" UUID,
    "memo" TEXT,
    "status" "meal_status" NOT NULL DEFAULT 'planned',
    "migrated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_member_id" UUID,

    CONSTRAINT "meal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_actual" (
    "meal_id" UUID NOT NULL,
    "actual_base_menu_id" UUID,

    CONSTRAINT "meal_actual_pkey" PRIMARY KEY ("meal_id")
);

-- CreateTable
CREATE TABLE "meal_topping" (
    "meal_id" UUID NOT NULL,
    "kind" "composition_kind" NOT NULL,
    "position" INTEGER NOT NULL,
    "ingredient_id" UUID NOT NULL,

    CONSTRAINT "meal_topping_pkey" PRIMARY KEY ("meal_id","kind","position")
);

-- CreateTable
CREATE TABLE "no_feed_record" (
    "household_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "slot" "meal_slot" NOT NULL,
    "thawed" BOOLEAN NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_member_id" UUID,

    CONSTRAINT "no_feed_record_pkey" PRIMARY KEY ("household_id","date","slot")
);

-- CreateTable
CREATE TABLE "feeding_reaction" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "meal_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "result" "feeding_reaction_result" NOT NULL,
    "symptom_memo" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_member_id" UUID,

    CONSTRAINT "feeding_reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_planning_rules" (
    "household_id" UUID NOT NULL,
    "text_guidance" TEXT,
    "max_first_introductions_per_day" INTEGER,
    "first_introduction_slot" "meal_slot",
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meal_planning_rules_pkey" PRIMARY KEY ("household_id")
);

-- CreateTable
CREATE TABLE "forbidden_pairing" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "ingredient_a_id" UUID NOT NULL,
    "ingredient_b_id" UUID NOT NULL,
    "scope" "pairing_scope" NOT NULL,

    CONSTRAINT "forbidden_pairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_settings" (
    "household_id" UUID NOT NULL,
    "brief_time" VARCHAR(5) NOT NULL,
    "shelf_life_days" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "alert_settings_pkey" PRIMARY KEY ("household_id")
);

-- CreateTable
CREATE TABLE "ingredient_threshold" (
    "household_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "threshold_cubes" INTEGER NOT NULL,

    CONSTRAINT "ingredient_threshold_pkey" PRIMARY KEY ("ingredient_id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "household_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("household_id","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_slack_user_id_key" ON "member"("slack_user_id");

-- CreateIndex
CREATE INDEX "member_household_id_idx" ON "member"("household_id");

-- CreateIndex
CREATE INDEX "ingredient_household_id_idx" ON "ingredient"("household_id");

-- CreateIndex
CREATE INDEX "ingredient_label_ingredient_id_idx" ON "ingredient_label"("ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_label_household_id_normalized_label_key" ON "ingredient_label"("household_id", "normalized_label");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_label_ingredient_id_position_key" ON "ingredient_label"("ingredient_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "menu_household_id_name_key" ON "menu"("household_id", "name");

-- CreateIndex
CREATE INDEX "menu_component_ingredient_id_idx" ON "menu_component"("ingredient_id");

-- CreateIndex
CREATE INDEX "cooked_batch_household_id_ingredient_id_cooked_on_idx" ON "cooked_batch"("household_id", "ingredient_id", "cooked_on");

-- CreateIndex
CREATE INDEX "stock_ledger_entry_household_id_batch_id_idx" ON "stock_ledger_entry"("household_id", "batch_id");

-- CreateIndex
CREATE INDEX "stock_ledger_entry_meal_id_idx" ON "stock_ledger_entry"("meal_id");

-- CreateIndex
CREATE INDEX "stock_ledger_entry_household_id_no_feed_key_idx" ON "stock_ledger_entry"("household_id", "no_feed_key");

-- CreateIndex
CREATE UNIQUE INDEX "meal_household_id_slot_meal_order_key" ON "meal"("household_id", "slot", "meal_order");

-- CreateIndex
CREATE INDEX "meal_topping_ingredient_id_idx" ON "meal_topping"("ingredient_id");

-- CreateIndex
CREATE INDEX "feeding_reaction_household_id_ingredient_id_idx" ON "feeding_reaction"("household_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "feeding_reaction_meal_id_ingredient_id_key" ON "feeding_reaction"("meal_id", "ingredient_id");

-- CreateIndex
CREATE INDEX "forbidden_pairing_ingredient_b_id_idx" ON "forbidden_pairing"("ingredient_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "forbidden_pairing_household_id_ingredient_a_id_ingredient_b_key" ON "forbidden_pairing"("household_id", "ingredient_a_id", "ingredient_b_id", "scope");

-- CreateIndex
CREATE INDEX "ingredient_threshold_household_id_idx" ON "ingredient_threshold"("household_id");

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_label" ADD CONSTRAINT "ingredient_label_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_label" ADD CONSTRAINT "ingredient_label_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu" ADD CONSTRAINT "menu_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_component" ADD CONSTRAINT "menu_component_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_component" ADD CONSTRAINT "menu_component_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cooked_batch" ADD CONSTRAINT "cooked_batch_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cooked_batch" ADD CONSTRAINT "cooked_batch_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cooked_batch" ADD CONSTRAINT "cooked_batch_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entry" ADD CONSTRAINT "stock_ledger_entry_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entry" ADD CONSTRAINT "stock_ledger_entry_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "cooked_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entry" ADD CONSTRAINT "stock_ledger_entry_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entry" ADD CONSTRAINT "stock_ledger_entry_actor_member_id_fkey" FOREIGN KEY ("actor_member_id") REFERENCES "member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_schedule" ADD CONSTRAINT "slot_schedule_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal" ADD CONSTRAINT "meal_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal" ADD CONSTRAINT "meal_planned_base_menu_id_fkey" FOREIGN KEY ("planned_base_menu_id") REFERENCES "menu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal" ADD CONSTRAINT "meal_updated_by_member_id_fkey" FOREIGN KEY ("updated_by_member_id") REFERENCES "member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_actual" ADD CONSTRAINT "meal_actual_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_actual" ADD CONSTRAINT "meal_actual_actual_base_menu_id_fkey" FOREIGN KEY ("actual_base_menu_id") REFERENCES "menu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_topping" ADD CONSTRAINT "meal_topping_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_topping" ADD CONSTRAINT "meal_topping_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "no_feed_record" ADD CONSTRAINT "no_feed_record_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "no_feed_record" ADD CONSTRAINT "no_feed_record_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_reaction" ADD CONSTRAINT "feeding_reaction_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_reaction" ADD CONSTRAINT "feeding_reaction_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_reaction" ADD CONSTRAINT "feeding_reaction_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeding_reaction" ADD CONSTRAINT "feeding_reaction_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_planning_rules" ADD CONSTRAINT "meal_planning_rules_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forbidden_pairing" ADD CONSTRAINT "forbidden_pairing_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forbidden_pairing" ADD CONSTRAINT "forbidden_pairing_ingredient_a_id_fkey" FOREIGN KEY ("ingredient_a_id") REFERENCES "ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forbidden_pairing" ADD CONSTRAINT "forbidden_pairing_ingredient_b_id_fkey" FOREIGN KEY ("ingredient_b_id") REFERENCES "ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_settings" ADD CONSTRAINT "alert_settings_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_threshold" ADD CONSTRAINT "ingredient_threshold_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_threshold" ADD CONSTRAINT "ingredient_threshold_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 여기부터는 손으로 덧붙인 제약이다. Prisma 스키마 언어에 CHECK와 부분 인덱스가 없다.
-- 도메인 코어가 검사하는 불변식 가운데, 어겨지면 재고 숫자가 조용히 틀어지는 것만 골랐다.
-- ============================================================================

-- src/domain/stock/ledger.ts의 assertValidEntry와 같은 규칙.
ALTER TABLE "stock_ledger_entry" ADD CONSTRAINT "stock_ledger_entry_delta_sign_check" CHECK (
    CASE "type"
        WHEN 'received' THEN "delta" > 0
        WHEN 'meal_consumed' THEN "delta" < 0
        WHEN 'consumption_reverted' THEN "delta" > 0
        WHEN 'discarded' THEN "delta" < 0
        WHEN 'count_adjusted' THEN "delta" <> 0
    END
);

-- 소비와 소비 취소는 어느 식단의 것인지 알 수 없으면 되돌릴 수 없다.
ALTER TABLE "stock_ledger_entry" ADD CONSTRAINT "stock_ledger_entry_meal_required_check" CHECK (
    "type" NOT IN ('meal_consumed', 'consumption_reverted') OR "meal_id" IS NOT NULL
);

-- 수행자는 구성원이거나 스케줄러다. 둘 다이거나 둘 다 아닌 경우는 없다.
ALTER TABLE "stock_ledger_entry" ADD CONSTRAINT "stock_ledger_entry_actor_check" CHECK (
    ("actor_source" = 'member') = ("actor_member_id" IS NOT NULL)
);

-- 재고는 음수로 내려가지 않는다. 도메인의 allocateOldestFirst가 이미 막지만,
-- 동시 차감에서 잠금이 빠지면 여기서 걸린다.
ALTER TABLE "cooked_batch" ADD CONSTRAINT "cooked_batch_remaining_cubes_check" CHECK ("remaining_cubes" >= 0);
ALTER TABLE "cooked_batch" ADD CONSTRAINT "cooked_batch_cube_weight_gram_check" CHECK ("cube_weight_gram" > 0);

ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_serving_weight_gram_check" CHECK ("serving_weight_gram" > 0);

ALTER TABLE "menu_component" ADD CONSTRAINT "menu_component_cubes_check" CHECK ("cubes" > 0);

-- 식단 순서는 1부터다(src/domain/meal-plan/meal.ts).
ALTER TABLE "meal" ADD CONSTRAINT "meal_meal_order_check" CHECK ("meal_order" >= 1);

ALTER TABLE "meal_topping" ADD CONSTRAINT "meal_topping_position_check" CHECK ("position" >= 0);

-- 대표 이름은 position 0 하나다. (ingredient_id, position) 유니크와 합쳐져
-- 재료마다 대표 이름이 많아야 하나임을 보장한다.
ALTER TABLE "ingredient_label" ADD CONSTRAINT "ingredient_label_position_check" CHECK ("position" >= 0);
ALTER TABLE "ingredient_label" ADD CONSTRAINT "ingredient_label_canonical_check" CHECK ("is_canonical" = ("position" = 0));

-- LocalTime은 Asia/Seoul 벽시계 HH:mm이다(src/domain/shared/local-time.ts).
ALTER TABLE "slot_schedule" ADD CONSTRAINT "slot_schedule_meal_time_check" CHECK ("meal_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "alert_settings" ADD CONSTRAINT "alert_settings_brief_time_check" CHECK ("brief_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "alert_settings" ADD CONSTRAINT "alert_settings_shelf_life_days_check" CHECK ("shelf_life_days" > 0);

ALTER TABLE "ingredient_threshold" ADD CONSTRAINT "ingredient_threshold_cubes_check" CHECK ("threshold_cubes" >= 0);

ALTER TABLE "meal_planning_rules" ADD CONSTRAINT "meal_planning_rules_max_first_introductions_check" CHECK (
    "max_first_introductions_per_day" IS NULL OR "max_first_introductions_per_day" >= 0
);

-- 같은 쌍이 순서만 바꿔 두 번 들어가는 것을 막는다.
ALTER TABLE "forbidden_pairing" ADD CONSTRAINT "forbidden_pairing_order_check" CHECK ("ingredient_a_id" < "ingredient_b_id");

-- 적재 범위의 기준이 되는 "잔여가 있는 배치" 조회용. 이력이 쌓여도 인덱스 크기가
-- 냉동고에 실제로 있는 배치 수를 넘지 않는다.
CREATE INDEX "cooked_batch_open_idx" ON "cooked_batch" ("household_id", "ingredient_id", "cooked_on") WHERE "remaining_cubes" > 0;
