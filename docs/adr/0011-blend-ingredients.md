# ADR 0011: 합침 재료는 큐브 하나로 재고를 세고, 급여는 구성 재료로 센다

- 상태: 채택
- 결정일: 2026-10-06

## 맥락

2026-10-06에 사용자가 Claude Code 대화에서 "이제 앞으로는 쌀+오트밀(30+20) 합쳐서 큐브 만들거야."라고 했다. 쌀 30g과 오트밀 20g을 섞어 큐브 하나(50g)로 얼린다는 뜻이다. 이 요구는 `docs/backlog.md`에 적혔다가 이 ADR로 옮겨졌으므로 발언은 여기에만 남는다.

그날의 상태는 이렇다. 메뉴 `쌀오트밀죽`은 쌀 큐브 1개와 오트밀 큐브 1개로 풀린다. 재고는 쌀 30g 큐브 4개와 오트밀 10g 큐브 2개이고, 10-13까지 16끼 전부가 `쌀오트밀죽`이다. 쌀과 오트밀은 둘 다 검증완료다.

지금 모델에서는 재료 하나가 큐브 하나다. `Ingredient`의 `servingWeightGram`이 "One serving is one cube"이고(`src/domain/ingredient/ingredient.ts`), 조리 배치, 원장, 부족 예측, 임계개수, 재고 알람이 전부 재료 id를 키로 돈다. 두 재료를 섞은 큐브를 표현할 자리가 없다.

"이 끼니가 무엇을 먹였는가"도 한 함수가 아니다. `expandToCubeNeeds(effectiveComposition(meal), menus)`가 돌려준 재료 id를 여러 곳이 각자 읽는다. 도메인의 `validateMealPlan`(`src/domain/rules/meal-rules.ts`)과 애플리케이션의 다섯 곳이다. `ingredientIdsOf`(`src/application/feeding-history.ts`), `newIngredientsOf`와 `unrecordedReactionsOf`(`src/application/daily-brief.ts`), `exposureMealOf`와 `boardMealOf`(`src/application/household-board.ts`)다. 차감할 큐브의 재료와 먹인 재료가 지금까지는 같은 id였기 때문에 한 함수로 족했다.

같은 날 사용자는 두 안을 보고 "구성 재료를 가진 합침 재료" 안을 골랐다. 기각된 안은 코드를 바꾸지 않고 `쌀오트밀`을 일반 재료로 등록하는 것이다. 그 안에서는 `쌀오트밀`이 미도입 재료로 시작해 검증완료가 될 때까지 브리프에 새 재료로 뜨고, 쌀과 오트밀의 급여 이력이 그날로 끊긴다. 그리고 10-30 식단에 있는 미도입 재료 현미를 베이스에 섞는 순간 현미의 도입이 어디에도 기록되지 않는다. 도입 상태는 알러지 확인을 위한 것인데(기획안 4.6절) 실제로 처음 먹인 재료가 이력에서 빠진다.

정할 것은 여덟이다. 합침 재료를 도메인 모델에 어떻게 두는지, 재고와 급여를 각각 무엇으로 세고 어느 층이 푸는지, 합침 재료의 도입 상태, 합침 재료를 쓸 수 있는 자리, 등록 도구와 구조 규칙, 구성 재료별 중량을 저장하는지, 기존 메뉴에서 어떻게 전환하는지, 테이블과 되돌림이다.

## 결정

### 재료에 구성 재료가 생긴다

`Ingredient`에 `constituentIngredientIds: readonly string[]`를 둔다(`src/domain/ingredient/ingredient.ts`). 구성 재료가 있는 재료가 합침 재료이고, 일반 재료는 빈 배열이다. 값 예시는 재료 `쌀오트밀`, 분류 베이스, 1회분 50g, 구성 재료 [쌀, 오트밀]이다.

기획안 4.1절의 "1회분은 큐브 1개"는 그대로다. 합침 재료도 1회분이 큐브 1개다. 예외가 생기는 것은 "큐브 하나에 재료 하나"라는 암묵의 전제이고, 그 예외를 4.1절에 적는다.

### 재고는 합침 재료 그대로 세고, 급여는 구성 재료로 푼다

