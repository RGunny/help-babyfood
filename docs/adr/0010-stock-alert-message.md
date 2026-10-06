# ADR 0010: 재고 알람은 브리프와 별도 메시지로 매일 아침 보내고, 재고 표는 부족 시작일 순으로 보인다

- 상태: 채택
- 결정일: 2026-10-05

## 맥락

2026-10-05에 사용자가 Claude Code 대화에서 말했다. `docs/backlog.md`를 거치지 않았으므로 발언은 여기에만 남는다.

> 지금 재고알람이 전혀안와. 데일리브리프하면서 재고는 따로 노티주긴 해야하는거 아니야? 임계일이고 뭐고 사용자가 눈으로 하나하나 봐야하고, 심지어 재고 0은 작은글씨로 안보이게 나열식으로 모아놔서 볼수조차 없어.

같은 날 개선안을 보고 다섯 가지를 정했다. 임계개수는 "4개", 판정 기준은 "식단표 바탕으로 남은 일수까지 계산하고싶지만 4개나 잘처리해", 보내는 곳은 "같은채널 별도 메세지", 반복은 "해결될때까지 매일", 시각은 "아침만 보내"다.

그날 확인한 상태는 다음과 같다.

- 임계개수가 하나도 설정되어 있지 않았다. `get_alert_settings`의 `thresholds`가 빈 배열이었다. 그래서 임계개수 알람은 0건이었고 재고 표의 `임계` 열은 전부 `–`였다. 같은 날 `update_alert_settings`로 큐브 추적 재료 28개 전부에 4를 넣었다. 이것은 운영 데이터이고 코드 변경이 아니다.
- ADR 0007이 부족 예측을 브리프에서 뺐다. `DailyBrief.shortages`(`src/application/daily-brief.ts`)는 계산되지만 Slack 템플릿이 읽지 않는다.
- 재고가 0이고 임계개수가 없는 재료는 표에서 빠져 context 블록(작은 회색 글씨) 한 줄 `재고 0: …`로 내려갔다(`src/slack/templates/brief-lines.ts`의 `stockRowsOf`). 그날 그 줄에 17개 재료가 있었고 그중 두부는 다음 날 식단에 들어 있었다.
- 표의 정렬 기준은 `depletionDate`다(`byUrgency`). 재고가 0인 재료는 할당이 한 번도 성공하지 않아 `depletionDate`가 null이고, 표에 넣어도 맨 뒤로 간다. 가장 급한 재료가 가장 안 보였다.
- 브리프 메시지의 `text`(푸시 미리보기에 뜨는 한 줄)는 제목뿐이다.
- 부족은 `heldDeductions`로 끼니가 지난 뒤에만 알려진다.

정할 것은 여섯이다. 알람을 어디에 어떤 메시지로 보내는지, 무엇이 알람 항목인지를 어느 층이 판정하는지, "해결될 때까지 매일"을 어떻게 이루는지, 발송 이력을 어디에 두는지, 메시지의 양식, 그리고 재고 표의 정렬과 열이다.

## 결정

### 재고 알람은 브리프와 다른 메시지다

브리프 시각에 같은 채널로 메시지를 하나 더 보낸다. 알람 항목이 0건인 날은 보내지 않는다.

브리프 맨 위 섹션으로 넣는 안과 부모 각자에게 DM으로 보내는 안은 사용자가 "같은채널 별도 메세지"로 기각했다. 별도 메시지는 푸시가 따로 오고, `text`에 "재고 알람: 두부 내일부터 부족 외 9건" 같은 요약이 실린다. 브리프의 `text`는 제목뿐이라 브리프 안의 섹션은 푸시 미리보기에 드러나지 않는다.

저녁 알림은 두지 않는다. 사용자가 "아침만 보내"라고 정했다. 알람 설정의 저장 항목(브리프 시각, 재료별 임계개수, 임계일)은 늘지 않는다.

### 알람 항목의 판정은 애플리케이션 읽기 모델이 한다

`DailyBrief.stockAlert: BriefStockAlert`를 `buildDailyBrief`(`src/application/daily-brief.ts`)가 채운다.

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

