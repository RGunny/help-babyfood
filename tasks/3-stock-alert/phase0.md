# Phase 0: docs

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain
```

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고 status를 `error`로, `error_message`에 `dirty working tree`로 보고하고 멈춰라.

먼저 아래를 읽어라. 이 phase는 이 task 전체의 설계를 문서로 고정하는 일이고, 뒤따르는 phase 일곱 개가 여기서 쓴 ADR 0010을 읽고 구현한다. 문서가 틀리면 구현이 틀린다.

- `AGENTS.md`
- `docs/README.md` (문서 지도. 문서마다 축이 하나이고 같은 내용을 두 문서에 적지 않는다)
- `docs/product-plan.md` 전체. 특히 3장(알람은 서버 스케줄러가 Slack으로 직접 보내고, 브리프 내용은 MCP로도 같은 것을 조회한다), 5장(브리프 구성), 6장(도메인 모델 표의 알람 설정과 브리프 발송 이력), 9장의 "N단계에서 정한 것" 절들
- `docs/adr/0005-scheduler-and-daily-brief.md` (`PLAN_RUNWAY_WARNING_DAYS`를 코드 상수로 둔 근거)
- `docs/adr/0006-slack-delivery-and-deployment.md`의 "발송 기록과 클레임", "재시도 정책", "브리프 시각 판정은 SQL 선별로 한다"
- `docs/adr/0007-slack-message-templates.md` (재고 표 한 장, "부족 예측은 브리프에서 뺐다" 문단, 표의 열 목록)
- `docs/adr/0009-pantry-ingredients-and-expiry-notice.md` (임계일 목록을 없앤 결정. 이 task는 그 결정을 바꾸지 않는다)
- `docs/user-intervention.md` 전체. 특히 머리의 상태 표와 6번, 10번 항목의 서술 방식
- `src/application/daily-brief.ts` (`BriefStockRow`, `DailyBrief.shortages`, `thresholdAlerts`, `PLAN_RUNWAY_WARNING_DAYS`)
- `src/domain/forecast/shortage-forecast.ts` (`depletionDate`와 `firstShortageDate`가 언제 null인지, `until` 인자)
- `src/slack/templates/brief-lines.ts` (`stockRowsOf`의 `isEmpty`, `byUrgency`)
- `src/slack/templates/daily-brief.ts` (`stockBlocks`의 `재고 0:` 줄, `render`의 `text`)
- `src/application/brief-dispatch.service.ts` (`runEveryHousehold`의 클레임 순서와 try 범위)

## 배경

2026-10-05에 사용자가 Claude Code 대화에서 말한 것이다. `docs/backlog.md`를 거치지 않았으므로 ADR 0010이 유일한 기록이다. 날짜와 함께 그대로 인용하라.

- "지금 재고알람이 전혀안와. 데일리브리프하면서 재고는 따로 노티주긴 해야하는거 아니야? 임계일이고 뭐고 사용자가 눈으로 하나하나 봐야하고, 심지어 재고 0은 작은글씨로 안보이게 나열식으로 모아놔서 볼수조차 없어."
- 개선안을 보고 정한 다섯 가지: 임계개수는 "4개", "식단표 바탕으로 남은 일수까지 계산하고싶지만 4개나 잘처리해", "같은채널 별도 메세지", "해결될때까지 매일", "아침만 보내".

그날 확인한 상태는 다음과 같다. ADR의 맥락에 적어라.

- 임계개수가 하나도 설정되어 있지 않았다(`get_alert_settings`의 `thresholds`가 빈 배열). 그래서 임계개수 알람은 0건이었고 표의 `임계` 열은 전부 `–`였다. 같은 날 `update_alert_settings`로 큐브 추적 재료 28개 전부에 4를 넣었다. 운영 데이터이고 코드 변경이 아니다.
- ADR 0007이 부족 예측을 브리프에서 뺐다. `DailyBrief.shortages`는 계산되지만 Slack 템플릿이 읽지 않는다.
- 재고가 0이고 임계개수가 없는 재료는 표에서 빠져 context 블록(작은 회색 글씨) 한 줄 `재고 0: …`로 내려갔다. 그날 그 줄에 17개 재료가 있었고 그중 두부는 다음 날 식단에 들어 있었다.
- 표의 정렬 기준은 `depletionDate`인데 재고 0인 재료는 할당이 한 번도 성공하지 않아 `depletionDate`가 null이다. 표에 넣어도 맨 뒤로 간다. 가장 급한 재료가 가장 안 보였다.
- 브리프 메시지의 `text`(푸시 미리보기에 뜨는 한 줄)는 제목뿐이다.
- 부족은 `heldDeductions`로 끼니가 지난 뒤에만 알려진다.

## 작업 내용

문서만 고친다. **코드는 한 줄도 건드리지 않는다.** 아래 다섯 가지를 한다.

### 1. `docs/adr/0010-stock-alert-message.md` 신설

제목은 "ADR 0010: 재고 알람은 브리프와 별도 메시지로 매일 아침 보내고, 재고 표는 부족 시작일 순으로 보인다"로 한다. 형식은 ADR 0009와 같다(제목, 상태 채택, 결정일 2026-10-05, 맥락, 결정, 층별 결합, 대가와 남는 위험). 아래 결정을 전부 담는다. 이미 정해진 것이므로 새로 정하지 말고 근거를 붙여 서술하라.

**(a) 재고 알람은 브리프와 다른 메시지다.**

브리프 시각에 같은 채널로 메시지를 하나 더 보낸다. 알람 항목이 0건인 날은 보내지 않는다. 브리프 맨 위 섹션으로 넣는 안과 부모 각자에게 DM으로 보내는 안은 사용자가 "같은채널 별도 메세지"로 기각했다. 별도 메시지의 이점은 푸시가 따로 오고 `text`에 "재고 알람: 두부 내일부터 부족 외 9건" 같은 요약이 실린다는 것이다. 저녁 알림은 두지 않는다("아침만 보내"). 알람 설정의 저장 항목(브리프 시각, 재료별 임계개수, 임계일)은 늘지 않는다.

**(b) 알람 항목의 판정은 애플리케이션 읽기 모델이 한다.**

`DailyBrief.stockAlert: BriefStockAlert`를 `buildDailyBrief`(`src/application/daily-brief.ts`)가 채운다. 모양은 다음과 같다. ADR에 그대로 적어라.

```ts
export const STOCK_ALERT_HORIZON_DAYS = 7;
export const STOCK_ALERT_URGENT_DAYS = 1;

