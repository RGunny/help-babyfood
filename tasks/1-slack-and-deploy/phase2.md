# Phase 2: persistence

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain
```

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고 `tasks/1-slack-and-deploy/index.json`의 phase 2 status를 `"error"`로, `error_message`에 `dirty working tree`로 적고 멈춰라.

먼저 아래를 읽어라.

- `tasks/1-slack-and-deploy/docs-diff.md`
- `docs/adr/0006-slack-delivery-and-deployment.md` (특히 클레임, 재시도, 브리프 시각 판정의 `COALESCE` 함정)
- `docs/adr/0002-orm-prisma.md`의 "대가" 절. **CHECK 제약과 부분 인덱스를 마이그레이션 SQL에 손으로 덧붙이는 절차가 거기 있다**
- `src/application/ports/brief-delivery-log.port.ts` (phase 1이 만든 포트. **이 phase는 그 인터페이스를 구현하는 것이 전부다**)
- `src/application/brief-dispatch.policy.ts` (상수가 어디에 있는지. 저장소는 계산하지 않는다)
- `prisma/schema.prisma` 전체. 특히 `Household`, `Member`, `AlertSettings`, `SlotSchedule`, `MealSlot` enum
- `prisma/migrations/20260922023722_member_token/migration.sql` (**손으로 덧붙인 제약의 본보기다.** 구분선 주석과 설명 방식을 그대로 따른다)
- `prisma/migrations/20260921134349_init/migration.sql`의 끝부분. `brief_time`과 `meal_time`에 걸린 `^([01][0-9]|2[0-3]):[0-5][0-9]$` CHECK를 직접 확인하라
- `src/infrastructure/prisma/household-directory.repository.ts` (**저장소 본보기.** 생성자에 `PrismaTransaction`을 받는 평범한 클래스)
- `src/infrastructure/prisma/prisma.service.ts`, `persistence.module.ts`
- `src/infrastructure/prisma/mappers/state.mapper.ts`의 `DEFAULT_BRIEF_TIME`과 `toAlertSettings`
- `src/scripts/mint-member-token.ts` (**CLI 본보기.** `parseArgs`, `readEnv`, 출력 방식)
- `test/integration/setup/fixtures.ts`와 `test/integration/reconcile.int-spec.ts` (통합 테스트 본보기)

## 작업 내용

### 1. `prisma/schema.prisma`

세 가지를 더한다.

`Household`에 필드 하나.

```prisma
  /// 브리프를 보낼 Slack 채널. 연결하지 않은 가정은 발송이 skipped로 지나간다.
  slackChannelId String? @map("slack_channel_id")
```

관계 필드 `briefDeliveries`, `reactionPromptDeliveries`도 함께 더한다.

enum 하나.

```prisma
/// 발송 한 건의 결말. skipped는 보낼 곳이 없었다는 뜻이고 실패가 아니다.
enum DeliveryStatus {
  pending
  sent
  failed
  skipped

  @@map("delivery_status")
}
```

모델 둘. 컬럼 구성은 같고 기본키만 다르다.

```prisma
/// 브리프 발송 이력(기획안 6장). 기본키가 "하루 한 건"을 강제하고, 그래서 클레임이
/// INSERT ... ON CONFLICT DO NOTHING만으로 원자적이다.
model BriefDelivery {
  householdId      String         @map("household_id") @db.Uuid
  briefDate        DateTime       @map("brief_date") @db.Date
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

  @@id([householdId, briefDate])
  @@map("brief_delivery")
}

