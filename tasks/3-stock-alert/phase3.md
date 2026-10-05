# Phase 3: read-model

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md` (`src/application`은 NestJS를 모른다. `src/domain`은 동결이다)
- `tasks/3-stock-alert/docs-diff.md` (ADR 0010 (b)와 (f)가 이 phase의 근거다)
- `docs/adr/0010-stock-alert-message.md` 전체
- `docs/adr/0005-scheduler-and-daily-brief.md`의 "브리프 조립" (`PLAN_RUNWAY_WARNING_DAYS`를 코드 상수로 둔 근거)
- `src/application/daily-brief.ts` 전체 (`buildDailyBrief`가 `stocks`와 `forecasts`를 만드는 곳, `thresholdAlerts`를 거르는 곳)
- `src/domain/forecast/shortage-forecast.ts` (`forecastShortage`의 `until`, `firstShortageDate`와 `shortfallCubes`가 채워지는 조건)
- `src/domain/stock/stock-summary.ts`의 `isAtOrBelowThreshold`
- `src/domain/shared/local-date.ts` (`addDays`, `daysBetween`)
- `src/application/daily-brief.spec.ts` 전체 (`brief()` 픽스처, `stock()`, `meal()`, `INGREDIENTS`, `Fixture.thresholds`)
- `src/application/ports/brief-delivery.port.ts` (`ReactionPrompt`가 포트 파일에 있는 방식)
- `DailyBrief` 리터럴을 가진 테스트 넷: `src/application/brief-dispatch.service.spec.ts`의 `briefOf`, `src/slack/templates/daily-brief.spec.ts`의 `brief()`와 `stockRow` 헬퍼, `src/slack/templates/household-board.spec.ts`의 `BRIEF`, `test/integration/slack-delivery.int-spec.ts`의 `BRIEF`

## 작업 내용

브리프 읽기 모델에 재고 알람과 부족 시작일을 더한다. 도메인 함수는 있는 것을 조합하고 새로 만들지 않는다.

### 1. `src/application/daily-brief.ts`

상수 둘을 `PLAN_RUNWAY_WARNING_DAYS` 옆에 더한다. 주석은 이 파일의 문체대로 영어로, 왜 저장 설정이 아닌지와 숫자의 근거(ADR 0010)를 적는다.

```ts
export const STOCK_ALERT_HORIZON_DAYS = 7;
export const STOCK_ALERT_URGENT_DAYS = 1;
```

타입을 더한다.

```ts
export type StockAlertUrgency = 'urgent' | 'upcoming' | 'low_stock';

export interface BriefStockAlertItem {
  readonly ingredientId: string;
  readonly name: string;
  readonly total: number;
  /** The threshold the ingredient reached. Null when it has none or stock is above it. */
  readonly thresholdCubes: number | null;
  /** First meal date stock cannot cover, over the whole plan. Null when stock outlasts the plan. */
  readonly firstShortageDate: LocalDate | null;
  /** Days from today to `firstShortageDate`. Zero or negative when a meal is already short. */
  readonly daysUntilShortage: number | null;
  /** Cubes missing for the meals within the horizon. Zero when the first shortage is beyond it. */
  readonly horizonShortfallCubes: number;
  readonly urgency: StockAlertUrgency;
}

