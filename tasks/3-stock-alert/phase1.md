# Phase 1: schema

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md`
- `tasks/3-stock-alert/docs-diff.md` (phase 0이 고친 문서. ADR 0010 (d)가 이 phase의 근거다)
- `docs/adr/0002-orm-prisma.md`의 "대가" 절 (CHECK 제약은 마이그레이션 SQL에만 쓰고, Prisma가 표현할 수 있는 것은 스키마에도 선언한다)
- `docs/adr/0006-slack-delivery-and-deployment.md`의 "발송 기록과 클레임", "재시도 정책" (발송 이력 테이블의 컬럼과 CHECK가 왜 그 모양인지)
- `prisma/schema.prisma`의 `enum DeliveryStatus`, `enum SlackTemplateKey`, `model BriefDelivery`, `model ReactionPromptDelivery`, `model Household`의 관계 필드 (`///` 주석 문체, `@map` 관례)
- `prisma/migrations/20260922163337_slack_delivery/migration.sql` (`brief_delivery`의 테이블, FK, 손으로 덧붙인 CHECK 넷. 이 phase가 그대로 본뜬다)
- `prisma/migrations/20260926170000_slack_message/migration.sql` (`slack_template_key` enum이 만들어진 곳)
- `prisma/migrations/20260929120000_stock_tracking/migration.sql` (가장 최근 마이그레이션)
- `test/integration/setup/global-setup.ts` (`prisma migrate deploy`로 템플릿 DB를 만든다. `pnpm test:int`가 곧 마이그레이션 적용 검증이다)
- `test/integration/schema-constraints.int-spec.ts` (특히 "토큰의 구성원과 가정을 한 쌍으로 묶는 FK가 있다"가 카탈로그를 조회하는 방식)

## 작업 내용

재고 알람의 발송 이력 테이블과 템플릿 키를 더한다. `src/`는 건드리지 않는다. 포트와 저장소는 phase 2가 한다.

### 1. `prisma/schema.prisma`

`enum SlackTemplateKey`에 값 하나를 더한다.

```prisma
enum SlackTemplateKey {
  daily_brief
  reaction_prompt
  stock_alert

  @@map("slack_template_key")
}
```

`model ReactionPromptDelivery` 뒤에 모델 하나를 더한다. 컬럼 구성은 `BriefDelivery`와 같고 날짜 컬럼 이름만 `date`다.

```prisma
/// 재고 알람 메시지(ADR 0010). 가정마다 하루 한 건이고, 알람 항목이 없는 날은 skipped로 끝난다.
model StockAlertDelivery {
  householdId      String         @map("household_id") @db.Uuid
  date             DateTime       @db.Date
  status           DeliveryStatus
  /// 몇 번째 시도인가. 클레임하는 순간 1부터 센다.
  attempts         Int
  /// 이 시도를 잡은 시각. pending인 채로 리스가 지나면 다른 tick이 다시 잡는다.
  claimedAt        DateTime       @map("claimed_at") @db.Timestamptz(3)
  /// failed일 때 다음 시도가 가능해지는 시각. 마지막 시도에도 채워지고,
  /// 다시 잡히지 않게 막는 것은 이 값이 아니라 attempts 상한이다.
  nextAttemptAt    DateTime?      @map("next_attempt_at") @db.Timestamptz(3)
  sentAt           DateTime?      @map("sent_at") @db.Timestamptz(3)
  /// failed면 오류 메시지, skipped면 건너뛴 사유.
  outcomeReason    String?        @map("outcome_reason")
  /// 보낸 메시지를 가리키는 값. Slack에서는 메시지 ts다.
  messageReference String?        @map("message_reference")
  updatedAt        DateTime       @map("updated_at") @db.Timestamptz(3)

  household Household @relation(fields: [householdId], references: [id])

  @@id([householdId, date])
  @@map("stock_alert_delivery")
}
```

`model Household`에 역방향 관계 필드를 다른 발송 이력 관계 옆에 더한다(`stockAlertDeliveries StockAlertDelivery[]`). 이름은 기존 관계 필드의 관례를 따른다.

### 2. `prisma/migrations/20261005120000_stock_alert/migration.sql`

손으로 쓴다. `pnpm db:migrate --create-only`는 살아 있는 DB가 필요하고 이 환경에는 없다. 내용은 아래 순서다.