/// 4.6절의 반응 기록 후속 메시지. 끼니마다 하루 한 건이다.
model ReactionPromptDelivery {
  householdId      String         @map("household_id") @db.Uuid
  date             DateTime       @db.Date
  slot             MealSlot
  // 나머지 컬럼은 BriefDelivery와 같다.
  ...
  @@id([householdId, date, slot])
  @@map("reaction_prompt_delivery")
}
```

`outcomeReason`이라는 이름을 쓰는 이유는 이 컬럼이 실패 메시지와 건너뛴 사유 둘 다를 담기 때문이다. `last_error`로 두면 `skipped` 행의 사유가 오류처럼 보인다.

### 2. 마이그레이션

`docs/adr/0002-orm-prisma.md`의 절차를 그대로 따른다.

```bash
docker compose up -d
pnpm db:migrate --create-only --name slack_delivery
# 생성된 SQL 끝에 구분선 주석과 함께 CHECK를 손으로 덧붙인다
pnpm db:migrate
pnpm prisma:generate
```

두 테이블에 각각 덧붙일 CHECK다. 각각에 왜 거는지 한 줄 주석을 단다.

```sql
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
```

`reaction_prompt_delivery`에도 같은 넷을 이름만 바꿔 건다.

별도 인덱스는 만들지 마라. 클레임 질의는 `household`와 `slot_schedule`에서 출발해 기본키로 조인하므로 기본키 인덱스가 그 경로를 덮는다.

마이그레이션이 끝나면 `pnpm db:migrate`를 한 번 더 돌려 "Already in sync"가 나오는지 확인하라. 덧붙인 SQL이 shadow DB에 재생되지 않으면 drift로 잡힌다.

### 3. `src/infrastructure/prisma/brief-delivery-log.repository.ts`

`BriefDeliveryLogPort`를 구현한다. 생성자에 `PrismaTransaction`을 받는다.

**상수를 계산하지 마라.** `maxAttempts`와 `leaseSeconds`는 `DeliveryDue`로 들어온다. 리스 기준 시각은 `due.instant`에서 `due.leaseSeconds`를 뺀 값이다.

`DEFAULT_BRIEF_TIME`은 `./mappers/state.mapper.js`에서 import한다. 새로 선언하지 마라.

브리프 클레임은 질의 둘이다. 새 행을 잡는 것과 이미 있는 행을 다시 잡는 것이고, 결과를 합쳐 돌려준다.

```sql
-- 새로 잡는다. alert_settings 행이 없는 가정은 DEFAULT_BRIEF_TIME으로 판정된다.
-- INNER JOIN이면 update_alert_settings를 한 번도 부르지 않은 가정이 통째로 빠진다.
INSERT INTO brief_delivery (household_id, brief_date, status, attempts, claimed_at, updated_at)
SELECT h.id, $date::date, 'pending'::delivery_status, 1, $instant, $instant
FROM household h
LEFT JOIN alert_settings a ON a.household_id = h.id
WHERE COALESCE(a.brief_time, $defaultBriefTime) <= $time
ON CONFLICT (household_id, brief_date) DO NOTHING
RETURNING household_id, attempts
```

```sql
-- 다시 잡는다. 발송 중에 죽어 pending으로 남은 행(리스 만료)과 재시도 시각이 된 failed 행이다.
UPDATE brief_delivery
SET status = 'pending'::delivery_status, attempts = attempts + 1, claimed_at = $instant, updated_at = $instant
WHERE brief_date = $date::date
  AND attempts < $maxAttempts
  AND ( (status = 'pending'::delivery_status AND claimed_at <= $leaseCutoff)
     OR (status = 'failed'::delivery_status AND next_attempt_at <= $instant) )
