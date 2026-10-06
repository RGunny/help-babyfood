# Phase 4: application

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md` (계층 절. 서비스는 생성자에 포트를 받는 평범한 클래스이고 데코레이터를 달지 않는다)
- `tasks/4-blend-cube/docs-diff.md` (ADR 0011의 (b), (c), (d), (e)가 이 phase의 근거다)
- `docs/adr/0011-blend-ingredients.md` 전체
- `src/domain/ingredient/ingredient.ts`(`constituentIngredientIds`, `isBlend`), `src/domain/ingredient/ingredient-catalog.ts`(`eatenIngredientIds`, `INVALID_BLEND`), `src/domain/menu/menu.ts`(`expandToEatenIngredientIds`) (phase 2가 더했다. 읽기만 한다)
- `src/application/feeding-history.ts`와 그 spec
- `src/application/daily-brief.ts`의 `newIngredientsOf`, `unrecordedReactionsOf`, `buildDailyBrief`가 `introductionStatuses`와 `fedIngredientIdsBefore`를 부르는 줄
- `src/application/household-board.ts`의 `exposureMealOf`, `boardMealOf`, `introductionStatuses`를 부르는 두 줄
- `src/application/composition.ts`, `src/application/ingredient.service.ts`, `src/application/reaction.service.ts`, `src/application/rules.service.ts`(`normalizePairings`), `src/application/errors.ts`
- `src/application/meal-plan.service.ts`, `src/application/meal-plan-import.service.ts` (`introductionStatuses`, `fedIngredientIdsBefore` 호출부)
- `test/integration/setup/fixtures.ts`, `test/integration/blend-ingredient.int-spec.ts`(phase 3이 만들었다), `test/integration/reconcile.int-spec.ts`, `test/integration/reaction.int-spec.ts`, `test/integration/meal-plan.int-spec.ts`, `test/integration/settings.int-spec.ts`, `test/integration/plan-warnings.int-spec.ts`

시작하기 전에 `pnpm prisma:generate`를 돌려라.

## 동결 경로에 대하여

이 phase는 `src/domain/`을 고치지 않는다. `index.json`에 `unfreeze: ["src/domain/"]`가 있는 이유는 러너가 동결 경로를 task의 baseline과 비교하기 때문이다. phase 2가 도메인을 고쳐 커밋했으므로 선언이 없으면 동결 위반으로 잡힌다. AC의 `git diff --quiet HEAD -- src/domain`이 이 phase가 도메인을 건드리지 않았음을 확인한다.

## 작업 내용

도메인은 "합침 재료를 먹인 것은 구성 재료를 먹인 것"이라는 풀이 함수를 이미 갖고 있다. 이 phase는 애플리케이션에서 급여를 세는 곳을 전부 그 함수로 옮기고, 합침 재료를 등록하는 서비스와 거부 셋을 더한다. 재고 쪽(차감, 부족 예측, 재고 알람, 임계개수)은 합침 재료 id로 지금 코드 그대로 돌므로 고치지 않는다.

### 1. 급여를 세는 곳을 도메인 함수로 옮긴다

`src/application/feeding-history.ts`:

- `ingredientIdsOf(meal, menus, catalog)`가 `expandToEatenIngredientIds(effectiveComposition(meal), menus, catalog)`를 돌려준다.
- `introductionStatuses(history, ingredients, menus, catalog)`가 그 함수로 급여를 세고, **합침 재료를 결과 맵에서 뺀다**(`isBlend`). 합침 재료 자체는 도입 상태가 없다(ADR 0011 (c)).
- `fedIngredientIdsBefore(history, calendar, menus, catalog, date)`도 같다.

호출부는 `daily-brief.ts`, `household-board.ts`, `meal-plan.service.ts`, `meal-plan-import.service.ts`, `reaction.service.ts`다. 전부 `state.catalog`를 넘긴다.

`src/application/daily-brief.ts`의 `newIngredientsOf`와 `unrecordedReactionsOf`는 `expandToCubeNeeds`를 직접 부른다. 둘 다 `expandToEatenIngredientIds`로 바꾼다. 이 파일의 부족 계산은 `forecastShortage`를 부르므로 바꾼 뒤 이 파일에 `expandToCubeNeeds`가 남지 않는다.

`src/application/household-board.ts`:

- `exposureMealOf`의 `ingredientIds`를 `expandToEatenIngredientIds`로 얻는다.
- `boardMealOf`의 `watchedBaseIngredients`는 메뉴 구성의 재료를 `state.catalog.eatenIngredientIds`로 푼 뒤(중복 없이) 지금과 같은 조건으로 거른다. 그러면 합침 재료가 든 메뉴의 베이스 칸에 관찰이 필요한 구성 재료가 `쌀현미오트밀죽 (현미 ①)`처럼 지금 양식 그대로 나온다. `BoardMeal`과 `BoardIngredient`의 모양은 바꾸지 마라.

### 2. `IngredientService.registerBlend`

`src/application/ingredient.service.ts`에 명령과 메서드를 더한다.

```ts
export interface RegisterBlendCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly category: IngredientCategory;
  readonly servingWeightGram: number;
  /** The ingredients the cube is made of, named as the parent says them: ["쌀", "오트밀"]. */
  readonly constituentNames: readonly string[];
}
```

연산 이름은 `register_blend_ingredient`다. 구성 재료 이름을 `state.catalog.findByName`으로 풀고(없으면 `UNKNOWN_INGREDIENT`), `register`와 같은 방식으로 후보를 넣은 `new IngredientCatalog([...])`를 만들어 이름 충돌과 `INVALID_BLEND`를 도메인이 던지게 한 뒤, 기존 `context.insertIngredient(draft)`로 쓴다. `stockTracking`은 `'cubes'`, `verifiedBeforeMigration`은 `false`다. 구조 규칙을 서비스에 다시 쓰지 마라. 별칭으로 가리킨 구성 재료 둘이 같은 재료면 도메인이 "서로 다름" 규칙으로 던진다.

### 3. 거부 셋

`src/application/errors.ts`의 `ApplicationErrorCode`에 `'BLEND_AS_TOPPING'`, `'BLEND_HAS_NO_REACTION'`, `'BLEND_IN_PAIRING'`을 더한다.

- `src/application/composition.ts`의 `resolveComposition`: 토핑 이름이 합침 재료로 풀리면 `ApplicationError('BLEND_AS_TOPPING', …)`. 메시지에 재료 이름과 "합침 재료는 메뉴 구성으로만 쓸 수 있습니다"를 담는다. 식단 수정과 식단표 가져오기가 이 함수를 함께 쓰므로 두 경로가 한 번에 막힌다.
- `src/application/reaction.service.ts`의 `record`: 재료가 합침 재료면 `ApplicationError('BLEND_HAS_NO_REACTION', …)`. 메시지에 구성 재료 이름을 담는다(예: "합침 재료에는 반응을 기록하지 않습니다. 구성 재료로 기록하세요: 쌀, 오트밀"). `INGREDIENT_NOT_IN_MEAL` 검사보다 먼저 본다.
- `src/application/rules.service.ts`의 `normalizePairings`: 조합의 재료가 합침 재료면 `ApplicationError('BLEND_IN_PAIRING', …)`.

### 4. `ReactionService.getIntroductionStatus`

합침 재료도 한 줄로 돌려준다. 상태 자리에 애플리케이션 타입을 쓴다.

```ts
/** A blend has no status of its own: what parents watch is its constituents. */
export interface BlendIntroduction {
  readonly kind: 'blend';
  readonly constituentNames: readonly string[];
}