합침 재료는 그 자체가 재고 단위다. 냉동고에 있는 것은 `쌀오트밀` 큐브이지 쌀 큐브와 오트밀 큐브가 아니다. 조리 배치, 원장, 자동 차감, 부족 예측, 임계개수, 재고 알람, 재고 표는 합침 재료 id로 지금 코드 그대로 돈다. `src/domain/stock`, `src/domain/deduction`, `src/domain/forecast`는 바뀌지 않는다. 세 디렉터리는 재료 id와 큐브 수만 보고, 그 재료가 무엇으로 만들어졌는지를 읽지 않기 때문이다.

바뀌는 것은 "무엇을 먹였는가" 쪽이다. 합침 재료를 먹인 급여는 구성 재료를 먹인 급여다. 도입 상태(기획안 4.6절), 회차 투영(ADR 0008), 식단 규칙 검증(4.7절), 브리프의 새 재료 관찰과 미기록 반응(5장)이 모두 구성 재료로 센다. 한 끼에 합침 재료와 그 구성 재료가 함께 있어도 그 재료의 급여는 한 번이다. `쌀오트밀합침죽`에 쌀이 든 다른 큐브를 더해도 쌀의 회차는 그 끼니에 하나만 오른다.

푸는 일은 도메인이 한다. 도메인에 더하는 것은 셋이다.

- `IngredientCatalog.eatenIngredientIds(id)`: 합침 재료면 구성 재료 id를, 아니면 자기 자신을 돌려준다(`src/domain/ingredient/ingredient-catalog.ts`).
- `expandToEatenIngredientIds(composition, menus, catalog)`: 끼니 구성을 먹인 재료 id로 푼다. 결과에 중복이 없다(`src/domain/menu/menu.ts`). 큐브 수를 돌려주는 `expandToCubeNeeds`는 그대로 남아 차감과 예측이 쓴다.
- `validateMealPlan`이 `expandToCubeNeeds` 대신 그 함수를 쓴다(`src/domain/rules/meal-rules.ts`).

`src/domain`은 `harness.json`의 동결 경로다. 여는 이유는 둘이다. `Ingredient` 타입과 `validateMealPlan`이 도메인에 있다. 그리고 `validateMealPlan`은 `Meal`과 `menus`를 받아 안에서 풀기 때문에, 호출자가 미리 풀어 넘길 수 없다. 애플리케이션에만 두면 위 다섯 곳이 각자 풀어 같은 규칙이 다섯 번 쓰이고, 도메인의 규칙 검증만 합침 재료를 그대로 보게 된다. ADR 0009가 상비 제외를 호출자가 아니라 도메인에 둔 것과 같은 이유다.

### 합침 재료 자체는 도입 상태가 없다

지켜볼 대상은 구성 재료다. 반응이 나오면 원인은 쌀이나 오트밀이지 `쌀오트밀`이라는 큐브가 아니다. `introductionStatuses`(`src/application/feeding-history.ts`)는 합침 재료를 결과에서 뺀다. 합침 재료에 상태를 주면 급여가 구성 재료로만 세지므로 영영 미도입으로 남아 브리프에 새 재료로 뜬다.

`get_ingredient_introduction_status`는 재료 목록 조회를 겸한다(기획안 7장). 그래서 합침 재료도 한 줄로 돌려주되, 상태 자리에 `{ kind: 'blend', constituentNames: ['쌀', '오트밀'] }`을 준다. 일반 재료 행의 모양은 바뀌지 않는다.

거부 둘이 따라온다.

- 반응 기록(`record_feeding_reaction`)에 합침 재료 이름이 오면 `BLEND_HAS_NO_REACTION`으로 거부하고, 오류 문장이 구성 재료 이름을 일러 준다. 반응은 구성 재료마다 기록한다.
- 금지 조합(`update_meal_planning_rules`)에 합침 재료가 오면 `BLEND_IN_PAIRING`으로 거부한다. 규칙 검증이 풀린 id로만 보므로, 합침 재료를 넣은 조합은 오류 없이 저장되고 영영 걸리지 않는 규칙이 된다.