규칙은 다음과 같다.

- 항목이 되는 조건은 둘 중 하나다. 첫 부족일이 오늘로부터 `STOCK_ALERT_HORIZON_DAYS`일 이내이거나, 합계가 임계개수 이하다. 뒤쪽은 기존 `isAtOrBelowThreshold`이고 `thresholdAlerts`와 같은 판정이다.
- `urgency`는 첫 부족일로 정한다. 오늘로부터 `STOCK_ALERT_URGENT_DAYS`일 이내(오늘, 내일, 이미 지난 날)이면 `urgent`, 7일 이내면 `upcoming`이다. 그 밖, 곧 임계개수 이하인데 부족이 7일 뒤이거나 없는 항목은 `low_stock`이다.
- `horizonShortfallCubes`는 `forecastShortage`를 `until: 오늘 + 7일`로 한 번 더 불러 얻는다. 기존 도메인 함수의 인자 그대로이므로 `src/domain`은 고치지 않는다.
- 항목은 첫 부족일이 이른 순이고, 첫 부족일이 없는 항목이 뒤에 온다.
- 상비 재료는 `forecastShortage`와 `summarizeStock`이 이미 빼므로 항목이 되지 않는다(ADR 0009).
- 재고가 있어도 중량 불일치로 차감할 수 없으면 예측이 부족으로 잡으므로 항목이 된다. 임계개수 판정은 합계를 보지만 예측은 차감 가능한 큐브만 본다.

판정을 템플릿이 아니라 애플리케이션에 두는 이유는 계층 규약이다. 어댑터는 재고 규칙을 다시 쓰지 않는다(AGENTS.md 계층 절). 템플릿은 `urgency`와 `daysUntilShortage`를 읽기만 하고 날짜를 계산하지 않는다. ADR 0009가 임계일 강조 판정을 템플릿 밖에 둔 것과 같은 판단이다.

`stockAlert`를 `DailyBrief`의 필드로 두는 이유는 둘이다. 7일 창 예측에 `HouseholdState`가 필요한데 `buildDailyBrief`가 이미 그것을 쥐고 있다. 그리고 MCP `get_daily_brief`가 같은 값을 돌려주게 된다. 기획안 3장이 "브리프 내용은 MCP 도구로도 같은 것을 조회할 수 있다"고 정했다.

상수 7은 한 주다. 2026-10-05에 전체 식단(30일) 기준 부족은 27건이었고 7일 창으로 줄이면 10건이었다. ADR 0007이 부족 예측을 브리프에서 뺀 이유가 줄글 9줄이었는데, 창이 없으면 같은 문제가 되돌아온다. `PLAN_RUNWAY_WARNING_DAYS`(ADR 0005)와 같이 코드 상수로 두고 설정 항목으로 만들지 않는다.

상수 1은 조리할 시간이다. 오늘과 내일 끼니는 지금 조리하지 않으면 못 먹인다.

부족 수량으로 전체 식단의 `shortfallCubes` 대신 7일 창의 수량을 쓴다. 그날 쌀의 전체 부족은 54개였고 7일 창은 8개였다. 54는 한 번에 조리할 양이 아니다.

임계개수와 식단 예측은 함께 쓴다. 기획안 5장이 "고정 임계개수만으로는 소모 속도를 반영하지 못한다"고 적었고, 사용자도 "식단표 바탕으로 남은 일수까지 계산하고싶지만 4개나 잘처리해"라고 했다. 예측이 주 기준이고, 임계개수는 부족이 7일보다 먼 재료를 미리 알리는 보조 기준이다.

### "해결될 때까지 매일"은 저장 없이 성립한다

매일 아침 항목을 다시 계산해 있으면 보낸다. 조리해 입고를 등록하거나 식단을 고쳐 부족이 풀리면 다음 날 계산에서 그 항목이 빠진다.

전날과 비교해 새로 생긴 항목만 보내는 안은 택하지 않았다. 사용자가 "해결될때까지 매일"을 골랐다. 그리고 비교하려면 전날의 알람 상태를 저장해야 하는데, 그것은 계산으로 얻을 수 있는 값이다(AGENTS.md 금지 3번).