export type StockAlertUrgency = 'urgent' | 'upcoming' | 'low_stock';

export interface BriefStockAlertItem {
  readonly ingredientId: string;
  readonly name: string;
  readonly total: number;
  /** 임계개수에 닿았을 때만 그 값. */
  readonly thresholdCubes: number | null;
  /** 전체 식단 기준 첫 부족일. 식단이 재고로 다 덮이면 null. */
  readonly firstShortageDate: LocalDate | null;
  /** 오늘부터 첫 부족일까지의 일수. 사용자가 말한 "남은 일수"다. */
  readonly daysUntilShortage: number | null;
  /** 오늘부터 7일 안의 식단에서 모자라는 큐브 수. */
  readonly horizonShortfallCubes: number;
  readonly urgency: StockAlertUrgency;
}

export interface BriefStockAlert {
  readonly horizonDays: number;
  readonly items: readonly BriefStockAlertItem[];
}
```

규칙:

- 항목이 되는 조건은 둘 중 하나다. 첫 부족일이 오늘로부터 `STOCK_ALERT_HORIZON_DAYS`일 이내이거나, 합계가 임계개수 이하다(기존 `isAtOrBelowThreshold`, `thresholdAlerts`와 같은 판정).
- `urgency`: 첫 부족일이 오늘로부터 `STOCK_ALERT_URGENT_DAYS`일 이내(오늘, 내일, 이미 지난 날)이면 `urgent`, 7일 이내면 `upcoming`, 그 밖(임계개수 이하인데 부족은 7일 뒤이거나 없음)은 `low_stock`이다.
- `horizonShortfallCubes`는 `forecastShortage`를 `until: 오늘 + 7일`로 한 번 더 불러 얻는다. 기존 도메인 함수의 인자 그대로이므로 `src/domain`은 고치지 않는다.
- 항목은 첫 부족일이 이른 순이고 첫 부족일이 없는 항목이 뒤에 온다.
- 상비 재료는 `forecastShortage`와 `summarizeStock`이 이미 빼므로 항목이 되지 않는다(ADR 0009).
- 재고가 있어도 중량 불일치로 차감할 수 없으면 예측이 부족으로 잡으므로 항목이 된다. 임계개수 판정은 합계를 보지만 예측은 차감 가능한 큐브만 본다.

근거로 적을 것:

- 판정을 템플릿이 아니라 애플리케이션에 두는 이유: 어댑터는 재고 규칙을 다시 쓰지 않는다(AGENTS.md 계층 절). 템플릿은 `urgency`와 `daysUntilShortage`를 읽기만 한다.
- `stockAlert`를 `DailyBrief`의 필드로 두는 이유: 7일 창 예측에 `HouseholdState`가 필요하고 `buildDailyBrief`가 이미 그것을 쥐고 있다. MCP `get_daily_brief`도 같은 값을 돌려준다(기획 3장 "브리프 내용은 MCP 도구로도 같은 것을 조회할 수 있다").
- 상수 7의 근거: 한 주다. 그날 전체 식단(30일) 기준 부족은 27건이었고 7일 창으로 줄이면 10건이었다. ADR 0007이 부족 예측을 뺀 이유가 줄글 9줄이었는데, 창이 없으면 같은 문제가 되돌아온다. `PLAN_RUNWAY_WARNING_DAYS`(ADR 0005)와 같이 코드 상수로 두고 설정 항목으로 만들지 않는다.
- 상수 1의 근거: 오늘과 내일 끼니는 지금 조리하지 않으면 못 먹인다.
- 전체 식단의 `shortfallCubes` 대신 7일 창 수량을 쓰는 이유: 그날 쌀의 전체 부족은 54개였고 7일 창은 8개였다. 54는 한 번에 조리할 양이 아니다.
- 임계개수와 식단 예측을 함께 쓰는 이유: 기획 5장 "고정 임계개수만으로는 소모 속도를 반영하지 못한다". 사용자도 "식단표 바탕으로 남은 일수까지 계산하고싶지만 4개나 잘처리해"라고 했다. 예측이 주 기준이고 임계개수는 부족이 7일보다 먼 재료를 미리 알리는 보조 기준이다.

**(c) "해결될 때까지 매일"은 저장 없이 성립한다.**

매일 아침 다시 계산해 항목이 있으면 보낸다. 전날과 비교해 새로 생긴 것만 보내는 안은 택하지 않았다. 사용자가 "해결될때까지 매일"을 골랐고, 비교하려면 전날의 알람 상태를 저장해야 하는데 그것은 계산으로 얻을 수 있는 값이다(AGENTS.md 금지 3번).

**(d) 발송 이력은 `stock_alert_delivery` 테이블이다.**

기본키는 (`household_id`, `date`)이고 컬럼과 CHECK 넷은 `brief_delivery`와 같다. 클레임, 재시도, 리스는 ADR 0006 그대로다. `DeliveryClaim`에 `kind: 'stock_alert'`가 하나 늘고, `BriefDeliveryLogPort.claimDueStockAlerts`와 `BriefDeliveryPort.deliverStockAlert`가 는다. 보낸 메시지는 `slack_message`에 `template_key = 'stock_alert'`로 남는다.

검토한 대안을 표로 적어라.

| 대안 | 택하지 않은 이유 |
|---|---|
| `SlackBriefDelivery.deliverDailyBrief`가 브리프 뒤에 알람을 한 번 더 post | 브리프는 갔고 알람이 실패하면, 던지면 재시도가 브리프를 한 번 더 보내고 삼키면 알람이 조용히 사라진다. 이 task의 출발점이 "알람이 안 온다"이다. "0건이면 보내지 않는다"는 판정도 어댑터로 내려간다 |
| `brief_delivery`에 종류 컬럼을 더해 기본키를 바꾼다 | 운영 데이터가 있는 테이블의 기본키 변경이고, ADR 0006의 "기본키가 하루 한 건을 강제한다"는 테이블별 구조와 어긋난다 |

발송 사실은 계산으로 얻을 수 없으므로 "계산으로 얻을 수 있는 상태의 저장"이 아니다.

항목이 0건이면 `no_alert` 사유로 `skipped` 종결이다. 낮에 재고가 줄어도 그날 알람은 다시 가지 않고 다음 날 아침에 간다.

쓸기 한 번의 순서는 브리프, 후속 메시지, 재고 알람이다. 알람 클레임을 마지막에 두는 이유: 마이그레이션이 적용되기 전에 뜬 서버에서는 `stock_alert_delivery`가 없어 알람 클레임이 던지는데, 클레임은 try 밖이라 그 뒤의 루프가 돌지 않는다. 마지막이면 막히는 것이 알람뿐이다.

**(e) 알람 메시지의 양식.**

`src/slack/templates/stock-alert.ts`, key `stock_alert`, version 1이다. 구성은 다음과 같다. 예시를 ADR에 넣어라.

```
재고 알람 · 조리 필요 10건

