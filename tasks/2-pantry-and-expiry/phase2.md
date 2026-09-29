# Phase 2: domain

## 이 phase는 동결 경로 `src/domain/`을 연다

이유: `reconcileMeals`는 `input.catalog.getById(need.ingredientId)`(`src/domain/deduction/reconcile.ts`)로 카탈로그 전체를 요구해 호출자가 상비 재료를 빼서 넘길 수 없고, 상비 제외를 호출자에서 하면 재고 현황·예측·정합화 세 호출자가 같은 규칙을 세 번 쓴다. 임계일 3일 전 단계도 규칙이라 도메인에 둔다(ADR 0009 (b), (e)). tech-critic-lead가 2026-09-29에 승인했다.

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md`
- `tasks/2-pantry-and-expiry/docs-diff.md`
- `docs/adr/0009-pantry-ingredients-and-expiry-notice.md` 전체. 이 phase는 (a), (b), (e), (f)를 구현한다
- `docs/product-plan.md` 4.4절과 4.5절 (phase 0이 고친 뒤의 규칙)
- `src/domain/ingredient/ingredient.ts`, `src/domain/ingredient/ingredient-catalog.ts`
- `src/domain/stock/expiry.ts`, `src/domain/stock/stock-summary.ts`, `src/domain/stock/allocation.ts`, `src/domain/stock/ledger.ts`
- `src/domain/deduction/reconcile.ts` 전체. 특히 되돌림 루프("Release first")와 `targetOf`, `held`에 넣는 분기
- `src/domain/forecast/shortage-forecast.ts`
- `src/domain/stock/stock.spec.ts`, `src/domain/deduction/deduction.spec.ts`, `src/domain/forecast/shortage-forecast.spec.ts` (테스트 이름은 규칙을 한국어로 서술한다. 픽스처 만드는 방식을 따른다)
- `src/slack/templates/labels.ts`의 `stageLabel` (exhaustive switch. kind가 바뀌면 컴파일이 깨진다)
- `src/infrastructure/prisma/mappers/state.mapper.ts`의 `IngredientRow`와 `toIngredient` (행 타입을 `Ingredient['category']`처럼 도메인 타입에서 끌어오는 관례)

## 작업 내용

### 1. 도메인 변경

**`src/domain/ingredient/ingredient.ts`**

```ts
/** How stock of the ingredient is counted. Pantry ingredients are never cooked into cubes. */
export type StockTracking = 'cubes' | 'pantry';

export interface Ingredient {
  // ... 기존 필드
  /**
   * `pantry` ingredients (peanut butter, egg, flour) are always at hand, so meals never deduct
   * them, nothing is held for them, and they appear in no stock table or forecast.
   */
  readonly stockTracking: StockTracking;
}
```

필수 필드다. 선택(`?`)으로 두지 마라.

**`src/domain/stock/expiry.ts`**

```ts
export const DEFAULT_SHELF_LIFE_DAYS = 14;
/** Days before the expiry date from which a batch is called due soon and its row is highlighted. */
export const EXPIRY_NOTICE_DAYS = 3;

export type ExpiryStage =
  | { readonly kind: 'fresh' }
  /** Within EXPIRY_NOTICE_DAYS of the expiry date, the date itself included (daysLeft 3..0). */
  | { readonly kind: 'due_soon'; readonly daysLeft: number }
  /** Past the expiry date. Still stock: parents keep it until they report a discard. */
  | { readonly kind: 'overdue'; readonly overdueDays: number };
