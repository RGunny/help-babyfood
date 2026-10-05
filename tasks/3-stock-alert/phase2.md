# Phase 2: delivery-log

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md` (`src/application`은 NestJS를 모른다. 시각은 `ClockPort`로만 들어온다)
- `tasks/3-stock-alert/docs-diff.md` (ADR 0010 (d)가 이 phase의 근거다)
- `docs/adr/0006-slack-delivery-and-deployment.md`의 "발송 기록과 클레임", "재시도 정책", "브리프 시각 판정은 SQL 선별로 한다" (클레임이 왜 `INSERT … ON CONFLICT DO NOTHING RETURNING`인지, 왜 `LEFT JOIN alert_settings`와 `COALESCE`인지)
- `src/application/ports/brief-delivery-log.port.ts` (`DailyBriefClaim`, `ReactionPromptClaim`, `DeliveryClaim`, `BriefDeliveryLogPort`)
- `src/infrastructure/prisma/brief-delivery-log.repository.ts` (`claimDueDailyBriefs`의 두 문장, `recordSent`·`recordSkipped`·`recordFailed`의 `if (claim.kind === 'brief') … return;` 뒤에 후속 메시지 갈래가 오는 구조)
- `src/application/brief-dispatch.service.spec.ts`의 `RecordingLog` (포트의 가짜 구현)
- `test/integration/brief-delivery.int-spec.ts` 전체 (`due()`, `household()`, `setBriefTime()` 헬퍼와 `describe('브리프 클레임')`, 제약 테스트 묶음)
- `prisma/schema.prisma`의 `model StockAlertDelivery` (phase 1이 더했다)

시작하기 전에 `pnpm prisma:generate`를 돌려라. `src/generated/`는 커밋되지 않으므로 phase 1의 모델이 이 세션의 클라이언트에 없을 수 있다.

## 작업 내용

발송 이력 포트에 재고 알람의 클레임을 더하고, 그 유일한 구현인 저장소가 따라간다. 포트 파일(애플리케이션)과 저장소(영속화)를 한 phase에서 고치는 이유: `DeliveryClaim` 유니온이 넓어지는 순간 저장소의 `record*`가 `claim.slot`에서 `pnpm typecheck`에 걸려, 둘을 나누면 어느 쪽 phase도 통과할 수 없다.

### 1. `src/application/ports/brief-delivery-log.port.ts`

```ts
export interface StockAlertClaim {
  readonly kind: 'stock_alert';
  readonly householdId: string;
  readonly date: LocalDate;
  readonly attempts: number;
}