RETURNING household_id, attempts
```

후속 메시지 클레임도 같은 모양이고, 출발 테이블만 다르다. `slot_schedule`에는 기본값이 없으므로 INNER JOIN 그대로다.

```sql
INSERT INTO reaction_prompt_delivery (household_id, date, slot, status, attempts, claimed_at, updated_at)
SELECT s.household_id, $date::date, s.slot, 'pending'::delivery_status, 1, $instant, $instant
FROM slot_schedule s
WHERE s.meal_time <= $time
ON CONFLICT (household_id, date, slot) DO NOTHING
RETURNING household_id, slot, attempts
```

`recordSent`, `recordSkipped`, `recordFailed`는 UPDATE 하나씩이다. `claim.kind`로 테이블을 고른다. `recordSent`는 `status='sent'`, `sent_at`, `message_reference`를 함께 채운다. `recordFailed`는 `status='failed'`, `next_attempt_at`, `outcome_reason`을 채운다. `recordSkipped`는 `status='skipped'`와 `outcome_reason`이다. 전부 `updated_at`을 갱신한다.

`releaseClaim`은 `reaction_prompt_delivery`에서 그 행을 DELETE한다. 자기가 방금 만든 pending 행을 지우는 것이므로 `status = 'pending'`을 조건에 넣어라.

Prisma의 `$queryRaw` 태그드 템플릿을 쓰고 값은 전부 파라미터로 넘긴다. `$queryRawUnsafe`에 문자열을 이어 붙이지 마라.

### 4. `src/infrastructure/prisma/persistence.module.ts`

`BRIEF_DELIVERY_LOG` 토큰을 새 저장소에 바인딩하고 `exports`에 넣는다. **`BRIEF_DELIVERY`(발송 포트)는 건드리지 마라.** 그 구현은 phase 3에 생긴다.

### 5. `src/scripts/link-slack.ts`

가정에 Slack 채널을, 구성원에 Slack 사용자 id를 연결하는 CLI다. `mint-member-token.ts`와 같은 모양으로 쓴다.

```
--household <이름>     대상 가정.
--channel <채널 id>    브리프를 보낼 채널. 예: C0123ABCD
--member <이름>        구성원 이름. --slack-user와 함께 쓴다.
--slack-user <U...>    그 구성원의 Slack 사용자 id. 버튼을 누른 사람을 찾는 데 쓴다.
--list                 연결 상태를 보인다.
```

없는 가정이나 구성원을 만들지 마라. `mint-member-token`이 만든 것에 연결하는 도구다. 없으면 오류를 내고 종료한다. MCP 도구로 두지 않는 이유는 `mint-member-token`과 같다. 토큰으로 인증한 세션이 발송 대상 채널을 바꿀 수 있으면 유출 하나가 브리프를 다른 곳으로 보내는 수단이 된다.

`package.json`의 `scripts`에 `"slack-link": "nest build && node dist/scripts/link-slack.js"`를 더한다. `member-token`과 같은 모양이다.

### 6. 통합 테스트

`test/integration/setup/fixtures.ts`의 `TestServices`와 `buildServices`에 `dailyBrief: DailyBriefService`를 더한다. phase 3 이후의 테스트도 그것을 쓴다. 기존 필드와 순서를 흐트러뜨리지 마라.

`test/integration/brief-delivery.int-spec.ts`를 만든다. 테스트 이름은 규칙을 한국어로 서술한다.

- `alert_settings` 행이 없는 가정도 기본 시각 07:30에 클레임된다. **이 테스트가 이 phase에서 가장 중요하다.** `pnpm member-token`이 만든 새 가정이 정확히 그 상태다.
- `alert_settings`가 있으면 그 시각을 쓴다. 그 시각 전에는 클레임되지 않고 같거나 지나면 클레임된다.
- 같은 가정과 날짜를 동시에 두 번 클레임하면 하나만 행을 얻는다(`Promise.all`로 동시에 부른다).
- `sent`로 기록한 뒤에는 다시 클레임되지 않는다.
- `skipped`로 기록한 뒤에도 다시 클레임되지 않는다. 종결 상태다.
- `failed`는 `next_attempt_at` 전에는 잡히지 않고, 지나면 잡히며 `attempts`가 1 늘어난다.
- `attempts`가 상한(`maxAttempts`)이면 시각이 지나도 잡히지 않는다.
- `pending`인 행은 리스 안에서는 잡히지 않고 리스가 지나면 잡힌다.
- `releaseClaim` 뒤에는 같은 끼니가 다시 클레임된다.
- 후속 메시지 클레임은 `meal_time`이 지난 끼니만 고른다.
- `status='sent'`인데 `sent_at`이 NULL인 행은 CHECK가 거부한다(raw SQL로 직접 시도한다).
- `status='failed'`인데 `next_attempt_at`이 NULL인 행도 거부한다.

`test/integration/brief-dispatch.int-spec.ts`를 만든다. 진짜 저장소와 진짜 `DailyBriefService`에 **가짜 `BriefDeliveryPort`**를 끼운다. Slack은 아직 없다.

- 브리프 시각 전에는 아무것도 보내지 않는다.
- 시각이 지나면 한 번 보내고 기록이 `sent`가 된다.
- 같은 날 다시 돌려도 두 번 보내지 않는다.
- 발송 포트가 던지면 `failed`로 남고, 간격이 지난 뒤 다시 돌리면 재시도한다.
- 발송 포트가 `skipped`를 돌려주면 그날은 끝난다.
- 후속 메시지 세 갈래가 각각 동작한다. 정합화 전에 돌리면 보내지 않고 행이 사라지며, 정합화 뒤에 돌리면 보낸다. 미급여를 등록한 날에는 `no_meal`로 종결되고 두 번째 tick은 클레임조차 하지 않는다.

## Acceptance Criteria

아래를 순서대로 실행해 모두 exit 0이어야 한다.

```bash
# 1) 파일이 생겼다
test -f src/infrastructure/prisma/brief-delivery-log.repository.ts
test -f src/scripts/link-slack.ts
test -f test/integration/brief-delivery.int-spec.ts
test -f test/integration/brief-dispatch.int-spec.ts
ls prisma/migrations | grep -q slack_delivery