### 발송 이력은 `stock_alert_delivery` 테이블이다

기본키는 (`household_id`, `date`)이고 컬럼과 CHECK 넷은 `brief_delivery`와 같다. 클레임, 재시도, 리스는 ADR 0006 그대로다. `DeliveryClaim`에 `kind: 'stock_alert'`가 하나 늘고, `BriefDeliveryLogPort.claimDueStockAlerts`와 `BriefDeliveryPort.deliverStockAlert`가 는다. 보낸 메시지는 `slack_message`에 `template_key = 'stock_alert'`로 남는다(ADR 0007).

발송 사실은 계산으로 얻을 수 없다. 그래서 이 테이블은 AGENTS.md 금지 3번이 말하는 "계산으로 얻을 수 있는 상태의 저장"이 아니다. 저장하는 것은 "오늘 보냈는가"이고, "무엇이 부족한가"는 여전히 매번 계산한다.

검토한 대안은 둘이다.

| 대안 | 택하지 않은 이유 |
|---|---|
| `SlackBriefDelivery.deliverDailyBrief`가 브리프 뒤에 알람을 한 번 더 post | 브리프는 갔고 알람이 실패하면, 던지면 재시도가 브리프를 한 번 더 보내고 삼키면 알람이 조용히 사라진다. 이 결정의 출발점이 "알람이 안 온다"이다. "0건이면 보내지 않는다"는 판정도 어댑터로 내려간다 |
| `brief_delivery`에 종류 컬럼을 더해 기본키를 바꾼다 | 운영 데이터가 있는 테이블의 기본키 변경이고, ADR 0006의 "기본키가 하루 한 건을 강제한다"는 테이블별 구조와 어긋난다 |

항목이 0건이면 `no_alert` 사유로 `skipped` 종결이다. `skipped`는 종결 상태이므로(ADR 0006 "재시도 정책") 낮에 재고가 줄어도 그날 알람은 다시 가지 않고 다음 날 아침에 간다.

쓸기 한 번(`BriefDispatchService.runEveryHousehold`)의 순서는 브리프, 후속 메시지, 재고 알람이다. 알람 클레임을 마지막에 두는 이유는 마이그레이션이다. 마이그레이션이 적용되기 전에 뜬 서버에는 `stock_alert_delivery`가 없어 알람 클레임이 던지는데, 클레임은 try 밖이라 그 뒤의 루프가 돌지 않는다. 마지막이면 막히는 것이 알람뿐이다.

### 알람 메시지의 양식

템플릿은 `src/slack/templates/stock-alert.ts`이고 key는 `stock_alert`, version은 2다.

```
재고 알람 · 조리 필요 9건

조리 필요
재료       │ 부족 시작      │ 재고 │ 7일 부족
🚨 두부    │ 10-07 수 · 내일 │    0 │        2
오트밀     │ 10-08 목 · D-2 │    4 │       12
흰살생선   │ 10-08 목 · D-2 │    0 │        2
쌀         │ 10-09 금 · D-3 │    6 │       10

임계개수 이하 · 7일 안에는 부족 없음
재료       │ 부족 시작 │ 재고
양파       │ 10-14 수  │    0
무         │ 10-16 금  │    0
시금치     │ 10-19 월  │    4
```

예시는 2026-10-06의 항목에서 표마다 몇 행만 옮기고, 그날 없던 `urgent` 행을 하나 더한 것이다.

