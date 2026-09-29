# Phase 1: schema

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md`
- `tasks/2-pantry-and-expiry/docs-diff.md` (phase 0이 고친 문서. ADR 0009 (a)와 (c)가 이 phase의 근거다)
- `docs/adr/0002-orm-prisma.md`의 "대가" 절 (CHECK 제약은 마이그레이션 SQL에만 쓰고, Prisma가 표현할 수 있는 것은 스키마에도 선언한다는 구분. `pnpm db:drift`가 살아 있는 DB와 스키마의 차이를 잡는다)
- `prisma/schema.prisma`의 `enum IngredientCategory`와 `model Ingredient` (enum에 `@@map`을 두는 관례, 컬럼에 `@map`을 두는 관례, `///` 주석 문체)
- `prisma/migrations/20260926180000_board_publication/migration.sql` (가장 최근 마이그레이션. enum 생성과 컬럼 추가의 SQL 모양, 손으로 덧붙인 부분의 구분선 주석)
- `test/integration/setup/global-setup.ts` (`prisma migrate deploy`로 템플릿 DB를 만든다. `pnpm test:int`가 곧 마이그레이션 적용 검증이다)
- `prisma7.config.ts` (마이그레이션 디렉터리와 접속 설정)

## 작업 내용

스키마와 마이그레이션만 더한다. **이 phase에서는 어떤 코드도 새 컬럼을 읽거나 쓰지 않는다.** 생성된 Prisma 클라이언트에 필드가 생길 뿐이고, 그래서 `pnpm typecheck`가 그대로 통과한다. 도메인 타입과 매퍼는 phase 2가 고친다.

### 1. `prisma/schema.prisma`

enum 하나를 `IngredientCategory` 옆에 더한다.

```prisma
/// 재고를 세는 방식. cubes는 냉동 큐브를 배치와 원장으로 추적하고, pantry는 늘 집에 있어
/// 세지 않는다(땅콩버터, 계란, 밀가루). 상비 재료는 차감, 보류, 예측, 임계일에서 빠진다.
enum StockTracking {
  cubes
  pantry

  @@map("stock_tracking")
}
```

`model Ingredient`에 필드 하나를 `servingWeightGram` 뒤에 더한다. **`@default`를 두지 않는다.** 기본값은 마이그레이션이 기존 행을 채우는 동안만 있고 끝나면 없앤다. 스키마에 `@default`가 있으면 `DROP DEFAULT`한 DB와 어긋나 `pnpm db:drift`가 차이를 잡는다.

```prisma
  /// 재고를 세는 방식. 새 재료는 cubes로 시작하고 상비 전환은 update_ingredient_stock_tracking으로 한다.
  stockTracking           StockTracking      @map("stock_tracking")
```

### 2. `prisma/migrations/20260929120000_stock_tracking/migration.sql`

손으로 쓴다. `pnpm db:migrate --create-only`는 살아 있는 DB가 필요하고 이 환경에는 없다. 내용은 정확히 다음 셋이다.

```sql
-- CreateEnum
CREATE TYPE "stock_tracking" AS ENUM ('cubes', 'pantry');

-- AlterTable
-- 기존 재료 행을 cubes로 채우기 위한 DEFAULT다. 채운 뒤 바로 없앤다. 스키마에는 기본값이 없다.
ALTER TABLE "ingredient" ADD COLUMN "stock_tracking" "stock_tracking" NOT NULL DEFAULT 'cubes';
ALTER TABLE "ingredient" ALTER COLUMN "stock_tracking" DROP DEFAULT;
```

CHECK 제약은 필요 없다. enum이 값을 제한한다.

### 3. 클라이언트 재생성

`pnpm prisma:generate`를 돌린다. `src/generated/`는 gitignore 대상이라 커밋에 들지 않지만, 이 세션의 `pnpm typecheck`와 뒤 phase가 새 필드를 보려면 생성되어 있어야 한다.

## Acceptance Criteria

```bash
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
test -f prisma/migrations/20260929120000_stock_tracking/migration.sql
grep -q 'CREATE TYPE "stock_tracking"' prisma/migrations/20260929120000_stock_tracking/migration.sql
grep -q 'DROP DEFAULT' prisma/migrations/20260929120000_stock_tracking/migration.sql
grep -q '@@map("stock_tracking")' prisma/schema.prisma
grep -q 'stockTracking' prisma/schema.prisma
! grep -E 'stockTracking.*@default' prisma/schema.prisma
test "$(ls -d prisma/migrations/*/ | wc -l)" -eq 7
git diff --quiet "$HARNESS_BASELINE" -- src test docs README.md package.json
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `pnpm test:int`는 Docker가 필요하다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- `src/` 아래를 고치지 마라. 이유: 이 phase는 스키마만이고, 도메인 타입 변경은 phase 2가 파급 파일과 함께 한다. scope도 `prisma/`뿐이다.
- 스키마에 `@default(cubes)`를 두지 마라. 이유: 위 1번. `DROP DEFAULT`와 어긋난다.
- 마이그레이션을 둘 이상 만들지 마라. 이유: AC가 디렉터리 수 7을 검사한다.
- 기존 마이그레이션 파일을 고치지 마라. 이유: 운영 DB에 이미 적용됐다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
