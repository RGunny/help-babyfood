# Phase 4: application

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md` (`src/application`은 NestJS를 모른다. 서비스는 생성자에 포트를 받는 평범한 클래스다)
- `tasks/2-pantry-and-expiry/docs-diff.md`
- `docs/adr/0009-pantry-ingredients-and-expiry-notice.md` 전체. 이 phase는 (c), (d)와 읽기 모델을 구현한다
- `docs/adr/0005-scheduler-and-daily-brief.md`의 "보류된 차감" 절 (브리프가 `reconcileMeals`를 다시 걸어 `held`만 가져간다. 상비 제외는 phase 2가 도메인에서 끝냈으므로 브리프의 보류는 저절로 빠진다)
- `src/application/ports/household-write.port.ts`의 `CatalogWrites`
- `src/application/ingredient.service.ts` 전체 (`updateServingWeight`가 이 phase가 더할 메서드의 본보기)
- `src/application/stock.service.ts`의 `registerCookedBatch`
- `src/application/alert-settings.service.ts`의 `resolveThresholds`
- `src/application/reaction.service.ts`의 `getIntroductionStatus`와 `IngredientIntroduction` 타입
- `src/application/errors.ts` (`ApplicationErrorCode` 유니온)
- `src/application/daily-brief.ts` 전체. 특히 `BriefStockRow`, `DailyBrief`, `buildDailyBrief`의 `stock`과 `expiryAlerts` 매핑
- `src/application/daily-brief.spec.ts` (픽스처 `INGREDIENTS`, `stock()` 헬퍼, 테스트 이름 관례)
- `src/domain/stock/stock-summary.ts`의 `IngredientStock.batches` (조리일 순. 첫 배치가 가장 이른 임계일이다)와 `src/domain/stock/expiry.ts`의 `expiryDateOf`
- `src/infrastructure/prisma/household-writer.ts`의 `updateStockTracking` (phase 3이 만든 구현)
- `test/integration/ingredient.int-spec.ts`, `test/integration/stock.int-spec.ts`, `test/integration/settings.int-spec.ts`, `test/integration/daily-brief.int-spec.ts` (통합 테스트 본보기와 픽스처 `test/integration/setup/fixtures.ts`)

## 작업 내용

### 1. 포트

`CatalogWrites`에 `updateServingWeight` 뒤에 더한다.

```ts
  updateStockTracking(ingredientId: string, stockTracking: StockTracking): Promise<void>;
```

`StockTracking`은 `src/domain/ingredient/ingredient.ts`에서 import한다.

### 2. `IngredientService.updateStockTracking`

```ts
export interface UpdateStockTrackingCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly name: string;
  readonly stockTracking: StockTracking;
}
```

`writer.write`의 operation은 `'update_ingredient_stock_tracking'`, payload는 `{ name, stockTracking }`이다. 본문:

- `requireIngredient`로 재료를 찾는다.
- `pantry`로 바꾸는데 그 재료의 배치 잔여 합이 0보다 크면 `ApplicationError('PANTRY_WITH_STOCK', ...)`를 던진다. 잔여는 `remainingByBatch(state.entries)`와 `state.batches.filter(batch => batch.ingredientId === ingredient.id)`로 센다. `summarizeStock`을 쓰지 마라. 그 함수는 이미 상비인 재료를 빼는데 여기서는 아직 큐브 추적인 재료를 보는 것이므로 결과는 같지만, 규칙의 뜻("잔여 큐브가 있으면 안 된다")은 원장 합계가 더 직접적이다.
- 같은 값으로 바꾸는 호출은 거부하지 않고 그대로 저장한다.
- `context.updateStockTracking(ingredient.id, command.stockTracking)`을 부르고 `{ ...ingredient, stockTracking }`을 돌려준다.

`register`는 그대로 `stockTracking: 'cubes'`다(phase 2). 커맨드에 `stockTracking`을 더하지 마라.

### 3. 거부 규칙 둘

- `StockService.registerCookedBatch`: 찾은 재료가 `pantry`면 `ApplicationError('PANTRY_INGREDIENT', '상비 재료는 큐브로 입고하지 않습니다: 계란')`을 던진다. 배치도 원장도 남지 않아야 한다(트랜잭션 안에서 던지므로 저절로 그렇다).
- `AlertSettingsService`의 `resolveThresholds`: 재료가 `pantry`면 `ApplicationError('INVALID_THRESHOLD', '상비 재료에는 임계개수를 둘 수 없습니다: 계란')`을 던진다.

`src/application/errors.ts`의 코드 유니온에 `'PANTRY_WITH_STOCK'`과 `'PANTRY_INGREDIENT'`를 더한다.

### 4. 읽기 모델

`src/application/daily-brief.ts`:

```ts
export interface BriefNextExpiry {
  readonly date: LocalDate;
  readonly stage: ExpiryStage;
}

export interface BriefStockRow {
  // ... 기존 필드 (overdue는 phase 2가 바꿨다)
  /** Earliest expiry among the batches with cubes left. Null when nothing is in the freezer. */
  readonly nextExpiry: BriefNextExpiry | null;
}

/** Ingredients that are always at hand and therefore have no stock row. */
export interface BriefPantryIngredient {
  readonly ingredientId: string;
  readonly name: string;
}