export interface BriefStockAlert {
  readonly horizonDays: number;
  readonly items: readonly BriefStockAlertItem[];
}
```

`BriefStockRow`에 `readonly firstShortageDate: LocalDate | null;`을 `depletionDate` 뒤에 더한다. `DailyBrief`에 `readonly stockAlert: BriefStockAlert;`를 `expiryAlerts` 뒤에 더한다.

`buildDailyBrief`의 규칙:

- `stock[].firstShortageDate`는 이미 만드는 전체 식단 `forecasts`의 `firstShortageDate`다.
- 7일 창 예측을 한 번 더 부른다: `forecastShortage({ …같은 인자, until: addDays(today, STOCK_ALERT_HORIZON_DAYS) })`. 여기서 재료별 `shortfallCubes`가 `horizonShortfallCubes`다.
- 재료(`stocks`의 각 행)가 항목이 되는 조건은 둘 중 하나다.
  1. 전체 식단 예측의 `firstShortageDate`가 null이 아니고 `daysBetween(today, firstShortageDate) <= STOCK_ALERT_HORIZON_DAYS`.
  2. 임계개수가 있고 `isAtOrBelowThreshold(stock, threshold)`.
- `thresholdCubes`는 2번이 참일 때만 그 임계개수이고 아니면 null이다(`thresholdAlerts`와 같은 판정이다. 같은 판정을 두 번 쓰지 말고 한 번 구한 것을 둘이 쓰게 하라).
- `daysUntilShortage`는 `firstShortageDate`가 null이면 null, 아니면 `daysBetween(today, firstShortageDate)`.
- `urgency`: `daysUntilShortage`가 null이 아니고 `<= STOCK_ALERT_URGENT_DAYS`이면 `urgent`, null이 아니고 `<= STOCK_ALERT_HORIZON_DAYS`이면 `upcoming`, 그 밖은 `low_stock`.
- 항목 순서: `firstShortageDate` 오름차순, null은 뒤. 같으면 `stocks`의 순서를 지킨다.
- `horizonDays`는 `STOCK_ALERT_HORIZON_DAYS`다.

항목 조립은 `buildDailyBrief` 본문에 늘어놓지 말고 이 파일의 다른 부분(`newIngredientsOf`, `heldDeductionsOf`)처럼 함수 하나로 뺀다(`stockAlertOf`). 함수 위 주석에 "왜 임계개수는 합계를 보고 예측은 차감 가능한 큐브를 보는가"(중량 불일치 배치는 합계에는 들지만 차감되지 않는다)를 한두 문장으로 적어라.

상비 재료는 `summarizeStock`과 `forecastShortage`가 이미 빼므로 따로 거르지 않는다.

### 2. `src/application/ports/brief-delivery.port.ts`

타입 하나만 더한다. `ReactionPrompt` 옆이다.

```ts
/** ADR 0010의 재고 알람 메시지. 브리프가 계산한 항목을 그날 날짜와 함께 싣는다. */
export interface StockAlertMessage {
  readonly date: LocalDate;
  readonly alert: BriefStockAlert;
}
```

`BriefDeliveryPort` 인터페이스에는 아무것도 더하지 않는다. 메서드는 phase 5가 올린다. 지금 올리면 `SlackBriefDelivery`와 테스트의 가짜 구현이 `pnpm typecheck`에 걸리는데 그 파일들은 이 phase의 scope 밖이다.

### 3. `src/application/daily-brief.spec.ts`

`describe`를 하나 더하고 아래 테스트를 쓴다. 이름은 그대로 쓴다(phase 7이 "첫 부족일이 7일 안이면 upcoming이다"를 이름으로 지목한다).

- 첫 부족일이 오늘이나 내일이면 urgent다
- 첫 부족일이 7일 안이면 upcoming이다
- 첫 부족일이 8일 뒤이고 임계개수가 없으면 항목이 아니다
- 첫 부족일이 8일 뒤여도 임계개수 이하면 low_stock으로 든다
- 식단에 없는 재료도 임계개수 이하면 low_stock이고 남은 일수가 없다
- 임계개수보다 많고 부족이 7일 밖이면 항목이 아니다
- 7일 안의 부족 수량은 7일 안의 식단만 센다 (전체 식단의 부족 수량보다 작은 경우를 만든다)
- 재고가 있어도 중량이 달라 차감하지 못하면 부족으로 든다
- 상비 재료는 항목이 되지 않는다
- 항목은 첫 부족일이 이른 순이고 첫 부족일이 없는 항목이 뒤다
- 재고 표의 행에 첫 부족일이 붙고 재고가 0인 재료도 식단 날짜가 붙는다

경계를 정확히 만들어라. 7일째(오늘 + 7)는 `upcoming`이고 8일째는 아니다. 1일째(내일)는 `urgent`이고 2일째는 `upcoming`이다. 기존 픽스처의 끼니는 오전 하나라 식단 n번이 오늘 + (n − 1)일에 놓인다. 식단을 9개 이상 넣어야 8일째를 만들 수 있다.

### 4. 리터럴 채우기

`DailyBrief`와 `BriefStockRow`에 필드가 늘어 아래 네 파일의 리터럴이 `pnpm typecheck`에 걸린다. **새 필드를 채우는 것만 한다.**

| 파일 | 고칠 곳 |
|---|---|
| `src/application/brief-dispatch.service.spec.ts` | `briefOf`에 `stockAlert: { horizonDays: 7, items: [] }` |
| `src/slack/templates/daily-brief.spec.ts` | `brief()`에 `stockAlert`, 재고 행 헬퍼(`stockRow`)의 기본값에 `firstShortageDate: null` |
| `src/slack/templates/household-board.spec.ts` | `BRIEF`에 `stockAlert`, 재고 행 리터럴에 `firstShortageDate: null` |
| `test/integration/slack-delivery.int-spec.ts` | `BRIEF`에 `stockAlert` |

`horizonDays`는 숫자 7 대신 `STOCK_ALERT_HORIZON_DAYS`를 import해 써도 된다. `pnpm typecheck`가 다른 파일을 더 지목하면 그 파일이 scope 안일 때만 같은 방식으로 채우고, scope 밖이면 status를 `error`로 보고하라.

## Acceptance Criteria

```bash
pnpm typecheck
pnpm lint
pnpm test
grep -q 'STOCK_ALERT_HORIZON_DAYS = 7' src/application/daily-brief.ts
grep -q 'STOCK_ALERT_URGENT_DAYS = 1' src/application/daily-brief.ts
grep -q 'horizonShortfallCubes' src/application/daily-brief.ts
grep -q 'readonly stockAlert: BriefStockAlert' src/application/daily-brief.ts
grep -q 'StockAlertMessage' src/application/ports/brief-delivery.port.ts
grep -q '첫 부족일이 7일 안이면 upcoming이다' src/application/daily-brief.spec.ts
! grep -q 'deliverStockAlert' src/application/ports/brief-delivery.port.ts
! grep -q 'expiries' src/application/daily-brief.ts
! grep -rn '@nestjs' src/application/daily-brief.ts src/application/ports/brief-delivery.port.ts
! grep -n 'new Date()\|Date.now()' src/application/daily-brief.ts
git diff --quiet "$HARNESS_BASELINE" -- src/slack/templates/daily-brief.ts src/slack/templates/household-board.ts src/slack/templates/brief-lines.ts src/slack/outbound src/mcp src/domain src/scheduler src/application/brief-dispatch.service.ts
git diff --quiet HEAD -- src/infrastructure prisma docs README.md
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- `src/slack/templates/*.spec.ts`와 `test/integration/slack-delivery.int-spec.ts`에서는 리터럴에 `firstShortageDate`와 `stockAlert`를 채우는 것만 하라. 테스트를 더하거나 지우지 마라. 이유: 템플릿과 발송은 phase 4가 한다. tech-critic-lead의 승인 조건이다.
- `src/application/brief-dispatch.service.spec.ts`에서는 `briefOf`의 리터럴만 채워라. 이유: 발송 서비스의 테스트는 phase 5가 쓴다.
- `BriefStockAlert`에 임계일(`expiries` 등)을 넣지 마라. 이유: ADR 0010 (e). ADR 0009의 임계일 결정은 바꾸지 않는다. AC가 `expiries`라는 이름이 없는지 본다.
- `BriefDeliveryPort`에 메서드를 더하지 마라. 이유: 구현체가 scope 밖이다. phase 5가 올린다.
- `src/domain`에 함수를 더하거나 고치지 마라. 이유: 동결 경로이고 `forecastShortage`의 `until`과 `isAtOrBelowThreshold`로 충분하다(ADR 0010 (b)).
- 알람 항목이나 전날 상태를 저장하는 코드를 넣지 마라. 이유: 매번 계산한다(ADR 0010 (c), AGENTS.md 금지 3번).
- `depletionDate`를 지우거나 뜻을 바꾸지 마라. 이유: MCP `forecast_shortage`와 `get_daily_brief`가 그대로 돌려준다. 표의 열만 phase 4에서 바뀐다.
- 상수 7과 1을 알람 설정에서 읽지 마라. 이유: 저장 항목을 늘리지 않는다(ADR 0010 (a)).
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
