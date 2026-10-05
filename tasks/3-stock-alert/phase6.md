# Phase 6: mcp

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md` (`src/mcp`는 어댑터다. 재고 규칙을 다시 구현하지 않고 애플리케이션 서비스를 호출한다)
- `tasks/3-stock-alert/docs-diff.md`
- `docs/adr/0010-stock-alert-message.md`의 (b) (`DailyBrief.stockAlert`의 모양과 MCP가 같은 값을 돌려주는 근거)
- `docs/product-plan.md` 3장 ("브리프 내용은 MCP 도구로도 같은 것을 조회할 수 있다")
- `src/mcp/tools/alert.tools.ts`의 `get_daily_brief` (읽기 모델의 필드를 하나씩 옮기고 재료 id 대신 이름을 싣는다)
- `src/application/daily-brief.ts`의 `BriefStockAlert`, `BriefStockAlertItem`, `BriefStockRow.firstShortageDate`
- `test/integration/mcp-tools.int-spec.ts`의 `get_daily_brief`를 부르는 테스트들 (`call`, `nextKey`, `seedMasters`, `rows` 헬퍼. 특히 "브리프에 상비 재료 목록과 재고 표의 임계일이 실린다")

시작하기 전에 `pnpm prisma:generate`를 돌려라.

## 작업 내용

`get_daily_brief`가 phase 3의 새 필드를 돌려주게 한다. 도구는 늘지 않는다. 이 도구는 읽기 모델을 통째로 넘기지 않고 필드를 하나씩 옮기므로, 옮기지 않으면 `stockAlert`가 조용히 빠진다.

### 1. `src/mcp/tools/alert.tools.ts`

`get_daily_brief`의 반환값을 고친다.

- `stock` 행에 `firstShortageDate: row.firstShortageDate`를 `depletionDate` 뒤에 더한다.
- `expiryAlerts` 뒤에 `stockAlert`를 더한다. 다른 필드와 같이 `ingredientId`는 싣지 않고 `name`을 `ingredientName`으로 싣는다.

```ts
stockAlert: {
  horizonDays: brief.stockAlert.horizonDays,
  items: brief.stockAlert.items.map((item) => ({
    ingredientName: item.name,
    total: item.total,
    thresholdCubes: item.thresholdCubes,
    firstShortageDate: item.firstShortageDate,
    daysUntilShortage: item.daysUntilShortage,
    horizonShortfallCubes: item.horizonShortfallCubes,
    urgency: item.urgency,
  })),
},
```

도구 설명(`description`)을 고친다. 에이전트가 이 문장을 보고 도구를 고르므로 새 필드가 무엇인지 드러나야 한다. "재고현황과 소진 예상일, 부족 예측" 부분을 "재고현황과 소진 예상일·부족 시작일, 부족 예측, 재고 알람(7일 안에 부족해지거나 임계개수 이하인 재료와 남은 일수)"으로 바꾼다. 나머지 문장은 그대로 둔다.

`src/mcp/server.factory.ts`나 다른 곳에 `get_daily_brief`의 출력을 설명하는 문구가 있으면 같은 뜻으로 맞춘다. 없으면 건드리지 않는다.

### 2. `test/integration/mcp-tools.int-spec.ts`

`get_daily_brief` 테스트 묶음에 둘을 더한다.

- 브리프에 재고 알람이 재료 이름으로 실린다
  - 식단을 넣고(`import_meal_plan`) 그 식단의 재료 하나는 입고를 넣지 않는다. `brief.stockAlert.horizonDays`가 7이고, `items`에 그 재료가 `ingredientName`으로 있으며 `urgency`가 `urgent`나 `upcoming`이고 `firstShortageDate`, `daysUntilShortage`, `horizonShortfallCubes`가 채워져 있는지 본다. `items`의 어느 항목에도 `ingredientId`가 없는지 본다.
- 브리프의 재고 행에 부족 시작일이 실린다
  - 재고가 0이고 식단에 있는 재료의 `stock` 행이 `firstShortageDate`를 갖고 `depletionDate`는 null인지 본다.

임계개수로 `low_stock`이 되는 경우를 하나 더 보고 싶으면 `update_alert_settings`로 임계개수를 넣어 같은 테스트 안에서 확인한다. 기존 테스트의 기대값이 새 필드 때문에 깨지면(`toEqual`로 `stock` 행 전체를 비교하는 곳) 새 필드를 기대값에 더한다. 기존 테스트를 지우지 않는다.

## Acceptance Criteria

```bash
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
grep -q 'stockAlert' src/mcp/tools/alert.tools.ts
grep -q 'horizonShortfallCubes' src/mcp/tools/alert.tools.ts
grep -q 'firstShortageDate: row.firstShortageDate' src/mcp/tools/alert.tools.ts
grep -q '재고 알람' src/mcp/tools/alert.tools.ts
grep -q '브리프에 재고 알람이 재료 이름으로 실린다' test/integration/mcp-tools.int-spec.ts
! rg -n 'forecastShortage|summarizeStock|isAtOrBelowThreshold|daysBetween|STOCK_ALERT_HORIZON_DAYS' src/mcp
git diff --quiet HEAD -- src/application src/slack src/infrastructure src/domain src/scheduler prisma docs README.md
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `pnpm test:int`는 Docker가 필요하다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- 새 도구를 만들지 마라(`get_stock_alert` 같은 것). 이유: 기획 7장의 도구 표를 늘리지 않는다. 재고 알람은 브리프의 일부다(ADR 0010 (b)).
- MCP 계층에서 알람 항목을 다시 계산하거나 거르지 마라. 이유: 어댑터는 재고 규칙을 다시 쓰지 않는다. `brief.stockAlert`를 옮기기만 한다.
- `depletionDate`, `shortages`, `thresholdAlerts`를 출력에서 빼지 마라. 이유: 소비자(Claude Code)가 쓰고 있고 ADR 0010이 읽기 모델과 MCP에 그대로 남긴다고 정했다.
- `get_stock_status`와 `forecast_shortage`의 출력을 고치지 마라. 이유: 이 task의 범위가 아니다.
- 출력에 재료 id를 싣지 마라. 이유: 이 도구의 다른 필드가 전부 이름을 싣는다.
- `src/application`, `src/slack`을 고치지 마라. 이유: scope 밖이고 앞 phase가 끝냈다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
