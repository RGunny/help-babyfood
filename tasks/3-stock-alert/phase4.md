# Phase 4: slack

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md` (`src/slack`은 어댑터다. 재고 규칙을 다시 구현하지 않는다)
- `tasks/3-stock-alert/docs-diff.md`
- `docs/adr/0010-stock-alert-message.md`의 (e)(알람 메시지 양식)와 (f)(재고 표)
- `docs/adr/0007-slack-message-templates.md` (템플릿 규약. `version`은 레이아웃이 바뀔 때 올리고 스냅숏 파일 이름이 그 버전을 담는다. 표 셀은 전부 `raw_text`다. 블록 50개, section 3000자 한도)
- `docs/adr/0008-slack-canvas-board.md` (캔버스 마크다운 제약, 표 하나 300셀)
- `src/application/daily-brief.ts`의 `BriefStockAlert`, `BriefStockAlertItem`, `BriefStockRow.firstShortageDate` (phase 3이 더했다)
- `src/application/ports/brief-delivery.port.ts`의 `StockAlertMessage`
- `src/slack/templates/message-template.ts` (`TemplateKey`, `MessageTemplate`)
- `src/slack/templates/blocks.ts` (`header`, `section`, `linesSection`, `context`, `escape`, `truncate`, `MAX_BLOCKS`, `MAX_SECTION_TEXT`)
- `src/slack/templates/reaction-prompt.ts`와 `reaction-prompt.spec.ts` (작은 템플릿과 그 테스트의 본보기)
- `src/slack/templates/brief-lines.ts` (`stockRowsOf`, `isEmpty`, `byUrgency`)
- `src/slack/templates/daily-brief.ts` (`STOCK_COLUMNS`, 머리 주석, `stockBlocks`)
- `src/slack/templates/household-board.ts` (`STOCK_HEADER`, `stockRow`)
- `src/slack/templates/labels.ts` (`shortDate`)
- `src/slack/templates/daily-brief.spec.ts`, `household-board.spec.ts`와 `src/slack/templates/__snapshots__/` (스냅숏은 `toMatchFileSnapshot`으로 파일에 고정되고 버전이 파일 이름에 있다)
- `src/slack/outbound/slack-brief-delivery.ts` (`post()`가 템플릿을 받아 보내고 스냅숏을 남긴다)
- `src/slack/outbound/slack-message-log.ts` (`templateKey`를 Prisma enum으로 넘기는 곳)
- `src/scripts/preview-slack.ts` (`TEMPLATES`, `selectedTemplates`, 템플릿별 렌더 갈래, `USAGE`)
- `test/integration/slack-delivery.int-spec.ts` (가짜 Slack 서버, "보낸 브리프는 … slack_message에 남는다", "후속 메시지는 reaction_prompt로 남는다")

시작하기 전에 `pnpm prisma:generate`를 돌려라. `SlackTemplateKey`의 `stock_alert`가 생성된 클라이언트에 있어야 한다.

## 작업 내용

재고 알람 템플릿을 더하고, 브리프와 상태판의 재고 표를 부족 시작일 기준으로 바꾼다. 애플리케이션과 도메인은 건드리지 않는다.

### 1. 재고 알람 템플릿 (`src/slack/templates/stock-alert.ts`, `stock_alert` v1)

`message-template.ts`의 `TemplateKey`에 `'stock_alert'`를 더한다.

```ts
export const stockAlertTemplate: MessageTemplate<StockAlertMessage> = {
  key: 'stock_alert',
  version: 1,
  render(message) { … },
};
```

블록 구성(위에서 아래로):

1. `header`: `urgent`와 `upcoming`이 하나라도 있으면 `재고 알람 · 조리 필요 N건`(N은 둘의 합). 둘 다 없으면 `재고 알람 · 임계개수 이하 N건`(N은 `low_stock`의 수).
2. `urgent`가 있으면 `linesSection('오늘·내일 부족', lines)`.
3. `upcoming`이 있으면 ``linesSection(`${horizonDays}일 안에 부족`, lines)``.
4. `low_stock`이 있으면 `section`: 첫 줄 `*임계개수 이하*`, 둘째 줄에 항목을 쉼표로 이은 한 줄. `MAX_SECTION_TEXT`로 자른다(`section`이 자른다).
5. 맨 끝에 `context('조리해 입고를 등록하면 다음 알람에서 빠집니다.')`.

`urgent`와 `upcoming`의 한 줄: `• {이름}  재고 {total}개 · {언제} · {horizonDays}일 안에 {horizonShortfallCubes}개 부족`

`{언제}`는 `daysUntilShortage`로 고른다. 템플릿은 이 값을 읽기만 하고 날짜를 빼지 않는다.

| `daysUntilShortage` | 문구 |
|---|---|
| 0보다 작다 | `{MM-DD}부터 이미 부족` |
| 0 | `오늘부터 부족` |
| 1 | `내일({MM-DD})부터 부족` |
| 2 이상 | `{MM-DD}부터(D-{n})` |

`low_stock`의 한 항목: 첫 부족일이 있으면 `{이름} {total}개({MM-DD}부터)`, 없으면 `{이름} {total}개`.

`text`(푸시 미리보기에 뜨는 한 줄): 첫 항목으로 만든다.

- 첫 항목이 `urgent`나 `upcoming`이면 `재고 알람: {이름} {짧은 언제}` 뒤에, 항목이 더 있으면 ` 외 {전체 항목 수 − 1}건`. 짧은 언제는 `이미 부족`, `오늘부터 부족`, `내일부터 부족`, `{MM-DD}부터 부족`이다.
- 전부 `low_stock`이면 `재고 알람: 임계개수 이하 {N}건`.

이름은 전부 `escape`를 거친다. `blocks`는 `MAX_BLOCKS`로 자른다. 버튼은 없다. 임계일은 읽지 않는다.

`stock-alert.spec.ts`를 쓴다(이름은 규칙을 한국어로 서술한다).

- 스냅숏: `__snapshots__/stock-alert.v1.json`. 픽스처에 `urgent` 하나(내일), `upcoming` 둘, `low_stock` 둘(첫 부족일이 있는 것과 없는 것)을 넣는다. 파일 이름의 버전은 `stockAlertTemplate.version`에서 읽는다(`daily-brief.spec.ts`가 하는 방식).
- 머리는 조리 필요 건수이고 임계개수 이하는 세지 않는다
- 조리가 필요한 재료가 없으면 머리가 임계개수 이하 건수다
- 오늘·내일 부족과 7일 안에 부족이 다른 묶음이고 항목이 없는 묶음은 블록이 없다
- 이미 지난 날, 오늘, 내일, 그 뒤가 각각 다른 문구다
- 임계개수 이하는 한 줄에 쉼표로 잇는다
- 알림에 뜨는 한 줄은 첫 항목과 나머지 건수다
- 재료 이름의 `&`, `<`, `>`는 이스케이프된다
- 항목이 아주 많아도 블록 한도와 section 길이 한도를 넘지 않는다

### 2. 공유 행 (`brief-lines.ts`)

- `stockRowsOf`의 `isEmpty`를 `row.total === 0 && row.thresholdCubes === null && row.firstShortageDate === null`로 바꾼다. 재고가 0이어도 식단에 있는 재료는 표에 남는다. `StockRows.empty`의 주석을 그 뜻으로 고친다.
- `byUrgency`의 첫 기준을 `depletionDate`에서 `firstShortageDate`로 바꾼다(null이 뒤). 둘째(임계개수에 닿은 재료)와 셋째(임계일이 임박하거나 지난 재료) 기준은 그대로다. 주석의 "Soonest to run out first"를 첫 부족일 기준으로 고친다.

### 3. 브리프 (`daily-brief.ts`, `daily_brief` v5)

- `STOCK_COLUMNS`의 `소진 예상` 열을 `부족 시작` 열로 바꾼다: `{ header: '부족 시작', align: 'center', cell: (row) => (row.firstShortageDate === null ? null : shortDate(row.firstShortageDate)) }`. 열 순서는 `재료 | 합계 | 가용 | 임계 지남 | 임계일 | 부족 시작 | 임계`.
- `dailyBriefTemplate`의 머리 주석에서 "the shortage forecast is left to MCP, since the depletion date already says when an ingredient runs out (ADR 0007)"을 고친다: 표는 첫 부족일을 보이고, 7일 안의 수량은 재고 알람 메시지가 싣는다(ADR 0010).
- `version: 5`.

### 4. 상태판 (`household-board.ts`, `household_board` v5)

- `STOCK_HEADER`: `['재료', '합계', '가용', '임계 지남', '임계일', '부족 시작', '임계']`.
- `stockRow`의 여섯째 칸: `row.firstShortageDate === null ? '–' : shortDate(row.firstShortageDate)`.
- `version: 5`.

### 5. 스냅숏과 테스트

- `__snapshots__/daily-brief.v4.json`과 `household-board.v4.md`를 지우고 v5 파일을 만든다. 스냅숏 테스트가 파일 이름을 템플릿 버전에서 읽으면 버전만 올리고 `pnpm vitest run --project unit src/slack/templates -u`로 v5 파일을 쓴다. 쓴 뒤 두 파일을 열어 `부족 시작` 열이 있고 `소진 예상`이 없는지 확인하라.
- 스냅숏 픽스처에 "재고 0인데 `firstShortageDate`가 있는 재료" 한 행을 더해 표 맨 위에 오는 것이 스냅숏에 보이게 한다.
- `daily-brief.spec.ts`(templates)의 기존 테스트를 새 규칙에 맞춘다.
  - 열 머리 기대값의 `'소진 예상'`을 `'부족 시작'`으로.
  - "소진 예상일은 MM-DD로 줄이고 …"는 "부족 시작일은 MM-DD로 줄이고 임계개수에 닿은 재료는 임계 칸에 그 개수를 적는다"로, 픽스처는 `firstShortageDate`로.
  - "소진 예상일이 빠른 재료, 임계개수에 닿은 재료, … 순이다"는 이름을 "재고 표는 부족 시작일이 이른 순이다"로 바꾸고(phase 7이 이 이름으로 지목한다) 픽스처를 `firstShortageDate`로 바꾼다. 둘째·셋째 기준의 단언은 유지한다. 이 테스트에 "`depletionDate`만 있고 `firstShortageDate`가 없는 행은 `firstShortageDate`가 있는 행보다 뒤다"가 드러나는 행을 하나 넣어라. `byUrgency`를 `depletionDate` 기준으로 되돌리면 실패해야 한다.
  - "부족 예측은 브리프에 싣지 않는다. 소진 예상 칸이 대신하고 수량은 MCP가 답한다"는 `not.toContain('부족')` 단언이 새 열 이름과 부딪친다. "부족 수량은 브리프에 싣지 않는다. 부족 시작 칸이 날짜를 보이고 수량은 재고 알람이 싣는다"로 바꾸고, 단언은 `shortages`의 수량 문구(예: `shortfallCubes` 값이 든 줄, `부족 예측`이라는 섹션 제목)가 없다는 것으로 좁힌다.
- 테스트를 더한다.
  - `daily-brief.spec.ts`: 재고가 0이어도 식단에 있는 재료는 표에 남는다 / 재고도 식단도 임계개수도 없는 재료만 재고 0 줄로 간다
  - `household-board.spec.ts`: 재고 표는 부족 시작일이 이른 순이고 여섯째 칸이 부족 시작일이다 / 재고가 0이어도 식단에 있는 재료는 표에 남는다

### 6. 발송 어댑터 (`slack-brief-delivery.ts`)

```ts
async deliverStockAlert(householdId: string, message: StockAlertMessage): Promise<DeliveryResult> {
  return await this.post(householdId, stockAlertTemplate, message);
}
```

`BriefDeliveryPort`에는 아직 이 메서드가 없다(phase 5가 올린다). 클래스가 인터페이스보다 메서드를 더 갖는 것은 `implements`를 어기지 않는다. `slack-message-log.ts`가 `templateKey`를 Prisma enum으로 넘기는 데 손볼 곳이 있으면(타입 단언, 매핑 표) 거기에 `stock_alert`를 더한다.

### 7. 미리보기 (`src/scripts/preview-slack.ts`)

`TEMPLATES`에 `'stock_alert'`를 더하고, 렌더 갈래에서 `stockAlertTemplate.render({ date: brief.date, alert: brief.stockAlert })`를 쓴다. `USAGE`의 `--template` 설명에 `stock_alert`를 더한다. 항목이 0건인 날에도 미리보기는 렌더한 것을 그대로 보낸다(미리보기는 발송 판정을 하지 않는다. 판정은 phase 5의 `BriefDispatchService`가 한다).

### 8. 통합 테스트 (`test/integration/slack-delivery.int-spec.ts`)

기존 테스트의 방식대로 둘을 더한다.

- 재고 알람도 같은 경로로 chat.postMessage에 간다
- 재고 알람은 stock_alert로 남는다 (`slack_message`의 `template_key`가 `stock_alert`, `template_version`이 `stockAlertTemplate.version`, `payload`가 보낸 그대로)

`delivery.deliverStockAlert(householdId, { date, alert })`를 직접 부른다. 알람 픽스처는 항목 하나면 된다.

## Acceptance Criteria

```bash
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
grep -q "key: 'stock_alert'" src/slack/templates/stock-alert.ts
grep -q "'stock_alert'" src/slack/templates/message-template.ts
grep -q 'deliverStockAlert' src/slack/outbound/slack-brief-delivery.ts
grep -q 'stock_alert' src/scripts/preview-slack.ts
grep -q 'version: 5' src/slack/templates/daily-brief.ts
grep -q 'version: 5' src/slack/templates/household-board.ts
test -f src/slack/templates/__snapshots__/stock-alert.v1.json
test -f src/slack/templates/__snapshots__/daily-brief.v5.json
test -f src/slack/templates/__snapshots__/household-board.v5.md
! test -f src/slack/templates/__snapshots__/daily-brief.v4.json
! test -f src/slack/templates/__snapshots__/household-board.v4.md
grep -q '부족 시작' src/slack/templates/__snapshots__/daily-brief.v5.json
grep -q '부족 시작' src/slack/templates/__snapshots__/household-board.v5.md
! grep -q '소진 예상' src/slack/templates/__snapshots__/daily-brief.v5.json
! grep -q '소진 예상' src/slack/templates/__snapshots__/household-board.v5.md
grep -q '재고 표는 부족 시작일이 이른 순이다' src/slack/templates/daily-brief.spec.ts
grep -q '재고 알람은 stock_alert로 남는다' test/integration/slack-delivery.int-spec.ts
! grep -q 'expiryAlerts' src/slack/templates/stock-alert.ts
! rg -n 'forecastShortage|summarizeStock|isAtOrBelowThreshold|daysBetween|addDays|STOCK_ALERT_HORIZON_DAYS|STOCK_ALERT_URGENT_DAYS' src/slack --glob '!*.spec.ts'
git diff --quiet HEAD -- src/application src/domain src/infrastructure src/mcp src/scheduler prisma docs README.md
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `pnpm test:int`는 Docker가 필요하다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- 템플릿에서 남은 일수나 긴급도를 계산하지 마라. 이유: `daysUntilShortage`와 `urgency`가 애플리케이션이 계산한 값이다. 어댑터는 재고 규칙을 다시 쓰지 않는다. AC가 `daysBetween`, `addDays`와 두 상수가 `src/slack`에 없는지 본다.
- 알람 템플릿에 임계일을 넣지 마라. `expiryAlerts`를 읽지 마라. 이유: ADR 0010 (e). ADR 0009의 임계일 결정은 바꾸지 않는다. tech-critic-lead의 승인 조건이다.
- 알람 메시지에 버튼을 달지 마라. 이유: 누를 행위가 없다. 조리는 입고 등록으로 기록한다.
- "0건이면 보내지 않는다"를 어댑터나 템플릿에 넣지 마라. 이유: 발송 판정은 애플리케이션의 일이고 phase 5가 한다.
- `DailyBrief.depletionDate`를 템플릿에서 읽는 다른 용도를 만들지 마라. 이유: 표의 열과 정렬은 `firstShortageDate`로 통일한다(ADR 0010 (f)).
- 브리프나 상태판에 부족 수량을 싣지 마라. 이유: 수량은 재고 알람이 싣는다. ADR 0007이 줄글이 길어지는 것을 이유로 뺐다.
- 버전을 올리지 않은 채 스냅숏을 바꾸지 마라. v4 스냅숏 파일을 남기지 마라. 이유: ADR 0007. 어느 양식으로 보내는지 파일 이름이 말한다.
- 강조 기호 `⏰`와 폐기 버튼을 건드리지 마라. 이유: ADR 0009의 결정이고 이 task의 범위가 아니다.
- `src/application`이나 `src/domain`을 고치지 마라. 이유: scope 밖이고 앞 phase가 끝냈다. 포트 인터페이스에 `deliverStockAlert`를 올리는 것은 phase 5다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