- 머리의 "조리 필요 N건"은 `urgent`와 `upcoming`의 수다. 둘 다 없고 `low_stock`만 있으면 "재고 알람 · 임계개수 이하 N건"이다.
- `urgent`와 `upcoming`은 `조리 필요` 표 한 장에 재료마다 한 행이다. 열은 재료, 부족 시작, 재고, 7일 안의 부족 수량이다. 행 순서는 애플리케이션이 준 첫 부족일 순서 그대로라 `urgent`가 위에 오고, `urgent` 행은 재료 이름 앞에 `🚨`를 붙인다. `raw_text` 셀에는 굵게가 없어서 기호로 표시한다(ADR 0009의 `⏰`와 같다).
- 부족 시작 칸은 `MM-DD 요일 · 남은 날`이다. 남은 날은 `지남`, `오늘`, `내일`, `D-n` 중 하나다.
- `low_stock`은 둘째 표이고 열은 재료, 부족 시작, 재고다. 부족 시작일이 없는 재료는 그 칸이 `–`다.
- 항목이 없는 묶음은 제목도 표도 없다. 표가 100행이나 1만 자를 넘으면 뒤쪽 행을 버리고 버린 수를 표 아래에 적는다(ADR 0007의 재고 표와 같은 규칙).
- `text`는 첫 항목으로 만든 한 줄이다. 예: `재고 알람: 두부 내일부터 부족 외 9건`.
- 버튼은 없다. 조리해 입고를 등록하면 다음 알람에서 빠진다.

~~`urgent`와 `upcoming`은 `오늘·내일 부족`, `7일 안에 부족` 두 묶음의 글머리 줄(`• 오트밀  재고 4개 · 10-08부터(D-3) · 7일 안에 10개 부족`)이고, `low_stock`은 한 줄에 쉼표로 잇는다.~~ 2026-10-06에 version 2로 바꿨다. 그날 알람은 글머리 9줄과 쉼표로 이은 12개 재료였고, 사용자가 Claude Code 대화에서 말했다.

> 이런 나열식 텍스트 줄줄이로 파악이 도저히 안돼.

글머리 줄은 재료마다 "재고", "부터", "7일 안에", "부족"이 되풀이되고 숫자의 자리가 이름 길이에 따라 달라져, 조리할 수량을 세로로 훑을 수 없었다. ADR 0007이 브리프의 재고 줄글을 표로 바꾼 것과 같은 이유다. 표는 칸 머리가 단위를 한 번만 말하고 숫자가 오른쪽 정렬로 한 줄에 선다.

묶음 둘을 표 하나로 합친 이유는 제목이 줄기 때문이다. 급한 정도는 행 순서, `🚨`, 부족 시작 칸의 `오늘`·`내일`이 이미 보인다. `low_stock`을 같은 표에 넣지 않은 이유는 열이 다르기 때문이다. `low_stock`은 7일 안의 부족 수량이 언제나 0이라 그 칸이 뜻이 없고, 조리할 재료와 미리 알아 둘 재료가 한 표에 섞이면 조리 목록이 길어 보인다.

임계일은 싣지 않는다. ADR 0009의 임계일 결정은 바꾸지 않는다. 2026-09-29에 사용자가 "임계일 섹션은 필요 없어 보이고 재고 표에서 그냥 같이 보면 될 것 같아"와 "폐기 신경 쓰지 말라니까?"라고 정했고, 2026-10-05의 다섯 결정에 임계일은 없다. 임계 지남 배치가 남아 있는 동안 매일 푸시가 가는 것도 그 결정과 어긋난다.

### 재고 표는 부족 시작일 순이고 `소진 예상` 열이 `부족 시작` 열이 된다

브리프(`daily_brief`)와 상태판(`household_board`)의 템플릿 버전이 5가 된다.

- `BriefStockRow.firstShortageDate: LocalDate | null`을 더한다. 전체 식단 예측의 첫 부족일이다.
- `byUrgency`의 첫 기준을 `depletionDate`에서 `firstShortageDate`로 바꾼다. 나머지 기준(임계개수에 닿은 재료, 임계일이 임박하거나 지난 재료)은 그대로다.
- 표의 `소진 예상` 열을 `부족 시작` 열로 바꾼다.
- 표에서 빠져 한 줄로 가는 조건을 `total === 0 && thresholdCubes === null && firstShortageDate === null`로 바꾼다. 재고가 0이어도 식단에 있는 재료는 표에 남는다. 재고도 식단도 임계개수도 없는 재료만 `재고 0:` 줄로 간다.
- 부족 수량은 브리프와 상태판에 싣지 않는다. 날짜는 `부족 시작` 열이, 수량은 재고 알람이 보인다.