export interface IngredientIntroduction {
  readonly ingredientId: string;
  readonly name: string;
  readonly status: IntroductionStatus | BlendIntroduction;
  readonly stockTracking: StockTracking;
}
```

**일반 재료 행의 모양은 바꾸지 마라.** 필드를 더하는 것도 안 된다. `test/integration/ingredient.int-spec.ts`가 그 모양을 `toEqual`로 고정하고 있고 그 파일은 scope 밖이다. 도메인의 `IntroductionStatus`도 바꾸지 않는다.

### 5. 단위 테스트

아래 이름을 그대로 쓴다. break-it phase가 지목한다.

`src/application/feeding-history.spec.ts`:
- "합침 재료를 먹인 급여는 구성 재료의 급여로 센다"
- "합침 재료 자체는 도입 상태가 없다"

`src/application/daily-brief.spec.ts`:
- "합침 재료의 구성 재료가 검증중이면 그 구성 재료가 새 재료로 뜬다"
- "합침 재료의 재고 알람과 재고 행은 합침 재료 이름으로 나온다"

`src/application/household-board.spec.ts`:
- "베이스 메뉴의 합침 재료는 관찰이 필요한 구성 재료로 풀려 표시된다"

`src/application/rules.spec.ts`가 `fedIngredientIdsBefore`나 `introductionStatuses`를 부르면 새 인자를 넘긴다.

### 6. 통합 테스트

아래 여섯 파일에만 더한다. 기존 테스트를 고치지 않고 더하기만 한다(import 줄에 이름을 더하는 것은 된다. AC가 import가 아닌 지워진 줄을 잡는다). 합침 재료, 메뉴, 배치는 테스트 안에서 서비스로 만든다(`services.ingredient.registerBlend`, `services.menu.register`, `services.stock.registerCookedBatch`). `fixtures.ts`는 고치지 않는다.

| 파일 | 테스트 이름 |
|---|---|
| `test/integration/blend-ingredient.int-spec.ts` | `describe('합침 재료 등록', …)`: "구성 재료 이름을 풀어 합침 재료를 등록한다", "등록되지 않은 재료는 구성 재료가 될 수 없다", "구성 재료가 하나뿐이면 등록할 수 없다", "합침 재료는 다른 합침 재료의 구성 재료가 될 수 없다", "이미 있는 이름으로는 합침 재료를 등록할 수 없다", "도입 상태 조회는 합침 재료를 구성 재료 이름과 함께 돌려준다" |
| `test/integration/reconcile.int-spec.ts` | "합침 재료 메뉴의 끼니는 합침 큐브를 차감하고 구성 재료의 큐브는 건드리지 않는다" |
| `test/integration/reaction.int-spec.ts` | "합침 재료를 먹인 끼니에 구성 재료의 반응을 기록할 수 있다", "합침 재료 이름으로는 반응을 기록할 수 없다" |
| `test/integration/meal-plan.int-spec.ts` | "합침 재료는 토핑으로 넣을 수 없다" |
| `test/integration/settings.int-spec.ts` | "금지 조합에 합침 재료를 넣을 수 없다" |
| `test/integration/plan-warnings.int-spec.ts` | "합침 재료에 처음 먹는 구성 재료가 있으면 첫 도입 경고는 그 구성 재료를 가리킨다" |

`reconcile.int-spec.ts`의 테스트가 "재고는 합침 재료 그대로 센다"를 고정하는 유일한 통합 테스트다. 도메인의 `deduction.spec.ts`는 이 task에서 고칠 수 없으므로 여기서 본다. 쌀, 오트밀, 쌀오트밀 세 재료의 배치를 모두 넣고, 합침 메뉴의 끼니가 지난 뒤 정합화를 돌려 쌀오트밀 배치만 1 줄고 쌀과 오트밀 배치는 그대로인 것을 본다.

## Acceptance Criteria

```bash
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
grep -q "BLEND_AS_TOPPING" src/application/composition.ts
grep -q "BLEND_HAS_NO_REACTION" src/application/reaction.service.ts
grep -q "BLEND_IN_PAIRING" src/application/rules.service.ts
grep -q "registerBlend" src/application/ingredient.service.ts
! grep -n "expandToCubeNeeds" src/application/feeding-history.ts src/application/household-board.ts src/application/daily-brief.ts
grep -q "합침 재료를 먹인 급여는 구성 재료의 급여로 센다" src/application/feeding-history.spec.ts
grep -q "합침 재료 자체는 도입 상태가 없다" src/application/feeding-history.spec.ts
grep -q "합침 재료는 토핑으로 넣을 수 없다" test/integration/meal-plan.int-spec.ts
grep -q "합침 재료 메뉴의 끼니는 합침 큐브를 차감하고 구성 재료의 큐브는 건드리지 않는다" test/integration/reconcile.int-spec.ts
git diff --quiet HEAD -- src/domain
git diff --quiet HEAD -- src/infrastructure src/mcp prisma docs README.md package.json
git diff --quiet HEAD -- test ':(exclude)test/integration/blend-ingredient.int-spec.ts' ':(exclude)test/integration/reconcile.int-spec.ts' ':(exclude)test/integration/reaction.int-spec.ts' ':(exclude)test/integration/meal-plan.int-spec.ts' ':(exclude)test/integration/settings.int-spec.ts' ':(exclude)test/integration/plan-warnings.int-spec.ts'
! git diff HEAD -- test/integration | grep -E '^-[^-]' | grep -vE '^-import '
git diff --quiet "$HARNESS_BASELINE" -- src/application/menu.service.ts src/application/ports
git diff --quiet "$HARNESS_BASELINE" -- src/domain/stock src/domain/deduction src/domain/forecast ':(exclude)src/domain/stock/stock.spec.ts' ':(exclude)src/domain/deduction/deduction.spec.ts' ':(exclude)src/domain/forecast/shortage-forecast.spec.ts'
git diff --quiet "$HARNESS_BASELINE" -- src/slack src/scheduler src/scripts
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `pnpm test:int`는 Docker가 필요하다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- 위 여섯 파일 밖의 통합 테스트가 실패하면 그 테스트를 고치지 마라. status를 `error`로 보고하라. 이유: 합침 재료가 없는 기존 데이터의 동작은 바뀌지 않아야 한다. 실패했다면 구현이 기존 동작을 바꾼 것이다. tech-critic-lead의 승인 조건이다.
- `test/integration/forecast.int-spec.ts`에 테스트를 더하지 마라. 이유: 부족 예측 도메인은 바뀌지 않고, 합침 재료의 부족은 `daily-brief.spec.ts`의 "합침 재료의 재고 알람과 재고 행은 합침 재료 이름으로 나온다"가 같은 함수로 본다.
- `getIntroductionStatus`의 일반 재료 행에 필드를 더하거나 모양을 바꾸지 마라. 이유: 위 4번.
- `MenuService`를 고치지 마라. `update`에 과거 재계산을 막는 검사를 넣지 마라. 이유: 재전개는 정합화의 성질이고, 막으면 잘못 등록한 구성을 고치는 경로가 막힌다(ADR 0011 (g)). AC가 baseline과 비교한다.
- `src/application/ports`를 고치지 마라. `CatalogWrites`에 메서드를 더하지 마라. 이유: 기존 `insertIngredient`가 구성을 받는다.
- 구성 재료를 바꾸거나 지우는 서비스 메서드를 만들지 마라. 이유: 구성은 등록 뒤 바꿀 수 없다(ADR 0011 (e)).
- 합침 재료에 `updateStockTracking`을 막는 규칙을 더하지 마라. 이유: 요구가 없고 기존 잔여 0 조건으로 충분하다.
- `BoardMeal`, `BoardIngredient`, `DailyBrief`의 모양을 바꾸지 마라. 이유: Slack 템플릿은 이 task에서 바뀌지 않는다. AC가 `src/slack`을 baseline과 비교한다.
- 재고 쪽(`stock.service.ts`, `forecast.service.ts`, `alert-settings.service.ts`, `reconcile.service.ts`)에 합침 재료용 분기를 넣지 마라. 이유: 합침 재료는 그 자체가 재고 단위다.
- `src/domain`, `src/infrastructure`, `src/mcp`, `src/slack`을 고치지 마라. 이유: AC가 잡는다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