### 합침 재료는 메뉴 구성으로만 쓴다

합침 재료는 메뉴의 구성 재료로만 들어간다. 식단의 토핑으로 넣으면 `resolveComposition`(`src/application/composition.ts`)이 `BLEND_AS_TOPPING`으로 거부한다. 식단 수정과 식단표 가져오기가 이 함수를 함께 쓰므로 두 경로가 같이 막힌다.

이유는 상태판 달력의 양식이다. 달력의 베이스 칸은 메뉴 이름 뒤에 지켜볼 재료와 회차를 괄호로 붙인다(`src/slack/templates/calendar-grid.ts`의 `baseText`). 애플리케이션이 `watchedBaseIngredients`를 구성 재료로 풀어 채우면 `쌀현미오트밀죽 (현미 ①)`처럼 지금 양식 그대로 보인다. 토핑 칸은 재료 하나를 한 칸에 보이므로 구성 재료를 보일 자리가 없다. 토핑을 허용하고 그리지 않으면 첫 도입 재료의 회차 표시가 오류 없이 빠진다.

토핑은 그런 큐브(고기와 채소를 섞은 큐브 같은 것)를 실제로 만들 때 연다. 지금 만드는 합침 큐브는 베이스 하나다. Slack 템플릿과 `BoardMeal`, `BoardIngredient`의 모양은 바뀌지 않는다.

### 등록은 별도 도구로 하고, 구조 규칙은 카탈로그가 검증한다

기획안 7장의 재료 도구에 `register_blend_ingredient(idempotencyKey, name, aliases?, category, servingWeightGram, constituentNames)`를 더한다.

`register_ingredient`에 인자를 더하지 않는다. ADR 0009가 상비 전환을 별도 도구로 둔 것과 같은 이유다. `verifiedBeforeMigration`은 합침 재료에 뜻이 없고(도입 상태가 없다), `constituentNames`는 일반 재료에 뜻이 없다. 한 도구에 두면 "구성 재료가 있으면 검증 플래그를 줄 수 없다" 같은 인자끼리의 교차 검증이 생긴다.

구조 규칙은 `IngredientCatalog` 생성자가 검증하고 어기면 `INVALID_BLEND`를 던진다. 구성 재료는 둘 이상이고, 서로 다르고, 등록된 재료이며, 자기 자신이 아니고, 다시 합침 재료가 아니다. 생성자는 이미 이름과 별칭 충돌을 `DUPLICATE_INGREDIENT_NAME`으로 던지는 자리다. 카탈로그를 만들 수 있으면 구조가 맞다는 뜻이 되므로, `eatenIngredientIds`는 한 단계만 풀면 되고 순환을 걱정하지 않는다.

구성은 등록한 뒤 바꿀 수 없다. 바꾸는 도구가 없다. 배합이 바뀌면 다른 큐브이므로 새 합침 재료를 등록한다. 구성을 바꾸면 과거 급여가 어느 재료의 급여였는지가 소급해 바뀐다. 급여 이력은 끼니와 지금의 구성에서 계산되기 때문이다.

합침 재료를 상비로 바꾸는 것은 따로 막지 않는다. 기존 `update_ingredient_stock_tracking`의 잔여 0 조건(`PANTRY_WITH_STOCK`, ADR 0009)이 그대로 걸린다. 상비가 된 합침 재료는 차감만 빠지고 구성 재료의 급여는 그대로 세진다.

### 구성 재료별 중량은 저장하지 않는다

쌀 30g, 오트밀 20g이라는 분할을 읽는 곳이 없다. 차감은 합침 재료의 1회분 중량 50g과 배치의 큐브 중량이 같은지로 하고(기획안 4.4절), `docs/backlog.md`의 끼니 중량 상한도 1회분 중량의 합이라 50으로 족하다.

저장하면 따라오는 것이 둘이다. "분할의 합 = 1회분 중량"이라는 불변식과, `update_ingredient_serving_weight`로 1회분 중량을 바꿀 때 분할을 다시 받는 경로다. 읽는 곳이 없는 값을 위해 둘을 유지하지 않는다.

