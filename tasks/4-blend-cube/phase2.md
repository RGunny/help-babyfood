# Phase 2: domain

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md` (계층 절. `src/domain`은 프레임워크, DB, 시스템 시계를 모른다)
- `tasks/4-blend-cube/docs-diff.md` (phase 0이 고친 문서. ADR 0011의 (a), (b), (e)가 이 phase의 근거다)
- `docs/adr/0011-blend-ingredients.md` 전체
- `src/domain/ingredient/ingredient.ts`, `src/domain/ingredient/ingredient-catalog.ts`, `src/domain/ingredient/ingredient.spec.ts`
- `src/domain/menu/menu.ts`, `src/domain/menu/menu.spec.ts`
- `src/domain/rules/meal-rules.ts`, `src/domain/rules/meal-rules.spec.ts`
- `src/domain/errors.ts`
- `src/domain/deduction/reconcile.ts`, `src/domain/forecast/shortage-forecast.ts` (읽기만 한다. 이 둘이 `expandToCubeNeeds`로 재고 단위를 푸는 방식은 바뀌지 않는다)
- 타입 파급을 받는 파일: `src/application/ingredient.service.ts`, `src/application/daily-brief.ts`(`validateMealPlan` 호출), `src/application/meal-plan.service.ts`(같음), `src/application/meal-plan-import.service.ts`(같음), `src/infrastructure/prisma/mappers/state.mapper.ts`, `src/infrastructure/prisma/household-writer.ts`(`insertIngredient`의 반환 리터럴)

시작하기 전에 `pnpm prisma:generate`를 돌려라.

## 동결 해제의 이유

`src/domain/`은 `harness.json`의 동결 경로다. 이 phase는 `unfreeze`로 연다. 이유는 ADR 0011 (b)다. `Ingredient` 타입과 `validateMealPlan`이 도메인에 있고, `validateMealPlan`은 `Meal`과 `menus`를 받아 안에서 풀기 때문에 호출자가 합침 재료를 미리 풀어 넘길 수 없다. tech-critic-lead가 이 이유로 승인했다.

여는 범위는 `src/domain/ingredient`, `src/domain/menu`, `src/domain/rules`, `src/domain/errors.ts`다. 재고 쪽 세 디렉터리(`src/domain/stock`, `src/domain/deduction`, `src/domain/forecast`)는 spec의 픽스처 한 줄씩을 빼고 바뀌지 않는다.

## 작업 내용

### 1. `src/domain/ingredient/ingredient.ts`

`Ingredient`에 필드 하나를 더한다. **필수 필드다. `?`를 붙이지 마라.**

```ts
  /**
   * Ingredients a blend cube is made of, such as 쌀 and 오트밀 for "쌀오트밀". Empty for a plain
   * ingredient. A blend is still one stock unit: batches, deduction and forecast use its own id.
   * Only what the baby ate is read through this list (ADR 0011).
   */
  readonly constituentIngredientIds: readonly string[];
```

같은 파일에 `isBlend(ingredient: Ingredient): boolean`을 둔다. 구성 재료가 하나라도 있으면 합침 재료다.

### 2. `src/domain/errors.ts`

`DomainErrorCode`에 `'INVALID_BLEND'`를 더한다.

### 3. `src/domain/ingredient/ingredient-catalog.ts`

생성자가 이름 충돌을 던지는 것과 같은 자리에서 합침 재료의 구조를 검증한다. 모든 재료를 `byId`에 넣은 뒤에 본다. 어기면 `DomainError('INVALID_BLEND', …)`를 던지고, 메시지는 어느 재료의 무엇이 틀렸는지 한국어로 적는다.

- 구성 재료는 둘 이상이다.
- 구성 재료는 서로 다르다.
- 구성 재료는 자기 자신이 아니다.
- 구성 재료는 카탈로그에 있는 재료다.
- 구성 재료는 다시 합침 재료가 아니다.

메서드 하나를 더한다.

```ts
  /** What feeding one cube of the ingredient fed: a blend's constituents, or the ingredient itself. */
  eatenIngredientIds(id: string): readonly string[]