오늘·내일 부족
• 두부  재고 0개 · 내일(10-06)부터 부족 · 7일 안에 2개 부족

7일 안에 부족
• 오트밀  재고 4개 · 10-08부터(D-3) · 7일 안에 10개 부족
• 흰살생선  재고 0개 · 10-08부터(D-3) · 7일 안에 2개 부족
• 쌀  재고 6개 · 10-09부터(D-4) · 7일 안에 8개 부족

임계개수 이하
시금치 4개(10-19부터), 양파 0개(10-14부터), 무 0개(10-16부터)
```

- 머리의 "조리 필요 N건"은 `urgent`와 `upcoming`의 수다. 둘 다 없고 `low_stock`만 있으면 "재고 알람 · 임계개수 이하 N건"이다.
- `low_stock`은 한 줄에 쉼표로 잇는다. 28개 재료 전부에 임계개수 4가 걸려 있어 재고 0인 미도입 재료가 스무 개 가까이 되기 때문이다.
- `text`는 첫 항목으로 만든 한 줄이다. 예: `재고 알람: 두부 내일부터 부족 외 9건`.
- 임계일은 싣지 않는다. **ADR 0009의 임계일 결정은 바꾸지 않는다.** 2026-09-29에 사용자가 "임계일 섹션은 필요 없어 보이고 재고 표에서 그냥 같이 보면 될 것 같아"와 "폐기 신경 쓰지 말라니까?"라고 정했고, 2026-10-05의 다섯 결정에 임계일은 없다. 임계 지남 배치가 남아 있는 동안 매일 푸시가 가는 것도 그 결정과 어긋난다. 이 문장("ADR 0009의 임계일 결정은 바꾸지 않는다")을 ADR 본문에 그대로 넣어라.
- 버튼은 없다. 조리해 입고를 등록하면 다음 알람에서 빠진다.

**(f) 재고 표는 부족 시작일 순이고 `소진 예상` 열이 `부족 시작` 열이 된다.**

브리프(`daily_brief`)와 상태판(`household_board`)의 템플릿 버전이 5가 된다.

- `BriefStockRow.firstShortageDate: LocalDate | null`을 더한다. 전체 식단 예측의 첫 부족일이다.
- `byUrgency`의 첫 기준을 `depletionDate`에서 `firstShortageDate`로 바꾼다. 나머지 기준(임계개수에 닿은 재료, 임계일이 임박하거나 지난 재료)은 그대로다.
- 표의 `소진 예상` 열을 `부족 시작` 열로 바꾼다. ADR 0007의 열 선택을 뒤집는 이유를 적어라: 재고 0인 재료는 `depletionDate`가 null이라(`forecastShortage`가 할당에 성공했을 때만 그 날짜를 채운다) 정렬에서 맨 뒤로 가고 칸도 비었다. 부모가 움직여야 하는 날은 마지막 큐브를 쓰는 날이 아니라 큐브가 모자라는 첫날이다. 정렬 기준과 보이는 값이 같아야 재고 0 행이 위에 있는 이유를 읽을 수 있다. `depletionDate`는 읽기 모델과 MCP에 그대로 남는다.
- 표에서 빠져 한 줄로 가는 조건을 `total === 0 && thresholdCubes === null && firstShortageDate === null`로 바꾼다. 재고가 0이어도 식단에 있는 재료는 표에 남는다. 재고도 식단도 임계개수도 없는 재료만 `재고 0:` 줄로 간다.
- 부족 수량은 브리프와 상태판에 싣지 않는다. 날짜는 `부족 시작` 열이, 수량은 재고 알람이 보인다.

**층별 결합.** ADR 0009와 같은 모양의 그림을 넣어라.

```
domain      바뀌지 않는다. forecastShortage(until), isAtOrBelowThreshold를 그대로 쓴다
                │
