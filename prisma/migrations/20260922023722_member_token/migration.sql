-- CreateTable
CREATE TABLE "member_token" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_token_token_hash_key" ON "member_token"("token_hash");

-- CreateIndex
CREATE INDEX "member_token_household_id_idx" ON "member_token"("household_id");

-- CreateIndex
CREATE INDEX "member_token_member_id_idx" ON "member_token"("member_id");

-- AddForeignKey
ALTER TABLE "member_token" ADD CONSTRAINT "member_token_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_token" ADD CONSTRAINT "member_token_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 여기부터는 손으로 덧붙인 제약이다. Prisma 스키마 언어에 CHECK와 부분 인덱스가 없다.
-- ============================================================================

-- 저장하는 것은 해시뿐이다. 평문 토큰을 실수로 넣으면 길이와 글자에서 걸린다.
ALTER TABLE "member_token" ADD CONSTRAINT "member_token_hash_format_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$');

-- 만료 없는 토큰은 만들 수 없다. 검증기가 AuthInfo.expiresAt을 반드시 채워야 하고,
-- 비어 있으면 MCP SDK가 정상 토큰까지 401로 돌려준다.
ALTER TABLE "member_token" ADD CONSTRAINT "member_token_expiry_check" CHECK ("expires_at" > "created_at");
ALTER TABLE "member_token" ADD CONSTRAINT "member_token_revoked_check" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");

-- 토큰이 가리키는 구성원은 토큰이 가리키는 가정의 구성원이어야 한다. 어긋나면
-- 한 가정의 토큰으로 다른 가정을 쓰게 되고, 원장의 수행자도 남의 가정 사람이 된다.
ALTER TABLE "member" ADD CONSTRAINT "member_id_household_id_key" UNIQUE ("id", "household_id");
ALTER TABLE "member_token" ADD CONSTRAINT "member_token_member_household_fkey"
    FOREIGN KEY ("member_id", "household_id") REFERENCES "member"("id", "household_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 검증기가 매 요청에 타는 경로. 살아 있는 토큰만 인덱스에 남는다.
CREATE INDEX "member_token_active_idx" ON "member_token" ("token_hash") WHERE "revoked_at" IS NULL;
