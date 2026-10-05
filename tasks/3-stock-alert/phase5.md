# Phase 5: dispatch

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md` (`src/application`은 NestJS를 모른다. 서비스에 데코레이터를 달지 않는다. 시각은 `ClockPort`로만 들어온다)
- `tasks/3-stock-alert/docs-diff.md`
- `docs/adr/0010-stock-alert-message.md`의 (a), (c), (d) (별도 메시지, 저장 없이 매일, 쓸기 순서와 `no_alert`)
- `docs/adr/0006-slack-delivery-and-deployment.md`의 "재시도 정책", "후속 메시지의 세 갈래" (`skipped`가 종결인 이유)
- `src/application/brief-dispatch.service.ts` 전체 (`runEveryHousehold`, `dispatchDailyBrief`, `record`, `fail`, `DispatchTarget`, `DispatchOutcome`)
- `src/application/ports/brief-delivery.port.ts` (`StockAlertMessage`는 phase 3이 더했다. 인터페이스 메서드는 아직 없다)
- `src/application/ports/brief-delivery-log.port.ts` (`StockAlertClaim`, `claimDueStockAlerts`는 phase 2가 더했다)
- `src/application/daily-brief.ts`의 `DailyBrief.stockAlert`
- `src/slack/outbound/slack-brief-delivery.ts`의 `deliverStockAlert` (phase 4가 더했다. 읽기만 한다)
- `src/application/brief-dispatch.service.spec.ts` 전체 (`RecordingLog`, `RecordingDelivery`, `briefOf`, `briefClaim`, `promptClaim`, 기존 테스트가 `outcomes`와 `log.due`를 단언하는 방식)
- `test/integration/brief-dispatch.int-spec.ts` 전체 (`FakeBriefDelivery`, 가정을 심는 헬퍼, 쓸기 결과 전체를 `toEqual`로 비교하는 단언들)
- `src/scheduler/brief-dispatch.job.ts` (결과를 `target`으로 로그에 적는다. 읽기만 한다)

시작하기 전에 `pnpm prisma:generate`를 돌려라.

## 작업 내용

발송 포트에 재고 알람을 올리고, 매분 쓸기가 브리프와 후속 메시지 다음에 재고 알람을 보내게 한다.

### 1. `src/application/ports/brief-delivery.port.ts`

`BriefDeliveryPort`에 메서드 하나를 더한다.

```ts
deliverStockAlert(householdId: string, message: StockAlertMessage): Promise<DeliveryResult>;
```

`SlackBriefDelivery`는 phase 4에서 이미 이 메서드를 가졌으므로 `pnpm typecheck`를 통과한다. 가짜 구현 둘(`src/application/brief-dispatch.service.spec.ts`의 `RecordingDelivery`, `test/integration/brief-dispatch.int-spec.ts`의 `FakeBriefDelivery`)에 메서드를 더한다. 받은 메시지를 배열에 모으는 기존 방식을 따른다(`alerts`).

### 2. `src/application/brief-dispatch.service.ts`

- `DispatchTarget`에 `'stock_alert'`를 더한다.
- 상수: `const NO_ALERT = 'no_alert';`와 한 줄 한국어 주석(이 파일의 `NO_MEAL` 옆 주석 문체. "알람 항목이 없다. 재고가 식단을 덮고 임계개수 이하인 재료도 없는 날이다").
- `runEveryHousehold`의 루프 순서는 **브리프, 후속 메시지, 재고 알람**이다. 알람 루프를 맨 끝에 둔다.

```ts
for (const claim of await this.log.claimDueStockAlerts(due)) {
  outcomes.push(await this.dispatchStockAlert(claim, instant));
}
```

- `dispatchStockAlert(claim, instant)`:
  1. `const brief = await this.brief.get(claim.householdId);`
  2. `brief.stockAlert.items.length === 0`이면 `recordSkipped(claim, NO_ALERT, instant)` 뒤 `{ kind: 'skipped', target: 'stock_alert', householdId, reason: NO_ALERT }`. 종결이다. 낮에 재고가 줄어도 그날은 다시 보내지 않고 다음 날 아침에 간다.
  3. 아니면 `this.delivery.deliverStockAlert(householdId, { date: claim.date, alert: brief.stockAlert })`의 결과를 기존 `record('stock_alert', …)`로 기록한다.
  4. 전체를 `try`로 감싸고 `catch`에서 기존 `fail('stock_alert', …)`을 부른다(브리프를 만들지 못한 것도 발송 실패와 같은 자리에 기록한다. `dispatchDailyBrief`와 같다).
- 클래스 머리 주석의 "Sends what is due this minute: today's brief, and the follow-up asking about a meal just fed."에 재고 알람을 더한다. `runEveryHousehold` 주석이나 그 옆에 알람이 마지막인 이유를 한두 문장 영어로 적는다: 클레임은 try 밖이라 던지면 뒤의 루프가 돌지 않고, 알람 테이블의 마이그레이션이 적용되기 전에 뜬 서버에서는 알람 클레임이 던진다. 마지막이면 막히는 것이 알람뿐이다(ADR 0010).

`record`와 `fail`은 `DeliveryClaim`을 받으므로 고칠 것이 없다. `application.module.ts`도 포트가 같아 고칠 것이 없다. `pnpm typecheck`가 지목하지 않으면 건드리지 않는다.

### 3. `src/application/brief-dispatch.service.spec.ts`

- `RecordingLog`: 생성자에 알람 클레임 목록을 받는 인자를 더하고(`alerts: readonly StockAlertClaim[] = []`. 기존 인자 순서를 깨지 않게 `failingRecord` 앞뒤 어디에 둘지는 기존 호출부를 보고 정한다), `claimDueStockAlerts`가 그것을 돌려주게 한다.
- `RecordingDelivery`에 `alerts` 배열과 `deliverStockAlert`.
- `alertClaim(householdId, attempts = 1)` 헬퍼와, `briefOf`에 `stockAlert`를 채워 주는 방법(인자를 하나 더하거나 스프레드로 덮는 헬퍼).
- `describe('재고 알람')`을 더한다. 이름은 그대로 쓴다(phase 7이 첫 번째를 이름으로 지목한다).
  - 알람 항목이 없으면 no_alert로 종결하고 보내지 않는다
  - 알람 항목이 있으면 그날 날짜와 항목을 실어 보내고 참조로 기록한다
  - 재고 알람을 보낼 곳이 없으면 그날은 종결이다
  - 재고 알람 발송이 던지면 정책이 정한 다음 시각으로 실패를 기록한다
  - 재고 알람의 브리프를 만들지 못한 것도 실패로 기록한다
  - 한 쓸기에서 브리프, 후속, 알람 순으로 처리한다 (결과 배열의 `target` 순서와, 클레임 메서드가 불린 순서를 단언한다. 순서를 기록하려면 `RecordingLog`가 어느 클레임 메서드가 불렸는지 이름을 순서대로 남기게 한다)
- 기존 테스트 "브리프와 후속 메시지를 한 쓸기에서 함께 처리한다"와 "클레임에 넘기는 날짜와 시각은 시계가 준 것이다"가 `log.due`의 길이를 단언하면 알람 클레임 몫으로 하나 늘어난 값에 맞춘다. 단언의 뜻(같은 `due`를 넘긴다)은 그대로 둔다.

### 4. `test/integration/brief-dispatch.int-spec.ts`

쓸기가 알람 결과를 같은 배열에 더하므로, `outcomes` 전체를 `toEqual`로 비교하는 기존 단언(브리프 발송과 후속 메시지 묶음)이 깨진다. **기존 테스트를 지우지 말고**, 비교 대상을 `outcome.target`으로 걸러 브리프와 후속 메시지의 기대값을 그대로 유지한다. 예: `outcomes.filter((outcome) => outcome.target === 'brief')`. 걸러 주는 작은 헬퍼를 파일 위쪽에 하나 두면 된다.

`describe('재고 알람 발송')`을 더한다.

- 재고가 식단보다 모자란 가정은 브리프 시각에 재고 알람이 sent가 된다 (재료와 끼니와 식단을 심고 입고는 넣지 않는다. `FakeBriefDelivery.alerts`에 그 재료가 `urgent`나 `upcoming`으로 실려 있는지 본다)
- 알람 항목이 없는 가정은 no_alert로 skipped가 되고 보내지 않는다 (재료가 없는 가정)
- 같은 날 다시 돌려도 재고 알람을 두 번 보내지 않는다
- 재고 알람 발송이 실패해도 그날 브리프의 기록은 sent 그대로다 (알람과 브리프의 발송 이력이 서로 다른 행이다)

`stock_alert_delivery` 행은 Prisma 클라이언트(`services.prisma.stockAlertDelivery`)로 읽는다.

## Acceptance Criteria

```bash
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
grep -q 'deliverStockAlert' src/application/ports/brief-delivery.port.ts
grep -q "'stock_alert'" src/application/brief-dispatch.service.ts
grep -q "NO_ALERT = 'no_alert'" src/application/brief-dispatch.service.ts
grep -q '알람 항목이 없으면 no_alert로 종결하고 보내지 않는다' src/application/brief-dispatch.service.spec.ts
grep -q '한 쓸기에서 브리프, 후속, 알람 순으로 처리한다' src/application/brief-dispatch.service.spec.ts
grep -q '재고 알람 발송' test/integration/brief-dispatch.int-spec.ts
test "$(grep -n 'claimDueReactionPrompts(due)' src/application/brief-dispatch.service.ts | head -1 | cut -d: -f1)" -lt "$(grep -n 'claimDueStockAlerts(due)' src/application/brief-dispatch.service.ts | head -1 | cut -d: -f1)"
! rg -n '@nestjs' src/application --glob '!*.module.ts'
! rg -n 'new Date\(\)|Date\.now\(\)' src/application --glob '!*.spec.ts'
git diff --quiet HEAD -- src/slack src/infrastructure src/mcp src/domain src/scheduler prisma docs README.md
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `pnpm test:int`는 Docker가 필요하다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- 알람 클레임을 후속 메시지 클레임 앞에 두지 마라. 이유: 마이그레이션 전 배포에서 알람 클레임이 던지면 후속 메시지까지 막힌다. tech-critic-lead의 승인 조건이고 AC가 줄 순서를 본다.
- `test/integration/brief-dispatch.int-spec.ts`의 기존 테스트를 지우지 마라. 쓸기 결과 전체를 비교하는 단언은 `outcome.target`으로 걸러 브리프와 후속 메시지의 기대값을 그대로 유지하라. 이유: 알람 결과가 같은 배열에 더해질 뿐 기존 규칙은 바뀌지 않는다. tech-critic-lead의 승인 조건이다.
- 알람 클레임을 `try`로 감싸 오류를 삼키지 마라. 이유: 브리프와 후속 메시지의 클레임도 감싸지 않는다. 로그 자체의 실패는 쓸기 밖으로 나가 다음 tick이 다시 시작한다(이 파일의 `runEveryHousehold` 주석).
- 항목이 없는 날을 `releaseClaim`으로 되돌리지 마라. 이유: 되돌리면 자정까지 매분 클레임과 브리프 조립이 반복된다. `skipped` 종결이다(ADR 0006의 첫 갈래와 같은 이유).
- 전날 보낸 알람과 비교해 거르지 마라. 이유: "해결될때까지 매일"이고 상태를 저장하지 않는다(ADR 0010 (c)).
- 브리프가 `sent`인지 확인한 뒤에만 알람을 보내는 조건을 넣지 마라. 이유: 두 발송은 독립이다. 브리프가 재시도 중이어도 알람은 간다.
- 알람 항목을 서비스에서 다시 거르거나 계산하지 마라. 이유: `brief.stockAlert`가 계산한 값이다. 서비스는 비었는지만 본다.
- 서비스에 데코레이터를 달거나 `@nestjs/*`를 import하지 마라. 이유: AGENTS.md 계층 절.
- `src/slack`, `src/infrastructure`, `src/scheduler`, `src/domain`을 고치지 마라. 이유: scope 밖이고 앞 phase가 끝냈다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