application DailyBrief.stockAlert, BriefStockRow.firstShortageDate
            BriefDeliveryLogPort.claimDueStockAlerts, BriefDeliveryPort.deliverStockAlert
            BriefDispatchService: 브리프, 후속 메시지, 재고 알람 순
                │
persistence stock_alert_delivery (PrismaBriefDeliveryLog)
slack       templates/stock-alert.ts, daily-brief.ts v5, household-board.ts v5
mcp         get_daily_brief 출력에 stockAlert, stock[].firstShortageDate
```

**대가와 남는 위험.** 다음을 전부 적어라.

- 임계개수가 없는 재료는 `low_stock`에 들지 않는다. 임계개수는 재료별 설정이라(기획 6장) 새로 등록한 재료에는 없다. 그 재료가 식단에 들어가면 예측이 잡으므로 `urgent`와 `upcoming`에는 든다. 놓치는 것은 "부족이 7일보다 먼데 재고가 적다"는 이른 예고뿐이다.
- `slack_template_key` enum에 더한 `stock_alert` 값은 Postgres에서 지울 수 없다. 테이블은 drop으로 되돌릴 수 있다.
- 마이그레이션 전에 배포된 서버에서는 알람 클레임이 매분 던진다. 브리프와 후속 메시지는 앞에서 이미 돌았으므로 막히지 않지만 로그에 오류가 매분 쌓인다(`docs/user-intervention.md` 11번).
- 07:30에 푸시가 두 번 온다.
- 같은 알람이 해결될 때까지 매일 온다. 식단이 재고보다 한참 앞서 있는 기간에는 매일 열 줄 안팎이다.
- 브리프 조립(`DailyBriefService.get`)이 가정마다 하루 한 번 더 돈다.
- 낮에 재고가 0이 되어도 다음 날 아침까지 알람이 없다.

"개정" 절이나 변경 이력은 두지 않는다. 최종 상태만 적는다.

### 2. `docs/product-plan.md`

- **5장**: 브리프 구성 목록의 재고현황 표 항목을 고친다. "소진 예상일"을 "부족 시작일"로 바꾸고, 표가 부족 시작일이 이른 순이며 재고가 0이어도 식단에 있는 재료는 표에 남는다고 적는다(ADR 0010). 취소선이 그어진 부족 예측 항목의 설명을 "브리프에서는 부족 시작일로 대신하고, 7일 안의 부족 수량은 재고 알람이 싣는다(ADR 0010). 전체 식단의 부족 수량은 MCP `forecast_shortage`가 준다"로 고친다.
- **5장**: 브리프 구성 목록 뒤, "고정 임계개수만으로는…" 문단 앞에 재고 알람 문단을 하나 더한다. 내용: 브리프와 같은 시각에 같은 채널로 재고 알람을 따로 보낸다. 항목은 식단 기준으로 7일 안에 부족해지는 재료와 임계개수 이하인 재료이고, 재료마다 부족까지 남은 일수와 7일 안에 모자라는 큐브 수가 붙는다. 항목이 없는 날은 보내지 않고, 해결될 때까지 매일 보낸다. 임계일은 싣지 않는다(ADR 0009, ADR 0010).
- **6장**: 도메인 모델 표에서 "브리프 발송 이력" 행 아래에 "재고 알람 발송 이력 | 발송 일시, 결과, 재시도 횟수. 가정마다 하루 한 건" 행을 더한다.
- **9장**: "상비 재료와 임계일 표시에서 정한 것" 절 뒤, "## 10. 미정 사항" 앞에 "### 재고 알람에서 정한 것" 절을 더한다. 두 문단으로 쓴다. 첫 문단은 알람 메시지(별도 메시지, 판정 규칙, 상수 7과 1, 저장 없이 매일, `stock_alert_delivery`, 쓸기 순서), 둘째 문단은 재고 표(부족 시작일 정렬과 열, 표에 남는 조건). 마지막에 "근거는 `docs/adr/0010-stock-alert-message.md`에 있다."를 붙인다. 다른 "N단계에서 정한 것" 절의 문체를 따른다.

7장(MCP 도구 표)은 고치지 않는다. 도구가 늘지 않는다.

### 3. `docs/adr/0007-slack-message-templates.md`

두 곳에 한 줄씩 덧붙인다. 기존 문장은 지우지 않는다(ADR 0009가 뒤집은 문단에 취소선과 날짜 주석을 단 방식을 따른다).

- "부족 예측(부족 시작일, 부족 개수)은 브리프에서 뺐다…" 문단 끝에: 2026-10-05 ADR 0010이 고쳤다. 표의 `소진 예상` 열은 `부족 시작` 열이 되었고, 7일 안의 부족 수량은 재고 알람 메시지가 싣는다.
- 템플릿 표(`daily_brief`, `reaction_prompt`) 아래에: `stock_alert` 템플릿은 ADR 0010이 더했다.

"대가와 남는 위험"의 "부족 예측이 Slack 브리프에서 빠졌으므로…" 항목에도 같은 주석을 단다.

### 4. `docs/user-intervention.md`

- 머리의 상태 표에 11번 행을 더한다: `| 11 | 재고 알람 마이그레이션과 휴대폰 확인 | 안 함 |`. 표 위 문단의 "10번은 … 더한 일이다" 뒤에 "11번은 재고 알람(ADR 0010)이 더한 일이다"를 잇는다.
- 문서 끝에 `## 11. 재고 알람 마이그레이션을 적용하고 휴대폰에서 알람을 확인한다` 절을 더한다. 10번 절의 서술 방식을 따른다.
  - 체크박스 둘(둘 다 `- [ ]`): 배포 뒤 운영 컨테이너에서 `stock_alert_delivery` 마이그레이션을 적용한다 / 다음 날 아침 휴대폰에서 재고 알람 메시지와 브리프 표를 확인한다.
  - 명령은 10번과 같다: `railway ssh "cd /app && pnpm db:deploy"`.
  - 배포 직후에 바로 돌려야 하는 이유: 마이그레이션 전에는 알람 클레임이 매분 던져 로그에 오류가 쌓인다. 브리프와 후속 메시지는 먼저 돌므로 막히지 않는다(ADR 0010).
  - 확인 방법: 다음 날 07:30 뒤 채널에 브리프와 재고 알람 두 메시지가 왔는지 본다. 미리 보려면 `railway ssh "node dist/scripts/preview-slack.js --household 재하네 --template stock_alert"`. 휴대폰에서 볼 것은 셋이다. 푸시 미리보기에 "재고 알람: …" 한 줄이 뜨는지, `임계개수 이하` 한 줄이 잘리지 않는지, 브리프 표의 `부족 시작` 열이 보이는지.
  - 사람 몫인 이유: 마이그레이션은 운영 DB에 쓰는 일이고(AGENTS.md 검증 절), 휴대폰 화면은 CLI로 볼 수 없다.