export type DeliveryClaim = DailyBriefClaim | ReactionPromptClaim | StockAlertClaim;
```

`BriefDeliveryLogPort`에 `claimDueStockAlerts(due: DeliveryDue): Promise<StockAlertClaim[]>`를 `claimDueReactionPrompts` 뒤에 더한다. `DeliveryClaim`의 주석(kind가 판별자인 이유)은 그대로 맞으므로 고치지 않는다. `releaseClaim`은 `ReactionPromptClaim`만 받는 그대로 둔다. 재고 알람은 클레임을 되돌리는 갈래가 없다.

### 2. `src/infrastructure/prisma/brief-delivery-log.repository.ts`

`claimDueStockAlerts`를 더한다. `claimDueDailyBriefs`와 같은 두 문장이고 테이블과 날짜 컬럼 이름만 다르다(`stock_alert_delivery`, `date`).

- 첫 문장: `INSERT INTO stock_alert_delivery (household_id, date, status, attempts, claimed_at, updated_at) SELECT h.id, … FROM household h LEFT JOIN alert_settings a ON a.household_id = h.id WHERE COALESCE(a.brief_time, ${DEFAULT_BRIEF_TIME}) <= ${due.time} ON CONFLICT (household_id, date) DO NOTHING RETURNING household_id, attempts`.
- 둘째 문장: 리스가 지난 `pending`과 다음 시도 시각이 지난 `failed`를 `attempts < ${due.maxAttempts}` 조건으로 다시 잡는다.
- 돌려주는 값은 `{ kind: 'stock_alert', householdId, date: due.date, attempts }`.

재고 알람의 시각은 브리프 시각이다(ADR 0010: 알람 설정 항목을 늘리지 않는다). 그래서 조건이 브리프 클레임과 같다. 메서드 위 주석에 그 한 문장을 영어로 적어라(이 파일의 주석은 영어다).

`recordSent`, `recordSkipped`, `recordFailed`에 `stock_alert` 갈래를 더한다. 지금은 `if (claim.kind === 'brief') { … return; }` 뒤가 암묵적으로 후속 메시지다. 세 갈래가 되므로 `kind`마다 명시적으로 나눠라(`switch` 또는 `if` 둘과 마지막 갈래). 유니온에 종류가 더 늘면 `pnpm typecheck`가 잡도록, 마지막 갈래가 "나머지 전부"가 되지 않게 한다. `releaseClaim`은 고치지 않는다.

세 메서드에 같은 갈래가 세 번 반복되어도 테이블 이름을 문자열로 조립하는 헬퍼를 만들지 마라. `$queryRaw` 태그드 템플릿은 식별자를 매개변수로 받지 못하고, `Prisma.raw`로 테이블 이름을 끼우면 이 파일에서 처음으로 문자열 SQL이 생긴다.

### 3. `src/application/brief-dispatch.service.spec.ts`

`RecordingLog`에 메서드 하나만 더한다. 인터페이스를 만족시키기 위한 것이고 이 phase에서는 빈 배열을 돌려준다.

```ts
async claimDueStockAlerts(due: DeliveryDue): Promise<StockAlertClaim[]> {
  this.due.push(due);
  return [];
}
```

`this.due.push(due)`를 넣으면 기존 테스트 "클레임에 넘기는 날짜와 시각은 시계가 준 것이다"가 `due`의 길이나 내용을 단언하는 방식에 따라 깨질 수 있다. 서비스는 아직 이 메서드를 부르지 않으므로 깨지지 않아야 한다. 깨지면 `push`를 빼고 `return [];`만 둬라. 생성자 인자와 다른 메서드는 건드리지 않는다(phase 5가 한다).

### 4. `test/integration/brief-delivery.int-spec.ts`

`describe('재고 알람 클레임')`을 더한다. 테스트 이름은 아래 그대로 쓴다(phase 7이 이름으로 지목한다).

- 브리프 시각 전에는 재고 알람을 클레임하지 않는다
- 알람 설정을 한 번도 저장하지 않은 가정도 기본 시각 07:30에 재고 알람이 클레임된다
- 재고 알람은 하루 한 건이다 (같은 날 두 번 클레임하면 두 번째는 빈 배열)
- 같은 가정과 날짜의 재고 알람을 동시에 두 번 클레임하면 한쪽만 행을 얻는다
- 브리프를 클레임해도 재고 알람 클레임은 따로 얻는다 (두 테이블이 서로의 클레임을 막지 않는다)
- 보냈다고 기록한 재고 알람은 다시 클레임되지 않는다
- 건너뛰었다고 기록한 재고 알람도 다시 클레임되지 않는다
- 실패한 재고 알람은 다음 시도 시각이 지나면 잡히고 시도 횟수가 1 늘어난다
- 시도 횟수가 상한인 재고 알람은 다음 시도 시각이 지나도 잡히지 않는다
- 발송 중에 죽어 pending으로 남은 재고 알람은 리스가 지나면 다시 잡힌다

제약 테스트 묶음(기존 "후속 메시지 이력에도 같은 제약이 걸려 있다" 옆)에 "재고 알람 이력에도 같은 제약이 걸려 있다"를 더한다. 보냈다면서 보낸 시각이 없는 행, 실패했다면서 다음 시도 시각이 없는 행, 건너뛰었다면서 사유가 없는 행, 시도 횟수가 0인 행이 거부되는지 본다. 기존 테스트가 행을 직접 넣는 방식을 따른다.

## Acceptance Criteria

```bash
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
grep -q "kind: 'stock_alert'" src/application/ports/brief-delivery-log.port.ts
grep -q 'claimDueStockAlerts' src/application/ports/brief-delivery-log.port.ts
grep -q 'claimDueStockAlerts' src/infrastructure/prisma/brief-delivery-log.repository.ts
grep -q 'ON CONFLICT (household_id, date) DO NOTHING' src/infrastructure/prisma/brief-delivery-log.repository.ts
grep -q '재고 알람은 하루 한 건이다' test/integration/brief-delivery.int-spec.ts
grep -q '브리프 시각 전에는 재고 알람을 클레임하지 않는다' test/integration/brief-delivery.int-spec.ts
grep -q '재고 알람 이력에도 같은 제약이 걸려 있다' test/integration/brief-delivery.int-spec.ts
! grep -n 'Prisma.raw\|\$queryRawUnsafe\|\$executeRawUnsafe' src/infrastructure/prisma/brief-delivery-log.repository.ts
! grep -rn 'new Date()\|Date.now()' src/infrastructure/prisma/brief-delivery-log.repository.ts
git diff --quiet "$HARNESS_BASELINE" -- src/application/brief-dispatch.service.ts src/application/daily-brief.ts src/application/ports/brief-delivery.port.ts src/slack src/mcp src/scheduler src/domain
git diff --quiet HEAD -- prisma docs README.md
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `pnpm test:int`는 Docker가 필요하다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- `src/application/brief-dispatch.service.spec.ts`에서 `RecordingLog`에 `claimDueStockAlerts` 메서드를 더하는 것 말고는 아무것도 고치지 마라. 테스트를 더하거나 지우지 마라. 이유: 발송 서비스의 규칙은 phase 5가 고친다. tech-critic-lead의 승인 조건이다.
- `BriefDispatchService`(`src/application/brief-dispatch.service.ts`)를 고치지 마라. 이유: phase 5의 일이고 AC가 이 파일이 바뀌지 않았는지 본다.
- `BriefDeliveryPort`(`src/application/ports/brief-delivery.port.ts`)를 고치지 마라. 이유: 메시지 타입은 phase 3, 인터페이스 메서드는 phase 5가 더한다.
- 재시도 간격, 리스, 시도 상한을 SQL에 다시 적지 마라. 이유: `brief-dispatch.policy.ts`가 원본이고 저장소는 `due`로 받은 값만 쓴다(ADR 0006).
- 기본 브리프 시각 `'07:30'`을 SQL에 문자열로 적지 마라. 이유: 매퍼의 `DEFAULT_BRIEF_TIME`을 import해 한 곳에만 둔다(ADR 0006).
- SQL의 `now()`나 `CURRENT_DATE`를 쓰지 마라. 이유: 시각은 `ClockPort`가 준 `due`로만 들어온다.
- 재고 알람용 `releaseClaim`을 만들지 마라. 이유: 되돌릴 갈래가 없다. 항목이 없는 날은 `skipped` 종결이다.
- `src/domain`을 고치지 마라. 이유: 동결 경로이고 이 task에는 `unfreeze`가 없다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
