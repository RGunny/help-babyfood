# Phase 1: schema

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md`
- `tasks/4-blend-cube/docs-diff.md` (phase 0이 고친 문서. ADR 0011의 "테이블과 되돌림"과 "구성 재료별 중량은 저장하지 않는다"가 이 phase의 근거다)
- `docs/adr/0002-orm-prisma.md`의 "대가" 절 (CHECK 제약은 마이그레이션 SQL에만 쓰고, Prisma가 표현할 수 있는 것은 스키마에도 선언한다는 구분)
- `prisma/schema.prisma`의 `model Ingredient`, `model MenuComponent`, `model ForbiddenPairing` (`@map`과 `@@map` 관례, `///` 주석 문체, 한 모델을 두 번 가리킬 때 관계 이름을 붙이는 방식)
- `prisma/migrations/20261005120000_stock_alert/migration.sql` (가장 최근 마이그레이션. CreateTable, AddForeignKey의 SQL 모양과 손으로 덧붙인 부분의 구분선 주석)
- `prisma/migrations/20260921134349_init/migration.sql`에서 `menu_component`가 나오는 줄들 (같은 모양의 테이블)
- `test/integration/schema-constraints.int-spec.ts` (제약을 직접 SQL과 Prisma로 찔러 보는 방식. 맨 아래 `재고 알람 발송 이력` describe의 `constraintNames` 헬퍼)
- `test/integration/setup/global-setup.ts` (`prisma migrate deploy`로 템플릿 DB를 만든다. `pnpm test:int`가 곧 마이그레이션 적용 검증이다)

## 작업 내용

테이블 하나와 그 마이그레이션, 제약을 찌르는 통합 테스트를 더한다. 새 모델만 더하므로 기존 `prisma.*.create` 호출과 도메인 타입은 영향이 없다. 도메인 타입은 phase 2가, 읽기와 쓰기는 phase 3이 한다.

### 1. `prisma/schema.prisma`

`model MenuComponent` 근처에 모델 하나를 더한다.

```prisma
/// 합침 재료의 구성. 쌀오트밀 큐브는 쌀과 오트밀로 만든다. 재고는 합침 재료로 세고
/// 급여는 구성 재료로 센다(ADR 0011). 구성 재료별 중량은 읽는 곳이 없어 두지 않는다.
model IngredientConstituent {
  blendIngredientId       String @map("blend_ingredient_id") @db.Uuid
  constituentIngredientId String @map("constituent_ingredient_id") @db.Uuid

  blend       Ingredient @relation("blend", fields: [blendIngredientId], references: [id], onDelete: Cascade)
  constituent Ingredient @relation("blend_constituent", fields: [constituentIngredientId], references: [id])

  @@id([blendIngredientId, constituentIngredientId])
  @@index([constituentIngredientId])
  @@map("ingredient_constituent")
}
```

`model Ingredient`의 관계 목록에 두 줄을 더한다.

```prisma
  constituents     IngredientConstituent[] @relation("blend")
  constituentOf    IngredientConstituent[] @relation("blend_constituent")
```

### 2. `prisma/migrations/20261006120000_ingredient_constituent/migration.sql`

손으로 쓴다. `pnpm db:migrate --create-only`는 살아 있는 DB가 필요하고 이 환경에는 없다. 내용은 아래와 같다.

```sql
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
```

기존 행을 바꾸는 문장은 없다. 되돌림은 `DROP TABLE "ingredient_constituent"`다(ADR 0011).

### 3. `test/integration/schema-constraints.int-spec.ts`

파일 끝에 `describe('합침 재료의 구성', …)`을 더한다. 재료 행은 이 파일의 다른 테스트가 하는 방식대로 `prisma.ingredient.create`로 직접 만든다. 테스트 이름은 규칙을 한국어로 서술한다(AGENTS.md 금지 7번).

- "합침 재료의 구성에 자기 자신 금지 제약과 두 FK가 걸려 있다": `constraintNames('ingredient_constituent')`가 `ingredient_constituent_not_self_check`, `ingredient_constituent_blend_ingredient_id_fkey`, `ingredient_constituent_constituent_ingredient_id_fkey`를 담는다. `constraintNames` 헬퍼가 다른 describe 안에 있으면 같은 모양으로 이 describe 안에 다시 둔다. 기존 describe를 고치지 마라.
- "합침 재료는 자기 자신을 구성 재료로 가질 수 없다": 같은 id 둘로 넣으면 `ingredient_constituent_not_self_check`로 거부된다.
- "같은 구성 재료를 두 번 넣을 수 없다": 같은 쌍을 두 번 넣으면 기본키로 거부된다.
- "구성 재료로 쓰이는 재료는 지울 수 없고, 합침 재료를 지우면 구성 행도 지워진다": constituent 쪽은 RESTRICT, blend 쪽은 CASCADE다.

### 4. 클라이언트 재생성

`pnpm prisma:generate`를 돌린다. `src/generated/`는 gitignore 대상이라 커밋에 들지 않지만, 이 세션의 `pnpm typecheck`와 뒤 phase가 새 모델을 보려면 생성되어 있어야 한다.

## Acceptance Criteria

```bash
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
test -f prisma/migrations/20261006120000_ingredient_constituent/migration.sql
grep -q 'CREATE TABLE "ingredient_constituent"' prisma/migrations/20261006120000_ingredient_constituent/migration.sql
grep -q 'ingredient_constituent_not_self_check' prisma/migrations/20261006120000_ingredient_constituent/migration.sql
grep -q '@@map("ingredient_constituent")' prisma/schema.prisma
! grep -iE 'weight|gram|position' prisma/migrations/20261006120000_ingredient_constituent/migration.sql
test "$(ls -d prisma/migrations/*/ | wc -l)" -eq 9
grep -q '합침 재료는 자기 자신을 구성 재료로 가질 수 없다' test/integration/schema-constraints.int-spec.ts
! git diff HEAD -- test/integration/schema-constraints.int-spec.ts | grep -E '^-[^-]' | grep -vE '^-import '
git diff --quiet HEAD -- src docs README.md package.json
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `pnpm test:int`는 Docker가 필요하다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- `ingredient_constituent`에 중량, 순서, 가정 id 컬럼을 두지 마라. 이유: 읽는 곳이 없다(ADR 0011 대가 절). tech-critic-lead의 승인 조건이고 AC의 grep이 중량과 순서를 잡는다.
- `src/`를 고치지 마라. 이유: 도메인 타입은 phase 2, 읽기와 쓰기는 phase 3이다. AC의 마지막 줄이 잡는다.
- `test/integration/schema-constraints.int-spec.ts`의 기존 테스트를 고치거나 지우지 마라. 더하기만 한다. import 줄에 이름을 더하는 것은 된다. 이유: AC가 import가 아닌 지워진 줄을 잡는다.
- 마이그레이션을 둘 이상 만들지 마라. 이유: AC가 디렉터리 수 9를 검사한다.
- 기존 마이그레이션 파일을 고치지 마라. 이유: 운영 DB에 이미 적용됐다.
- `ingredient` 테이블에 컬럼을 더하지 마라. 이유: 합침 재료인지는 구성 행이 있는지로 안다. 따로 저장하면 계산할 수 있는 상태의 저장이다(AGENTS.md 금지 3번).
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