### 5. `README.md`

운영 문단의 미리보기 설명에 `--template stock_alert`가 재고 알람을 보낸다는 말을 한 구절 더한다. ADR 목록이 있으면 `0010-stock-alert-message`를 더한다.

`docs/backlog.md`는 고치지 않는다. 이 요구는 backlog를 거치지 않았고, 남아 있는 "끼니 중량 상한" 항목은 이 task의 범위가 아니다.

## Acceptance Criteria

```bash
test -f docs/adr/0010-stock-alert-message.md
grep -q '2026-10-05' docs/adr/0010-stock-alert-message.md
grep -q '같은채널 별도 메세지' docs/adr/0010-stock-alert-message.md
grep -q '해결될때까지 매일' docs/adr/0010-stock-alert-message.md
grep -q '아침만 보내' docs/adr/0010-stock-alert-message.md
grep -q 'STOCK_ALERT_HORIZON_DAYS' docs/adr/0010-stock-alert-message.md
grep -q 'STOCK_ALERT_URGENT_DAYS' docs/adr/0010-stock-alert-message.md
grep -q 'horizonShortfallCubes' docs/adr/0010-stock-alert-message.md
grep -q 'stock_alert_delivery' docs/adr/0010-stock-alert-message.md
grep -q 'no_alert' docs/adr/0010-stock-alert-message.md
grep -q '부족 시작' docs/adr/0010-stock-alert-message.md
grep -q 'firstShortageDate' docs/adr/0010-stock-alert-message.md
grep -q 'ADR 0009의 임계일 결정은 바꾸지 않는다' docs/adr/0010-stock-alert-message.md
grep -q '부족 시작' docs/product-plan.md
grep -q '재고 알람에서 정한 것' docs/product-plan.md
grep -q '재고 알람 발송 이력' docs/product-plan.md
grep -q '0010' docs/adr/0007-slack-message-templates.md
grep -q '^## 11\.' docs/user-intervention.md
grep -q 'stock_alert_delivery' docs/user-intervention.md
grep -q 'stock_alert' README.md
grep -q '끼니 중량 상한' docs/backlog.md
python3 scripts/harness/check_docs.py
git diff --quiet "$HARNESS_BASELINE" -- src prisma test package.json docs/backlog.md docs/adr/0009-pantry-ingredients-and-expiry-notice.md
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- 코드를 고치지 마라. 이유: 문서가 먼저 바뀌어야 이후 phase가 읽을 기준이 생기고, scope가 `docs/`와 `README.md`뿐이라 러너가 phase를 실패로 처리한다.
- 알람 메시지에 임계일 묶음을 넣는 결정을 적지 마라. 이유: ADR 0009가 2026-09-29의 사용자 발언으로 임계일 목록을 없앴고, 2026-10-05의 다섯 결정에 임계일이 없다. tech-critic-lead가 이 부분을 근거 없음으로 거부했다.
- ADR 0009를 고치지 마라. 이유: 그 결정은 그대로 유효하다. AC가 그 파일이 바뀌지 않았는지 본다.
- 저녁 알림, 알람 시각 설정, 가정 기본 임계개수, DM 발송, 전날 대비 변화 감지를 "앞으로 할 일"로도 적지 마라. 이유: 사용자가 "아침만 보내"와 "해결될때까지 매일"로 정했고 나머지는 요구된 적이 없다. 대가 절에 사실로만 적는다.
- ADR 0010에 "개정" 절이나 변경 이력을 두지 마라. 이유: 최종 상태만 담는다.
- ADR 0005, 0006의 결정을 고치지 마라. 이유: 클레임과 재시도 정책을 그대로 쓴다.
- `docs/backlog.md`를 고치지 마라. 이유: 이 요구는 backlog에 없었고 남은 항목은 범위 밖이다.
- 새 `.md`를 `docs/adr/0010-stock-alert-message.md` 말고 만들지 마라. 이유: `scripts/doc-paths.json` 허용 목록 밖의 경로는 `check_docs.py`가 막는다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