```

등록되지 않은 id는 `getById`와 같이 `UNKNOWN_INGREDIENT`를 던진다.

### 4. `src/domain/menu/menu.ts`

함수 하나를 더한다. `expandToCubeNeeds`는 고치지 마라. 그 함수는 재고 단위를 돌려주고, 합침 재료는 합침 재료 그대로 나와야 한다.

```ts
/**
 * Ingredients the baby eats in a meal: the cube needs with each blend replaced by its constituents.
 * No id appears twice, so a meal holding a blend and one of its constituents feeds that ingredient once.
 */
export function expandToEatenIngredientIds(
  composition: MealComposition,
  menus: ReadonlyMap<string, Menu>,
  catalog: IngredientCatalog,
): string[]
```

순서는 `expandToCubeNeeds`가 준 순서를 따르고, 합침 재료 자리에 구성 재료가 저장된 순서로 들어가며, 먼저 나온 것을 남긴다.

### 5. `src/domain/rules/meal-rules.ts`

`ValidateMealPlanInput`에 `readonly catalog: IngredientCatalog`를 더하고, `mealsOfDay`의 `ingredientIds`를 `expandToEatenIngredientIds(effectiveComposition(entry.meal), input.menus, input.catalog)`로 얻는다. 나머지 판정은 그대로다. 그 결과 첫 도입, 반응 있었던 재료, 금지 조합이 전부 구성 재료로 판정된다.

### 6. 도메인 단위 테스트

테스트 이름은 규칙을 한국어로 서술한다(AGENTS.md 금지 7번). 아래 이름을 그대로 쓴다. break-it phase가 이 이름을 지목한다.

`src/domain/ingredient/ingredient.spec.ts`:
- "합침 재료는 구성 재료가 둘 이상이어야 한다"
- "구성 재료에 같은 재료를 두 번 넣을 수 없다"
- "등록되지 않은 재료는 구성 재료가 될 수 없다"
- "합침 재료는 다른 합침 재료의 구성 재료가 될 수 없다"
- "합침 재료가 먹인 재료는 구성 재료이고 일반 재료는 자기 자신이다"

`src/domain/menu/menu.spec.ts`:
- "합침 재료가 든 메뉴의 큐브 필요량은 합침 재료 그대로다"
- "합침 재료가 든 메뉴를 먹이면 구성 재료를 먹인 것이다"
- "한 끼에 합침 재료와 그 구성 재료가 함께 있어도 구성 재료의 급여는 한 번으로 센다"

`src/domain/rules/meal-rules.spec.ts`:
- "합침 재료에 처음 먹는 구성 재료가 있으면 그 구성 재료가 첫 도입이다"
- "반응 있었던 재료가 합침 재료의 구성에 있으면 경고한다"
- "금지 조합은 합침 재료의 구성 재료에도 걸린다"

기존 테스트의 `validateMealPlan` 호출에는 `catalog`를 넘긴다.

### 7. 도메인 밖의 타입 파급

`src/domain/` 밖에서는 아래 **두 가지만** 한다. "먹였는가" 호출부를 새 함수로 바꾸는 일은 phase 4다.

(가) `Ingredient` 값을 만드는 곳에 `constituentIngredientIds: []`를 더한다.

| 파일 | 위치 |
|---|---|
| `src/application/ingredient.service.ts` | `register`의 `draft` |
| `src/infrastructure/prisma/mappers/state.mapper.ts` | `toIngredient`의 반환값. 구성 행을 읽는 것은 phase 3이다 |
| `src/infrastructure/prisma/household-writer.ts` | `insertIngredient`의 반환 리터럴. 구성 행을 쓰는 것은 phase 3이다 |
| `src/infrastructure/prisma/mappers/state.mapper.spec.ts` | "대표 이름은 이름으로, 나머지 호칭은 별칭으로 간다"의 기대값. 이 파일에서는 이것만 한다 |
| `src/application/daily-brief.spec.ts`, `src/application/feeding-history.spec.ts`, `src/application/household-board.spec.ts`, `src/application/rules.spec.ts` | 재료 픽스처 |
| `src/domain/stock/stock.spec.ts`, `src/domain/deduction/deduction.spec.ts`, `src/domain/forecast/shortage-forecast.spec.ts` | 재료 픽스처. **이 세 파일에서는 픽스처에 이 필드를 더하는 것 외에 아무것도 고치지 마라** |

(나) `validateMealPlan` 호출부 셋에 `catalog: state.catalog`(그 자리에서 쓰는 상태 변수 이름에 맞춘다)를 넘긴다: `src/application/daily-brief.ts`, `src/application/meal-plan.service.ts`, `src/application/meal-plan-import.service.ts`. `src/application/rules.spec.ts`가 `validateMealPlan`을 직접 부르면 거기도 넘긴다.

`pnpm typecheck`가 scope 밖의 다른 파일을 지목하면 고치지 말고 status를 `error`로 보고하라. 계획을 세울 때 실제로 필드를 더해 돌려 본 결과가 위 목록이다.

## Acceptance Criteria

```bash
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
git diff --quiet "$HARNESS_BASELINE" -- src/domain/stock src/domain/deduction src/domain/forecast ':(exclude)src/domain/stock/stock.spec.ts' ':(exclude)src/domain/deduction/deduction.spec.ts' ':(exclude)src/domain/forecast/shortage-forecast.spec.ts'
! git diff HEAD -- src/domain/stock/stock.spec.ts src/domain/deduction/deduction.spec.ts src/domain/forecast/shortage-forecast.spec.ts | grep -E '^\+[^+]' | grep -v constituentIngredientIds
git diff --quiet "$HARNESS_BASELINE" -- src/slack src/scheduler src/scripts src/mcp
git diff --quiet HEAD -- prisma docs README.md test package.json
! grep -n 'constituentIngredientIds?' src/domain/ingredient/ingredient.ts
grep -q "INVALID_BLEND" src/domain/errors.ts
grep -q "INVALID_BLEND" src/domain/ingredient/ingredient-catalog.ts
grep -q "eatenIngredientIds" src/domain/ingredient/ingredient-catalog.ts
grep -q "expandToEatenIngredientIds" src/domain/rules/meal-rules.ts
! grep -rn "expandToEatenIngredientIds" src/application
grep -q "한 끼에 합침 재료와 그 구성 재료가 함께 있어도 구성 재료의 급여는 한 번으로 센다" src/domain/menu/menu.spec.ts
grep -q "합침 재료는 다른 합침 재료의 구성 재료가 될 수 없다" src/domain/ingredient/ingredient.spec.ts
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- `src/domain/stock`, `src/domain/deduction`, `src/domain/forecast`의 구현을 고치지 마라. 이유: 합침 재료는 그 자체가 재고 단위라 차감과 예측은 지금 코드 그대로 맞다(ADR 0011 (b)). AC가 baseline과 비교한다.
- `expandToCubeNeeds`가 합침 재료를 구성 재료로 풀게 하지 마라. 이유: 그러면 합침 큐브가 아니라 쌀 큐브와 오트밀 큐브를 차감한다.
- `constituentIngredientIds`를 선택 필드로 두거나 `?? []`로 읽지 마라. 이유: 운영 데이터가 없는 호환 코드다(AGENTS.md 금지 2번).
- `src/application`에서 `expandToEatenIngredientIds`를 쓰지 마라. 이유: 급여를 세는 호출부의 전환은 phase 4다. 한 phase가 한 계층만 고쳐야 실패했을 때 원인이 갈린다. AC가 잡는다.
- 매퍼와 writer에서 구성 행을 읽거나 쓰지 마라. 이유: phase 3이다. 이 phase에서는 `[]`만 돌려준다.
- `Ingredient`에 구성 재료별 중량이나 합침 여부 플래그를 두지 마라. 이유: 중량은 읽는 곳이 없고, 합침 여부는 목록이 비었는지로 안다.
- `src/slack`, `src/mcp`, `src/scheduler`, `src/scripts`, `prisma`, `test/`, `docs/`를 고치지 마라. 이유: AC가 잡는다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