export interface DailyBrief {
  // ... 기존 필드
  readonly pantryIngredients: readonly BriefPantryIngredient[];
}
```

- `nextExpiry`: `stock.batches[0]`이 있으면 `{ date: expiryDateOf(batches[0].batch, shelfLifeDays), stage: batches[0].expiry }`, 없으면 null. `batches`는 잔여가 있는 배치만 조리일 순으로 담고 있다.
- `pantryIngredients`: `state.ingredients.filter(i => i.stockTracking === 'pantry')`를 `{ ingredientId, name }`으로. 순서는 `state.ingredients` 순.
- `stock`은 `summarizeStock` 결과 그대로다. 상비 재료는 도메인이 이미 뺐다. 여기서 다시 거르지 마라.
- `thresholdAlerts`, `expiryAlerts`, `attention`은 그대로.

`ReactionService.getIntroductionStatus`의 반환 항목(`IngredientIntroduction`)에 `stockTracking: StockTracking`을 더한다. MCP의 `get_ingredient_introduction_status`가 재료 목록 조회를 겸하므로 거기서 상비 여부를 보이기 위해서다(phase 5가 출력에 싣는다).

### 5. 단위 테스트

`src/application/daily-brief.spec.ts`에 더한다.

- 상비 재료는 재고 표에 없고 상비 목록에 이름이 있다
- 임계일 열은 잔여가 있는 가장 이른 배치의 임계일과 단계다
- 배치가 없는 재료의 임계일 열은 비어 있다
- 상비 재료는 재고가 없어도 보류된 차감에 오르지 않는다

픽스처 `INGREDIENTS`에 상비 재료(예: `{ id: 'egg', name: '계란', category: 'high_risk_allergen', servingWeightGram: 10, stockTracking: 'pantry' }`)를 하나 더한다.

### 6. 통합 테스트

`test/integration/ingredient.int-spec.ts`에 `describe('재고 방식 변경')`:
- 잔여 큐브가 없는 재료는 상비로 바뀌고 다시 큐브 추적으로 돌아온다
- 잔여 큐브가 있는 재료는 상비로 바꿀 수 없다 (`PANTRY_WITH_STOCK`, 저장된 값은 그대로)
- 같은 멱등키로 두 번 부르면 한 번만 기록되고 응답이 같다

`test/integration/stock.int-spec.ts`의 `describe('입고')`:
- 상비 재료는 입고를 거부하고 배치도 원장도 남기지 않는다 (`PANTRY_INGREDIENT`)

`test/integration/settings.int-spec.ts`의 `describe('알람 설정')`:
- 상비 재료의 임계개수는 거부한다

`test/integration/daily-brief.int-spec.ts`:
- 상비 재료는 식단시간이 지나도 보류된 차감에 오르지 않고 재고 표 대신 상비 목록에 있다 (계란처럼 재고 0인 재료를 상비로 바꾸고 식단시간을 지나게 한 뒤 `heldDeductions`가 비고 `pantryIngredients`에 있음을 확인. 기존 "식단시간이 지나면 재고가 없는 재료의 차감이 확인 필요에 오른다" 테스트와 짝이다)
- 재고 표의 임계일 열이 가장 이른 배치의 임계일이다

기존 테스트에서 "폐기 대기"라는 말이 테스트 이름에 있으면(예: `settings.int-spec.ts`의 "바꾼 임계일이 폐기 대기 판정에 쓰인다") "임계 지남"으로 고친다.

## Acceptance Criteria

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
grep -q "updateStockTracking" src/application/ports/household-write.port.ts
grep -q "PANTRY_WITH_STOCK" src/application/ingredient.service.ts
grep -q "PANTRY_INGREDIENT" src/application/stock.service.ts
grep -q "pantry" src/application/alert-settings.service.ts
grep -q "PANTRY_WITH_STOCK" src/application/errors.ts
grep -q "PANTRY_INGREDIENT" src/application/errors.ts
grep -q "nextExpiry" src/application/daily-brief.ts
grep -q "pantryIngredients" src/application/daily-brief.ts
grep -q "stockTracking" src/application/reaction.service.ts
! grep -A 12 "interface RegisterIngredientCommand" src/application/ingredient.service.ts | grep -q stockTracking
! rg -n "from '@nestjs" src/application --glob '!*.module.ts'
! rg -n "new Date\(|Date\.now\(" src/application
! rg -n "폐기 대기" test/integration
grep -q "상비" src/application/daily-brief.spec.ts
grep -q "상비" test/integration/ingredient.int-spec.ts
grep -q "PANTRY_WITH_STOCK" test/integration/ingredient.int-spec.ts
grep -q "PANTRY_INGREDIENT" test/integration/stock.int-spec.ts
grep -q "상비" test/integration/settings.int-spec.ts
grep -q "pantryIngredients" test/integration/daily-brief.int-spec.ts
git diff --quiet HEAD -- src/domain src/infrastructure src/mcp src/slack src/scheduler prisma docs README.md
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `pnpm test:int`는 Docker가 필요하다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- `RegisterIngredientCommand`에 `stockTracking`을 더하지 마라. 이유: 새 재료는 큐브 추적으로 시작하고 상비 전환은 별도 도구로 한다(ADR 0009 (c)).
- `buildDailyBrief`에서 상비 재료를 다시 거르지 마라. 이유: 도메인 `summarizeStock`이 이미 뺀다. 두 번 거르면 규칙이 두 곳에 생긴다.
- `nextExpiry`의 단계를 애플리케이션에서 날짜 차로 다시 계산하지 마라. 이유: `BatchStock.expiry`가 도메인이 계산한 값이다.
- 서비스에 데코레이터를 달거나 `@nestjs/*`를 import하지 마라. 이유: AGENTS.md 계층 규약.
- `src/mcp`, `src/slack`을 고치지 마라. 이유: phase 5와 6의 일이고 scope 밖이다. 이 phase가 끝난 뒤 MCP 도구와 템플릿은 새 필드를 아직 보이지 않지만 컴파일된다(추가된 필드는 읽지 않아도 된다).
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
