-- CreateTable
CREATE TABLE "ingredient_constituent" (
    "blend_ingredient_id" UUID NOT NULL,
    "constituent_ingredient_id" UUID NOT NULL,

    CONSTRAINT "ingredient_constituent_pkey" PRIMARY KEY ("blend_ingredient_id","constituent_ingredient_id")
);

-- CreateIndex
CREATE INDEX "ingredient_constituent_constituent_ingredient_id_idx" ON "ingredient_constituent"("constituent_ingredient_id");

-- AddForeignKey
ALTER TABLE "ingredient_constituent" ADD CONSTRAINT "ingredient_constituent_blend_ingredient_id_fkey" FOREIGN KEY ("blend_ingredient_id") REFERENCES "ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_constituent" ADD CONSTRAINT "ingredient_constituent_constituent_ingredient_id_fkey" FOREIGN KEY ("constituent_ingredient_id") REFERENCES "ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 여기부터는 손으로 덧붙인 제약이다. Prisma 스키마 언어에 CHECK와 부분 인덱스가 없다.
-- ============================================================================

-- 합침 재료는 자기 자신으로 만들 수 없다.
ALTER TABLE "ingredient_constituent" ADD CONSTRAINT "ingredient_constituent_not_self_check"
    CHECK ("blend_ingredient_id" <> "constituent_ingredient_id");