```

`expiryStageOn`: `daysLeft > EXPIRY_NOTICE_DAYS`면 `fresh`, `0 <= daysLeft <= EXPIRY_NOTICE_DAYS`면 `due_soon`, 음수면 `overdue`. `expiryDateOf`는 그대로.

**`src/domain/stock/stock-summary.ts`**

- `IngredientStock.pendingDiscard`를 `overdue`로 바꾼다. 주석도 "임계 지남"의 뜻으로 고친다. `fresh`는 `total - overdue` 그대로다(임박 배치는 `fresh`에 든다).
- `summarizeStock`은 `ingredients` 중 `stockTracking === 'cubes'`인 재료만 결과에 넣는다. 상비 재료는 행이 없다.
- `batchesNeedingExpiryAlert`(fresh가 아닌 배치)와 `isAtOrBelowThreshold`는 그대로.

**`src/domain/deduction/reconcile.ts`**

상비 재료는 원장과 무관하다. 두 곳을 고친다.

- `targetOf`: `expandToCubeNeeds` 결과에서 `input.catalog.getById(need.ingredientId).stockTracking === 'pantry'`인 필요량을 뺀다. 그래서 상비 재료는 차감되지 않고 `held`에도 들지 않는다.
- 되돌림 루프의 `consumedBatches`: 배치의 재료가 상비이면 뺀다. 큐브 추적일 때 소비된 이벤트가 남아 있는 재료를 상비로 바꿔도 `consumption_reverted`가 생기지 않는다.

`allocateOldestFirst`와 `isDeductibleFor`는 그대로다.

**`src/domain/forecast/shortage-forecast.ts`**

`ingredientById`와 `forecasts` 맵을 `stockTracking === 'cubes'`인 재료로만 만든다. 상비 재료의 필요량은 기존 `if (!ingredient || !forecast) continue;`로 지나가고 결과에 나오지 않는다.

### 2. 도메인 테스트

기존 spec 파일에 더한다. 이름은 규칙을 한국어로 서술한다.

`src/domain/stock/stock.spec.ts`:
- 임계일 4일 전은 여유다
- 임계일 3일 전부터 임박이고 daysLeft가 3이다
- 임계일 당일은 임박이고 daysLeft가 0이다
- 임계일 다음 날은 지남이고 overdueDays가 1이다
- 임계일이 지난 큐브는 overdue에 세고 fresh에서 빠진다
- 임박 배치도 임계일 알람 대상이다
- 상비 재료는 재고 현황에 행이 없다

`src/domain/deduction/deduction.spec.ts`의 `describe('재고 부족과 보류')` 곁에 `describe('상비 재료')`:
- 상비 재료는 재고가 없어도 차감하지 않고 보류하지 않는다 (식단의 다른 재료는 차감된다)
- 상비 재료의 소비 이벤트는 되돌리지 않는다 (큐브 추적일 때 소비된 원장 이벤트가 있는 재료를 상비로 바꾼 뒤 돌려도 `consumption_reverted`가 없고 `held`도 없다)

`src/domain/forecast/shortage-forecast.spec.ts`:
- 상비 재료는 부족 예측에 나오지 않는다

기존 테스트의 `pending_discard`, `due_today`, `due_tomorrow`, `pendingDiscard`는 아래 3번의 치환 규칙으로 고친다. 픽스처의 `Ingredient` 리터럴에는 `stockTracking: 'cubes'`를 더한다.

### 3. 타입 파급 (도메인 밖)

`Ingredient`에 필수 필드가 생기고 `ExpiryStage`의 kind가 바뀌므로 아래 파일이 컴파일에 걸린다. **도메인 밖에서는 아래 치환만 한다.** 다른 것을 고치지 마라. AC가 도메인 밖 변경 줄이 전부 아래 식별자 중 하나를 담는지 검사한다.

| 치환 | 대상 |
|---|---|
| `Ingredient` 리터럴에 `stockTracking: 'cubes',` 한 줄 추가 | `src/application/*.spec.ts`, `src/slack/templates/*.spec.ts`, `src/infrastructure/prisma/mappers/state.mapper.spec.ts`, `test/integration/`의 리터럴, `test/integration/setup/fixtures.ts` |
| `IngredientRow`에 `stockTracking: Ingredient['stockTracking'];`, `toIngredient`에 `stockTracking: row.stockTracking,` | `src/infrastructure/prisma/mappers/state.mapper.ts` (import를 늘리지 않으려고 `Ingredient['stockTracking']`을 쓴다) |
| `insertIngredient`의 `create.data`와 반환 리터럴에 `stockTracking: draft.stockTracking,` | `src/infrastructure/prisma/household-writer.ts` |
| `register`의 `draft` 리터럴에 `stockTracking: 'cubes',` | `src/application/ingredient.service.ts` (`IngredientDraft`는 `Omit<Ingredient, 'id'>`라 자동으로 필수가 된다. 새 재료는 큐브 추적으로 시작한다는 ADR 0009 (c)의 규칙이다) |
| `pendingDiscard` → `overdue` (필드 접근, 리터럴, 타입) | `src/application/daily-brief.ts`의 `BriefStockRow`와 매핑, `src/mcp/tools/stock.tools.ts`, `src/mcp/tools/alert.tools.ts`, `src/slack/templates/brief-lines.ts`(`byUrgency`), `src/slack/templates/daily-brief.ts`, `src/slack/templates/household-board.ts`, spec들, `test/integration/` |
| `{ kind: 'pending_discard', overdueDays: n }` → `{ kind: 'overdue', overdueDays: n }` | 모든 spec과 통합 테스트 픽스처 |
| `{ kind: 'due_today' }` → `{ kind: 'due_soon', daysLeft: 0 }`, `{ kind: 'due_tomorrow' }` → `{ kind: 'due_soon', daysLeft: 1 }` | 같음 |
| `'pending_discard'` 문자열 비교 → `'overdue'` | `src/slack/templates/daily-brief.ts`의 `discardButtons` 필터 |
| `stageLabel`의 switch를 새 kind에 맞춘다 | `src/slack/templates/labels.ts` |

`stageLabel`은 **기존 경우의 문자열을 글자 그대로 유지한다.** `fresh` → `'기한 여유'`, `due_soon`이고 `daysLeft === 1` → `'내일 기한'`, `daysLeft === 0` → `'오늘 기한'`, `overdue` → `` `기한 ${overdueDays}일 초과, 폐기 대기` ``. 새로 생기는 `daysLeft` 2와 3만 `` `기한 ${daysLeft}일 전` ``이다. 문구 정리는 phase 6의 v3에서 한다. 이 phase에서는 `src/slack/templates/__snapshots__`가 바뀌지 않아야 한다.

MCP 출력의 `pendingDiscard` 키도 `overdue`로 바꾼다(`stock.tools.ts`, `alert.tools.ts`의 매핑 한 줄). 도구 설명 문구는 phase 5가 고친다.

통합 테스트 픽스처 `test/integration/setup/fixtures.ts`의 `INGREDIENTS`는 서비스의 `register`를 부르므로 리터럴 추가가 필요 없을 수 있다. 컴파일에 걸리는 곳만 고쳐라.

## Acceptance Criteria

```bash
pnpm typecheck
pnpm lint
pnpm test
grep -q "EXPIRY_NOTICE_DAYS = 3" src/domain/stock/expiry.ts
grep -q "stockTracking: StockTracking" src/domain/ingredient/ingredient.ts
! grep -q "stockTracking?" src/domain/ingredient/ingredient.ts
grep -q "due_soon" src/domain/stock/expiry.ts
grep -q "overdue" src/domain/stock/stock-summary.ts
! rg -n 'pending_discard|pendingDiscard|due_tomorrow|due_today' src test --glob '!**/__snapshots__/**'
grep -q "상비" src/domain/deduction/deduction.spec.ts
grep -q "되돌리지 않는다" src/domain/deduction/deduction.spec.ts
grep -q "상비" src/domain/forecast/shortage-forecast.spec.ts
grep -q "3일 전" src/domain/stock/stock.spec.ts
! rg -n "from '@nestjs|new Date\(|Date\.now\(" src/domain
! git diff "$HARNESS_BASELINE" -- src/application src/infrastructure src/mcp src/slack src/scheduler test | grep -E '^[+-][^+-]' | grep -v -i -E 'stockTracking|overdue|pendingDiscard|pending_discard|due_soon|due_today|due_tomorrow|daysLeft'
git diff --quiet "$HARNESS_BASELINE" -- src/slack/templates/__snapshots__
git diff --quiet "$HARNESS_BASELINE" -- prisma docs README.md package.json
```

`! git diff ... | grep -v ...`는 도메인 밖에서 바뀐 줄 가운데 위 식별자를 하나도 담지 않은 줄이 있으면 실패한다. 통과하려면 도메인 밖 변경이 3번의 치환뿐이어야 한다. 위 명령은 이 세션의 `pnpm test:int`를 요구하지 않는다. 통합 테스트는 컴파일만 맞으면 되고 phase 3의 AC가 돌린다.

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- `stockTracking`을 선택 필드로 두거나 `?? 'cubes'` 같은 기본값을 어디에도 두지 마라. 이유: 운영 데이터가 없는 호환 코드다(AGENTS.md 금지 2번). 기존 행은 phase 1의 마이그레이션이 이미 채웠다.
- `stageLabel`의 기존 경우(`fresh`, 당일, 전일, 지남)가 돌려주는 문자열을 바꾸지 마라. 이유: 문구 변경은 phase 6의 v3에서 하고, 이 phase에서는 `git diff --quiet "$HARNESS_BASELINE" -- src/slack/templates/__snapshots__`가 통과해야 한다.
- 도메인 밖에서 3번 표의 치환 외의 것을 고치지 마라. 이유: AC의 diff 검사가 실패한다. `nextExpiry`, `pantryIngredients`, `updateStockTracking`은 phase 3과 4의 일이다.
- 상비 제외를 `summarizeStock`이나 `forecastShortage`의 호출자(애플리케이션)에서 하지 마라. 이유: ADR 0009 (b). 도메인이 한다.
- `src/domain`에 프레임워크, DB, `new Date()`를 들이지 마라. 이유: AGENTS.md 계층 규약.
- 마이그레이션이나 스키마를 고치지 마라. 이유: phase 1이 끝냈고 scope 밖이다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