### 기존 메뉴의 구성은 바꾸지 않고, 전환은 새 메뉴로 한다

기존 `쌀오트밀죽`은 [쌀 1, 오트밀 1] 그대로 둔다. 새 메뉴 `쌀오트밀합침죽`(구성 [쌀오트밀 1])을 등록하고, 낱개 큐브가 끝나는 날부터의 예정 식단을 그 메뉴로 옮긴다. 이름에 괄호를 쓰지 않는 이유는 식단표 가져오기가 괄호를 메모로 읽기 때문이다(기획안 4.1절).

백로그의 문장은 "쌀오트밀죽이 합침 큐브 1개로 풀린다"였다. 그대로 하지 않는 이유는 `reconcileMeals`(`src/domain/deduction/reconcile.ts`)다. 이 함수는 이관되지 않은 끼니 전부를 지금의 메뉴 구성으로 다시 푼다. `targetOf`가 `expandToCubeNeeds(effectiveComposition(state.meal), input.menus)`를 목표로 삼고, 그 아래 "Release first" 루프가 목표를 넘는 소비를 되돌린 뒤 모자란 차감을 새로 한다. 끼니는 메뉴 id를 가리킬 뿐 먹인 날의 구성을 따로 갖지 않는다.

그래서 `update_menu`로 `쌀오트밀죽`의 구성을 [쌀오트밀 1]로 바꾸면, 적재 범위(`LOOKBACK_DAYS`, 기본 90일) 안의 지난 급여 완료 끼니에서 쌀과 오트밀 소비가 전부 되돌려진다. 이미 먹은 큐브가 재고로 돌아온다. 그리고 그 끼니마다 `쌀오트밀` 차감이 새로 걸리는데, 합침 큐브는 그 끼니보다 뒤에 만들어 조리일 조건(4.4절)에 맞는 배치가 없으므로 전부 보류로 쌓인다. 메뉴를 새로 두면 지난 끼니는 옛 메뉴를 가리킨 채 그대로이고, 옮긴 예정 식단만 합침 큐브로 풀린다.

`update_menu`에 과거 재계산을 막는 검사를 넣지 않는다. `MenuService.update`(`src/application/menu.service.ts`)에 지금 그런 검사가 없고, 더하지도 않는다. 재전개는 정합화의 성질이다. 기획안 4.4절의 "상태가 규칙과 다른 식단만 골라 새로 차감하거나 되돌리므로"가 메뉴 구성에도 그대로 적용된 것이다. 막으면 잘못 등록한 구성을 고치는 경로가 막힌다. 큐브 수를 틀리게 등록한 메뉴를 고치면 지난 끼니의 차감이 따라 고쳐지는 것이 바로 이 성질이다. 대신 `update_menu` 도구 설명에 "조리 방식이 바뀐 것이면 새 메뉴를 등록한다"를 적는다.

### 테이블은 하나를 더하고, 되돌림은 그 테이블을 지우는 것이다

`ingredient_constituent(blend_ingredient_id, constituent_ingredient_id)`를 더한다. 기본키는 두 컬럼이고, 둘 다 `ingredient`를 가리키며, CHECK가 자기 자신을 막는다. 메뉴와 구성 재료를 잇는 `menu_component`(`prisma/schema.prisma`)와 같은 모양이다.

구성 재료 목록은 부모가 정하는 마스터 데이터라 계산으로 얻을 수 없다. AGENTS.md 금지 3번(계산으로 얻을 수 있는 상태를 저장하지 않는다)에 해당하지 않는다.

기존 행을 바꾸지 않는 순수 추가 마이그레이션이다. 되돌림은 `DROP TABLE "ingredient_constituent"`이다. 그때 합침 재료는 구성 재료 없는 일반 재료로 남는다. 배치와 원장이 합침 재료 id에 달려 있으므로 재고와 원장은 잃지 않는다.

## 층별 결합