# 2) 기본 브리프 시각 함정을 피했다
grep -q 'COALESCE' src/infrastructure/prisma/brief-delivery-log.repository.ts
grep -q 'DEFAULT_BRIEF_TIME' src/infrastructure/prisma/brief-delivery-log.repository.ts
! grep -q "'07:30'" src/infrastructure/prisma/brief-delivery-log.repository.ts

# 3) 클레임이 원자적이다
grep -q 'ON CONFLICT' src/infrastructure/prisma/brief-delivery-log.repository.ts

# 4) 정책 상수가 저장소로 새지 않았다
! grep -qE 'RETRY_DELAY_MINUTES|MAX_DELIVERY_ATTEMPTS|CLAIM_LEASE_SECONDS' src/infrastructure/prisma/brief-delivery-log.repository.ts

# 5) 문자열을 이어 붙인 SQL이 없다
! grep -q 'queryRawUnsafe' src/infrastructure/prisma/brief-delivery-log.repository.ts

# 6) CHECK를 손으로 덧붙였다
grep -q 'CHECK' prisma/migrations/*slack_delivery*/migration.sql

# 7) 발송 포트는 아직 바인딩되지 않았다
grep -q 'BRIEF_DELIVERY_LOG' src/infrastructure/prisma/persistence.module.ts
! grep -qE 'BRIEF_DELIVERY[^_]' src/infrastructure/prisma/persistence.module.ts

# 8) 애플리케이션과 어댑터는 건드리지 않았다
git diff --quiet HEAD -- src/application/ src/mcp/ src/scheduler/

# 9) 도메인 불변
git diff --quiet HEAD -- src/domain/

# 10) 마이그레이션에 drift가 없다
pnpm db:migrate

# 11) 타입, 린트, 테스트
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
pnpm test:cov
```

10번은 로컬 PostgreSQL이 필요하다. 없으면 `docker compose up -d`로 띄운 뒤 실행하라. "Already in sync"가 나와야 한다.

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 통과하면 `tasks/1-slack-and-deploy/index.json`의 phase 2 status를 `"completed"`로 바꿔라.

세 번 고쳐도 통과하지 못하면 status를 `"error"`로 바꾸고, `"error_message"`에 어떤 명령이 어떤 출력으로 실패했는지 실제 출력을 근거로 적어라.

AC 통과와 index.json 갱신을 마쳤으면 커밋하라. 메시지는 `feat(slack-and-deploy): phase 2 persistence`로 한다.

## 하지 말아야 할 것

- **`alert_settings`를 INNER JOIN하지 마라.** 행이 없는 가정이 발송에서 영원히 빠진다. `src/infrastructure/prisma/mappers/state.mapper.ts`의 `toAlertSettings`가 그 경우 `DEFAULT_BRIEF_TIME`으로 떨어진다는 것을 직접 확인하라.
- **`DEFAULT_BRIEF_TIME` 값을 저장소에 다시 적지 마라.** import한다.
- **재시도 간격이나 상한을 저장소에서 계산하지 마라.** `DeliveryDue`로 받는다.
- **`src/application`을 고치지 마라.** phase 1이 정한 포트를 그대로 구현한다. 인터페이스가 불편하면 고치지 말고 `error_message`에 적어라.
- **`src/slack`을 만들지 마라.** phase 3이다.
- **`SLACK_BOT_TOKEN`이나 `.env.example`을 건드리지 마라.** phase 3이다.
- **`src/domain`을 고치지 마라.**
- **기존 마이그레이션 파일을 고치지 마라.** 새 파일만 더한다.
- **`vitest.config.ts`의 임계값을 낮추지 마라.**
- **`@slack/types`를 포함해 의존성을 설치하지 마라.**
- **`tasks/` 안의 다른 파일을 고치지 마라.** `tasks/1-slack-and-deploy/index.json`의 phase 2 status만 갱신한다.