```sql
-- AlterEnum
ALTER TYPE "slack_template_key" ADD VALUE 'stock_alert';

-- CreateTable
CREATE TABLE "stock_alert_delivery" (
    "household_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "delivery_status" NOT NULL,
    "attempts" INTEGER NOT NULL,
    "claimed_at" TIMESTAMPTZ(3) NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "outcome_reason" TEXT,
    "message_reference" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_alert_delivery_pkey" PRIMARY KEY ("household_id","date")
);

-- AddForeignKey
ALTER TABLE "stock_alert_delivery" ADD CONSTRAINT "stock_alert_delivery_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

그 뒤에 `20260922163337_slack_delivery`와 같은 구분선 주석을 두고 CHECK 넷을 손으로 덧붙인다. 식은 `brief_delivery`의 것과 글자까지 같고 이름만 다르다.

| 제약 이름 | 식 |
|---|---|
| `stock_alert_delivery_attempts_check` | `"attempts" >= 1` |
| `stock_alert_delivery_sent_check` | `("status" = 'sent') = ("sent_at" IS NOT NULL) AND ("status" = 'sent') = ("message_reference" IS NOT NULL)` |
| `stock_alert_delivery_failed_check` | `"status" <> 'failed' OR ("next_attempt_at" IS NOT NULL AND "outcome_reason" IS NOT NULL)` |
| `stock_alert_delivery_skipped_check` | `"status" <> 'skipped' OR "outcome_reason" IS NOT NULL` |

각 제약 위에 한 줄 한국어 주석을 단다(기존 마이그레이션의 문체).

`ALTER TYPE … ADD VALUE`는 새 값을 같은 트랜잭션 안에서 쓰지 않으면 문제가 없다. 이 마이그레이션은 그 값을 쓰지 않는다. `pnpm test:int`가 이 문장 때문에 마이그레이션 적용에 실패하면 마이그레이션을 임의로 나누거나 AC를 고치지 말고, status를 `error`로 보고하고 실제 오류 출력을 `error_message`에 적어라.

### 3. `test/integration/schema-constraints.int-spec.ts`

테스트 하나를 더한다. 이름은 "재고 알람 발송 이력에 네 제약과 가정 FK가 걸려 있다". 같은 파일의 FK 존재 테스트가 쓰는 방식(카탈로그 조회)으로 `stock_alert_delivery`에 `stock_alert_delivery_attempts_check`, `stock_alert_delivery_sent_check`, `stock_alert_delivery_failed_check`, `stock_alert_delivery_skipped_check`, `stock_alert_delivery_household_id_fkey` 다섯 제약이 있는지 확인한다. 제약의 동작(거부되는 행)은 phase 2가 `brief-delivery.int-spec.ts`에서 본다.

### 4. 클라이언트 재생성

`pnpm prisma:generate`를 돌린다. `src/generated/`는 gitignore 대상이라 커밋에 들지 않지만, 이 세션의 `pnpm typecheck`와 뒤 phase가 새 모델을 보려면 생성되어 있어야 한다.

## Acceptance Criteria

```bash
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
test -f prisma/migrations/20261005120000_stock_alert/migration.sql
grep -q 'CREATE TABLE "stock_alert_delivery"' prisma/migrations/20261005120000_stock_alert/migration.sql
grep -q "ADD VALUE 'stock_alert'" prisma/migrations/20261005120000_stock_alert/migration.sql
grep -q 'stock_alert_delivery_household_id_fkey' prisma/migrations/20261005120000_stock_alert/migration.sql
grep -q 'stock_alert_delivery_attempts_check' prisma/migrations/20261005120000_stock_alert/migration.sql
grep -q 'stock_alert_delivery_sent_check' prisma/migrations/20261005120000_stock_alert/migration.sql
grep -q 'stock_alert_delivery_failed_check' prisma/migrations/20261005120000_stock_alert/migration.sql
grep -q 'stock_alert_delivery_skipped_check' prisma/migrations/20261005120000_stock_alert/migration.sql
grep -q '@@map("stock_alert_delivery")' prisma/schema.prisma
grep -q 'stock_alert$' prisma/schema.prisma
test "$(ls -d prisma/migrations/*/ | wc -l)" -eq 8
grep -q '재고 알람 발송 이력에 네 제약과 가정 FK가 걸려 있다' test/integration/schema-constraints.int-spec.ts
git diff --quiet "$HARNESS_BASELINE" -- src package.json
git diff --quiet HEAD -- docs README.md
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `pnpm test:int`는 Docker가 필요하다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- `src/`를 고치지 마라. 이유: 포트와 저장소는 phase 2, 템플릿 키 타입은 phase 4가 한다. scope 밖이라 러너가 phase를 실패로 처리한다.
- `brief_delivery`나 `reaction_prompt_delivery`를 고치지 마라. 이유: 운영 데이터가 있는 테이블이고 ADR 0010 (d)가 종류 컬럼을 더하는 안을 기각했다.
- CHECK를 하나라도 빼지 마라. 이유: tech-critic-lead의 승인 조건이다. 컬럼 구성이 같으므로 규칙도 같다.
- 컬럼에 `@default`를 두지 마라. 이유: 기존 발송 이력 모델에 기본값이 없고, 값은 전부 클레임 질의가 넣는다.
- nullable이 아닌 컬럼을 nullable로 바꾸거나 호환용 컬럼을 더하지 마라. 이유: AGENTS.md 금지 2번.
- 기존 마이그레이션 파일을 고치지 마라. 이유: 운영 DB에 이미 적용됐다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