```
domain      Ingredient.constituentIngredientIds
            IngredientCatalog: 구조 검증(INVALID_BLEND), eatenIngredientIds(id)
            expandToEatenIngredientIds(composition, menus, catalog) ← validateMealPlan
            stock · deduction · forecast 는 그대로
                │
application IngredientService.registerBlend
            급여를 세는 다섯 곳이 expandToEatenIngredientIds를 쓴다
            resolveComposition 이 토핑의 합침 재료를 거부한다
                │
persistence ingredient_constituent 를 읽고 쓴다
mcp         register_blend_ingredient, get_ingredient_introduction_status 의 blend 행
slack       바뀌지 않는다
scheduler   바뀌지 않는다
```

도메인은 재료 속성 하나(`constituentIngredientIds`), 카탈로그의 구조 검증과 메서드 하나(`eatenIngredientIds`), 풀이 함수 하나(`expandToEatenIngredientIds`)를 더한다. 프레임워크, DB, 시계를 여전히 모른다. 재고 쪽 세 디렉터리(`src/domain/stock`, `src/domain/deduction`, `src/domain/forecast`)는 합침 재료를 일반 재료와 구분하지 않으므로 그대로다. 도메인 안에서 먹인 재료를 읽는 곳은 `validateMealPlan` 하나이고 그것만 새 함수로 바뀐다.

애플리케이션은 `IngredientService.registerBlend`를 더하고, 급여를 세는 다섯 곳(`ingredientIdsOf`, `newIngredientsOf`, `unrecordedReactionsOf`, `exposureMealOf`, `boardMealOf`)이 도메인 함수를 쓴다. 다섯 곳 어디에도 "합침 재료면"이라는 분기가 생기지 않는다. 포트는 늘지 않는다. `IngredientDraft`가 `Omit<Ingredient, 'id'>`에서 나오므로(`src/application/ports/household-write.port.ts`) 기존 `insertIngredient`가 구성을 함께 받는다.

영속화는 테이블 하나(`ingredient_constituent`)를 읽고 쓴다. 재료를 적재할 때 구성 재료 id를 채우고, 재료를 넣을 때 구성 행을 함께 넣는다.

MCP는 도구 하나(`register_blend_ingredient`)를 더하고, `get_ingredient_introduction_status`가 합침 재료 행에 `blend` 상태를 준다. `update_menu`의 도구 설명에 한 문장이 는다.

Slack과 스케줄러는 바뀌지 않는다. 템플릿은 읽기 모델만 읽고, 읽기 모델의 모양(`BoardMeal`, `BoardIngredient`)이 그대로이기 때문이다. 합침 재료의 재고 행과 재고 알람 항목은 일반 재료와 같은 경로로 나온다.

## 대가와 남는 위험

- 구성 재료별 급여량(g)은 원장에서 알 수 없다. "오트밀을 몇 번 먹였는가"는 급여 이력으로 알지만 "몇 g"은 알 수 없다. 원장에는 `쌀오트밀` 큐브의 소비만 남고 분할은 저장하지 않기 때문이다. ADR 0009가 상비 재료에서 받아들인 것과 같은 종류의 대가다.
- 잘못 등록한 합침 재료는 도구로 고칠 수 없다. 구성 변경, 재료 삭제, 재료 개명 도구가 없다. 구성을 틀리게 등록했으면 다른 이름으로 새 합침 재료를 등록하고 틀린 것은 쓰지 않는다.
- `update_menu`로 기존 메뉴의 구성을 바꾸면 과거가 다시 계산되는 위험은 그대로 남는다. 막는 것은 `update_menu`의 도구 설명과 `docs/user-intervention.md` 12번의 절차뿐이다.
- 전환 뒤 쌀과 오트밀은 식단에 없지만 임계개수 4가 걸려 있다. 설정에서 빼지 않으면 재고 알람의 임계개수 이하 표에 계속 나온다(`docs/user-intervention.md` 12번).
- 합침 재료를 토핑으로 쓸 수 없다. 고기와 채소를 섞은 큐브처럼 토핑으로 먹일 합침 큐브는 지금 등록해도 식단에 넣지 못한다.
- 배포와 마이그레이션 사이에는 상태 적재가 없는 테이블을 읽어 실패한다. 배포 전 명령이 아직 설정되지 않아(`docs/user-intervention.md` 6번) 마이그레이션을 사람이 배포 직후에 돌린다(12번).
