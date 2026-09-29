# Phase 5: mcp

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md` (`src/mcp`는 어댑터다. 재고 규칙을 다시 구현하지 않고 애플리케이션 서비스를 부른다)
- `tasks/2-pantry-and-expiry/docs-diff.md`
- `docs/adr/0009-pantry-ingredients-and-expiry-notice.md`의 (c), (f)와 대가 절
- `docs/product-plan.md` 7장 (도구는 부모의 의도 단위이고, 재고나 식단을 바꾸는 도구는 모두 멱등키를 받는다)
- `docs/adr/0004-mcp-server-and-auth.md`의 도구 어댑터 절 (도구가 하는 일은 호출자 확인, 멱등키 전달, 오류를 `isError`로 바꾸기, id를 이름으로 바꾸기 넷이다)
- `src/mcp/tools/ingredient.tools.ts` 전체 (`update_ingredient_serving_weight`가 새 도구의 본보기)
- `src/mcp/tools/schemas.ts` (`idempotencyKey`, `ingredientCategory` 같은 공용 스키마)
- `src/mcp/tools/stock.tools.ts`의 `get_stock_status`, `src/mcp/tools/alert.tools.ts`의 `get_daily_brief`, `src/mcp/tools/reaction.tools.ts`의 `get_ingredient_introduction_status`
- `src/application/ingredient.service.ts`의 `UpdateStockTrackingCommand` (phase 4가 만든 것)
- `src/application/daily-brief.ts`의 `BriefStockRow.nextExpiry`, `DailyBrief.pantryIngredients`
- `test/integration/mcp-tools.int-spec.ts` (도구 왕복 테스트의 본보기. 도구를 실제로 부르고 `isError`와 본문을 확인하는 방식)

## 작업 내용

### 1. `update_ingredient_stock_tracking` 도구

`src/mcp/tools/ingredient.tools.ts`에 `update_ingredient_serving_weight` 뒤에 더한다.

- title: `재고 방식 변경`
- description: `큐브로 만들지 않고 늘 집에 있는 재료(땅콩버터, 계란, 밀가루)를 상비(pantry)로 바꾼다. 상비 재료는 자동 차감, 보류, 부족 예측, 재고 표에서 빠지고 도입 상태만 남는다. 잔여 큐브가 있으면 바꿀 수 없으니 먼저 실사 조정이나 폐기로 0을 만든다. cubes로 되돌리는 데는 조건이 없다.`
- inputSchema: `idempotencyKey`, `name: z.string().describe('기존 재료의 이름 또는 별칭.')`, `stockTracking: z.enum(['cubes', 'pantry'])`
- 본문: `deps.ingredient.updateStockTracking({ ...caller, ...args })`. 결과는 `{ ingredientName, stockTracking }`.

`z.enum(['cubes', 'pantry'])`는 `schemas.ts`에 `stockTracking`으로 두어 다른 도구가 재사용하게 한다(`ingredientCategory`와 같은 방식).

### 2. 출력 변경

- `get_stock_status`(`stock.tools.ts`): 재료 항목의 `overdue`는 phase 2가 바꿨다. description을 `재료별 합계와 배치 내역, 임계일 알람 대상을 돌려준다. 임계일이 지난 큐브도 합계에 든다. 상비 재료는 나오지 않는다.`로 고친다. "폐기 대기"라는 말을 없앤다.
- `get_daily_brief`(`alert.tools.ts`): `stock` 항목에 `nextExpiry: row.nextExpiry`를 더하고, 최상위에 `pantryIngredients: brief.pantryIngredients.map(entry => ({ ingredientName: entry.name }))`를 더한다. description의 "임계개수와 임계일 알람"은 그대로 두되 "상비 재료 목록"을 더한다.
- `get_ingredient_introduction_status`(`reaction.tools.ts`): 항목에 `stockTracking: entry.stockTracking`을 더한다. description에 "재고 방식(cubes, pantry)도 함께 준다"를 더한다.
- `forecast_shortage`는 바꾸지 않는다. 상비 재료는 도메인이 결과에서 뺐다.

### 3. 통합 테스트

`test/integration/mcp-tools.int-spec.ts`에 더한다.

- 재고 방식 변경 도구로 상비로 바꾸면 도입 상태 조회에 pantry로 보이고 재고 현황에서 사라진다
- 잔여 큐브가 있는 재료를 상비로 바꾸면 isError이고 오류 코드가 PANTRY_WITH_STOCK이다
- 상비 재료의 입고는 isError이고 오류 코드가 PANTRY_INGREDIENT이다
- 같은 멱등키로 재고 방식 변경을 두 번 부르면 응답이 같다
- 브리프에 상비 재료 목록과 재고 표의 임계일이 실린다

## Acceptance Criteria

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
grep -q "update_ingredient_stock_tracking" src/mcp/tools/ingredient.tools.ts
grep -A 8 "'update_ingredient_stock_tracking'" src/mcp/tools/ingredient.tools.ts | grep -q idempotencyKey
! grep -A 12 "'register_ingredient'" src/mcp/tools/ingredient.tools.ts | grep -q stockTracking
grep -q "stockTracking" src/mcp/tools/schemas.ts
grep -q "nextExpiry" src/mcp/tools/alert.tools.ts
grep -q "pantryIngredients" src/mcp/tools/alert.tools.ts
grep -q "stockTracking" src/mcp/tools/reaction.tools.ts
! rg -n "폐기 대기|폐기대기" src/mcp
! rg -n "summarizeStock|forecastShortage|reconcileMeals|allocateOldestFirst" src/mcp
grep -q "update_ingredient_stock_tracking" test/integration/mcp-tools.int-spec.ts
grep -q "PANTRY_WITH_STOCK" test/integration/mcp-tools.int-spec.ts
grep -q "PANTRY_INGREDIENT" test/integration/mcp-tools.int-spec.ts
git diff --quiet HEAD -- src/domain src/application src/infrastructure src/slack src/scheduler prisma docs README.md
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `pnpm test:int`는 Docker가 필요하다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- `register_ingredient`에 `stockTracking` 인자를 더하지 마라. 이유: 새 재료는 큐브 추적으로 시작하고 상비 전환은 별도 도구로 한다는 규칙이며, 선택 인자와 기본값을 두지 않기 위해서다(ADR 0009 (c)).
- 새 도구에서 `idempotencyKey`를 빼지 마라. 이유: 기획 7장 "재고나 식단을 바꾸는 도구는 모두 멱등키를 받는다".
- 도구 안에서 잔여 큐브나 상비 여부를 판단하지 마라. 이유: 어댑터는 재고 규칙을 다시 쓰지 않는다. 서비스가 던진 오류를 `toolResult`가 `isError`로 바꾼다.
- `src/application`을 고치지 마라. 이유: phase 4가 끝냈고 scope 밖이다. 필요한 필드가 없으면 phase 4의 산출을 다시 읽어라.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