ADR 0007은 "재료가 언제 떨어지는지는 `소진 예상` 열이 이미 보여 주고, 부족 시작일은 대개 그 다음 날"이라는 이유로 `소진 예상`을 골랐다. 그 열 선택을 뒤집는다. 이유는 셋이다.

첫째, 재고가 0인 재료는 `depletionDate`가 null이다. `forecastShortage`(`src/domain/forecast/shortage-forecast.ts`)는 할당에 성공했을 때만 그 날짜를 채운다. 그래서 재고 0 행은 정렬에서 맨 뒤로 가고 칸도 비었다.

둘째, 부모가 움직여야 하는 날은 마지막 큐브를 쓰는 날이 아니라 큐브가 모자라는 첫날이다.

셋째, 정렬 기준과 보이는 값이 같아야 재고 0 행이 위에 있는 이유를 읽을 수 있다.

`depletionDate`는 읽기 모델과 MCP에 그대로 남는다.

## 층별 결합

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

도메인은 바뀌지 않는다. 7일 창은 `forecastShortage`가 이미 받는 `until` 인자이고 임계개수 판정은 기존 `isAtOrBelowThreshold`다. 동결된 `src/domain`을 열지 않는다.

애플리케이션은 읽기 모델 필드 둘(`stockAlert`, `firstShortageDate`), 상수 둘, 포트 메서드 둘을 더한다. 무엇이 알람 항목이고 얼마나 급한지는 `buildDailyBrief` 한 곳이 정한다. `BriefDispatchService`는 항목이 0건인지만 보고 보낼지 `skipped`로 끝낼지를 정하며, 전달 수단이 Slack인지는 여전히 모른다.

영속화는 테이블 하나를 더한다. `PrismaBriefDeliveryLog`가 `brief_delivery`와 같은 클레임 질의를 새 테이블에 건다.

Slack 템플릿은 `DailyBrief`만 읽는다. `stock-alert.ts`는 `urgency`로 묶음을 나누고 `daysUntilShortage`와 `horizonShortfallCubes`를 표의 칸으로 옮길 뿐 날짜 차이나 임계개수 비교를 하지 않는다. 판정 기준이 바뀌면 애플리케이션 상수만 바뀐다.

MCP는 도구가 늘지 않는다. `get_daily_brief`의 출력에 `stockAlert`와 `stock[].firstShortageDate`가 붙는다.

## 대가와 남는 위험

- 임계개수가 없는 재료는 `low_stock`에 들지 않는다. 임계개수는 재료별 설정이라(기획안 6장) 새로 등록한 재료에는 없다. 그 재료가 식단에 들어가면 예측이 잡으므로 `urgent`와 `upcoming`에는 든다. 놓치는 것은 "부족이 7일보다 먼데 재고가 적다"는 이른 예고뿐이다.
- `slack_template_key` enum에 더한 `stock_alert` 값은 Postgres에서 지울 수 없다. 테이블은 drop으로 되돌릴 수 있다.
- 마이그레이션 전에 배포된 서버에서는 알람 클레임이 매분 던진다. 브리프와 후속 메시지는 앞에서 이미 돌았으므로 막히지 않지만 로그에 오류가 매분 쌓인다(`docs/user-intervention.md` 11번).
- 07:30에 푸시가 두 번 온다.
- 알람 메시지에 표가 둘이다. 표 둘을 가진 메시지는 2026-09-26에 `ok: true`였지만(ADR 0007) 모바일 앱에서 4열 표와 3열 표가 어떻게 그려지는지는 이 양식으로 보낸 뒤 사람이 확인한다.
- 임계개수 이하 표는 재료마다 한 행이라 쉼표 한 줄보다 길다. 28개 재료 전부에 임계개수 4가 걸려 있는 동안은 재고 0인 미도입 재료가 그 표에 열 행 넘게 남는다.
- 같은 알람이 해결될 때까지 매일 온다. 식단이 재고보다 한참 앞서 있는 기간에는 매일 열 줄 안팎이다.
- 브리프 조립(`DailyBriefService.get`)이 가정마다 하루 한 번 더 돈다.
- 낮에 재고가 0이 되어도 다음 날 아침까지 알람이 없다.
