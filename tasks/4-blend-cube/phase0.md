# Phase 0: docs

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain
```

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고 status를 `error`로, `error_message`에 `dirty working tree`로 보고하고 멈춰라.

먼저 아래를 읽어라. 이 phase는 이 task 전체의 설계를 문서로 고정하는 일이고, 뒤따르는 phase 여섯 개가 여기서 쓴 ADR 0011을 읽고 구현한다. 문서가 틀리면 구현이 틀린다.

- `AGENTS.md`
- `docs/README.md` (문서 지도. 문서마다 축이 하나이고 같은 내용을 두 문서에 적지 않는다)
- `docs/backlog.md` (마지막 항목 "합침 큐브"가 이 task의 요구다. 첫 항목 "끼니 중량 상한"은 이 task의 범위가 아니다)
- `docs/product-plan.md` 전체. 특히 4.1(재료와 메뉴), 4.4(자동 차감), 4.6(알러지 도입 상태), 4.7(식단 규칙), 6장(도메인 모델 표), 7장(MCP 도구 표), 9장의 "…에서 정한 것" 절들
- `docs/adr/0009-pantry-ingredients-and-expiry-notice.md` (형식의 본보기. 재료에 속성 하나를 더하고 도메인을 연 선례이며, (b)와 (c)의 논거를 이번에도 쓴다)
- `docs/adr/0008-slack-canvas-board.md`의 회차 투영 절
- `docs/user-intervention.md` 전체. 특히 머리의 상태 표와 10번, 11번의 서술 방식
- `src/domain/ingredient/ingredient.ts`, `src/domain/ingredient/ingredient-catalog.ts`, `src/domain/menu/menu.ts`, `src/domain/rules/meal-rules.ts`, `src/domain/deduction/reconcile.ts`(특히 `targetOf`와 그 아래 "Release first" 루프)
- `src/application/feeding-history.ts`, `src/application/composition.ts`, `src/application/menu.service.ts`

## 배경

2026-10-06에 사용자가 Claude Code 대화에서 말했다. 이 발언은 `docs/backlog.md`에서 지워진 뒤 ADR 0011이 유일한 기록이 되므로 날짜와 함께 ADR에 인용하라.

> 이제 앞으로는 쌀+오트밀(30+20) 합쳐서 큐브 만들거야.

쌀 30g과 오트밀 20g을 섞어 큐브 하나(50g)로 얼린다는 뜻이다. 같은 날 두 안을 보고 사용자가 "구성 재료를 가진 합침 재료" 안을 골랐다. 기각된 안은 코드를 바꾸지 않고 `쌀오트밀`을 일반 재료로 등록하는 것이다. 그 안은 `쌀오트밀`이 미도입 재료로 시작해 검증완료가 될 때까지 브리프에 새 재료로 뜨고, 쌀과 오트밀의 급여 이력이 끊기며, 10-30 식단에 있는 미도입 재료 현미를 베이스에 섞는 순간 현미의 도입이 기록되지 않는다.

그날 확인한 상태는 다음과 같다.

- 메뉴 `쌀오트밀죽`은 쌀 큐브 1개와 오트밀 큐브 1개로 풀린다. 재고는 쌀 30g 큐브 4개, 오트밀 10g 큐브 2개다. 10-13까지 16끼 전부가 `쌀오트밀죽`이다. 쌀과 오트밀은 둘 다 검증완료다.
- 재료 하나가 큐브 하나다(`src/domain/ingredient/ingredient.ts`). 배치, 원장, 부족 예측, 임계개수, 재고 알람이 전부 재료 id를 키로 돈다.
- "이 끼니가 무엇을 먹였는가"는 한 함수가 아니다. `expandToCubeNeeds(effectiveComposition(meal), menus)`의 재료 id를 여러 곳이 각자 읽는다: `validateMealPlan`(`src/domain/rules/meal-rules.ts`), `ingredientIdsOf`(`src/application/feeding-history.ts`), `newIngredientsOf`와 `unrecordedReactionsOf`(`src/application/daily-brief.ts`), `exposureMealOf`와 `boardMealOf`(`src/application/household-board.ts`).
- `reconcileMeals`(`src/domain/deduction/reconcile.ts`)는 이관되지 않은 끼니 전부를 **지금의 메뉴 구성**으로 다시 풀어, 초과 소비를 되돌리고 모자란 차감을 새로 한다. 그래서 `update_menu`로 `쌀오트밀죽`의 구성을 바꾸면 적재 범위(`LOOKBACK_DAYS`, 기본 90일) 안의 지난 급여 완료 끼니에서 쌀과 오트밀 소비가 전부 되돌려지고 새 재료의 차감이 보류로 쌓인다. `MenuService.update`에 이를 막는 검사는 없다.

## 작업 내용

문서만 고친다. **코드는 한 줄도 건드리지 않는다.** 아래 다섯 가지를 한다.

### 1. `docs/adr/0011-blend-ingredients.md` 신설

이 task의 중심 문서다. 형식은 ADR 0009와 같게 한다(제목, 상태, 결정일, 맥락, 결정, 층별 결합, 대가와 남는 위험). 제목은 "ADR 0011: 합침 재료는 큐브 하나로 재고를 세고, 급여는 구성 재료로 센다", 결정일은 2026-10-06, 상태는 채택이다. 아래 결정은 이미 정해진 것이므로 새로 정하지 말고 근거를 붙여 서술하라. `writing-docs` 규칙을 따른다: 본문은 최종 상태만 담고, em dash를 쓰지 않으며, 주장마다 코드나 문서 근거를 붙인다.

**(a) 재료에 구성 재료가 생긴다.**

`Ingredient.constituentIngredientIds: readonly string[]`다. 구성 재료가 있는 재료가 합침 재료이고, 일반 재료는 빈 배열이다. 값 예시: 재료 `쌀오트밀`, 분류 베이스, 1회분 50g, 구성 재료 [쌀, 오트밀]. 기획 4.1의 "1회분은 큐브 1개"는 그대로이고, "큐브 하나에 재료 하나"라는 암묵의 전제에 예외가 생긴다.

**(b) 재고는 합침 재료 그대로 세고, 급여는 구성 재료로 푼다. 푸는 일은 도메인이 한다.**

합침 재료는 그 자체가 재고 단위다. 조리 배치, 원장, 자동 차감, 부족 예측, 임계개수, 재고 알람, 재고 표는 합침 재료 id로 지금 코드 그대로 돈다. `src/domain/stock`, `src/domain/deduction`, `src/domain/forecast`는 바뀌지 않는다.

바뀌는 것은 "무엇을 먹였는가" 쪽이다. 합침 재료를 먹인 급여는 구성 재료를 먹인 급여다. 도입 상태(4.6), 회차 투영(ADR 0008), 식단 규칙 검증(4.7), 새 재료 관찰과 미기록 반응(5장)이 모두 구성 재료로 센다. 한 끼에 합침 재료와 그 구성 재료가 함께 있어도 그 재료의 급여는 한 번이다.

도메인에 더하는 것은 셋이다. `IngredientCatalog.eatenIngredientIds(id)`(합침 재료면 구성 재료, 아니면 자기 자신), `expandToEatenIngredientIds(composition, menus, catalog)`(`src/domain/menu/menu.ts`, 중복 없는 재료 id), 그리고 `validateMealPlan`이 그 함수를 쓰는 것이다.

동결된 도메인을 여는 이유를 적어라. `Ingredient` 타입과 `validateMealPlan`이 도메인에 있고, `validateMealPlan`은 `Meal`과 `menus`를 받아 안에서 풀기 때문에 호출자가 미리 풀어 넘길 수 없다. 애플리케이션 다섯 곳이 각자 풀면 같은 규칙이 다섯 번 쓰인다. ADR 0009가 상비 제외를 도메인에 둔 것과 같은 이유다.

**(c) 합침 재료 자체는 도입 상태가 없다.**

지켜볼 대상은 구성 재료다. `introductionStatuses`는 합침 재료를 결과에서 뺀다. `get_ingredient_introduction_status`는 재료 목록 조회를 겸하므로(7장) 합침 재료도 한 줄로 돌려주되, 상태 자리에 `{ kind: 'blend', constituentNames: ['쌀', '오트밀'] }`을 준다. 일반 재료 행의 모양은 바뀌지 않는다.

거부 둘이 따라온다. 반응 기록에 합침 재료 이름이 오면 구성 재료 이름을 일러 주며 거부한다(`BLEND_HAS_NO_REACTION`). 금지 조합에 합침 재료가 오면 거부한다(`BLEND_IN_PAIRING`). 규칙 검증이 풀린 id로만 보므로 합침 재료를 넣은 조합은 조용히 영영 걸리지 않는 규칙이 되기 때문이다.

**(d) 합침 재료는 메뉴 구성으로만 쓴다.**

토핑으로 넣으면 `resolveComposition`이 `BLEND_AS_TOPPING`으로 거부한다. 상태판 달력은 베이스 칸에서 `watchedBaseIngredients`를 구성 재료로 풀어 `쌀현미오트밀죽 (현미 ①)`처럼 지금 양식 그대로 보인다(`src/slack/templates/calendar-grid.ts`의 `baseText`). 토핑 칸에는 구성 재료를 보일 자리가 없어서, 토핑을 허용하고 그리지 않으면 회차 표시가 조용히 빠진다. "토핑은 그런 큐브(고기와 채소를 섞은 큐브 같은 것)를 실제로 만들 때 연다"를 적어라. Slack 템플릿과 `BoardMeal`, `BoardIngredient`의 모양은 바뀌지 않는다.

**(e) 등록 도구와 구조 규칙.**

`register_blend_ingredient(idempotencyKey, name, aliases?, category, servingWeightGram, constituentNames)`를 7장 재료 도구에 더한다. `register_ingredient`에 인자를 더하지 않는 이유는 ADR 0009 (c)와 같다. `verifiedBeforeMigration`은 합침 재료에 뜻이 없고 `constituentNames`는 일반 재료에 뜻이 없어서, 한 도구에 두면 인자끼리 교차 검증이 생긴다.

구조 규칙은 `IngredientCatalog` 생성자가 검증한다(`INVALID_BLEND`). 구성 재료는 둘 이상이고, 서로 다르고, 등록된 재료이며, 자기 자신이 아니고, 다시 합침 재료가 아니다. 이름과 별칭 충돌을 생성자가 던지는 것과 같은 자리다.

구성은 등록한 뒤 바꿀 수 없다. 도구가 없다. 배합이 바뀌면 다른 큐브이므로 새 합침 재료를 등록한다. 구성을 바꾸면 과거 급여가 어느 재료의 급여였는지가 소급해 바뀐다.

합침 재료를 상비로 바꾸는 것은 따로 막지 않는다. 기존 `update_ingredient_stock_tracking`의 잔여 0 조건이 그대로 걸리고, 상비가 된 합침 재료는 차감만 빠지며 구성 재료의 급여는 그대로 세진다.

**(f) 구성 재료별 중량은 저장하지 않는다.**

쌀 30g, 오트밀 20g이라는 분할을 읽는 곳이 없다. 차감은 합침 재료의 1회분 중량 50g과 배치의 큐브 중량으로 하고, 백로그의 끼니 중량 상한도 1회분 중량의 합이라 50으로 족하다. 저장하면 "분할의 합 = 1회분 중량"이라는 불변식과, `update_ingredient_serving_weight` 때 분할을 다시 받는 경로가 따라온다.

**(g) 기존 메뉴의 구성은 바꾸지 않는다. 전환은 새 메뉴로 한다.**

위 배경의 `reconcileMeals` 재전개를 근거로 적어라. 기존 `쌀오트밀죽`은 지난 끼니가 가리키므로 [쌀 1, 오트밀 1] 그대로 두고, 새 메뉴 `쌀오트밀합침죽`(구성 [쌀오트밀 1])을 등록해 낱개 큐브가 끝나는 날부터의 예정 식단을 그 메뉴로 옮긴다. 이름에 괄호를 쓰지 않는 이유는 식단표 가져오기가 괄호를 메모로 읽기 때문이다(4.1).

백로그 문장은 "쌀오트밀죽이 합침 큐브 1개로 풀린다"였다. 그대로 하지 않는 이유가 이 절이다. `update_menu`에 과거 재계산을 막는 검사를 넣지 않는 이유도 적어라. 재전개는 정합화의 성질이고(4.4 "상태가 규칙과 다른 식단만 골라 새로 차감하거나 되돌리므로"), 막으면 잘못 등록한 구성을 고치는 경로가 막힌다. 대신 `update_menu` 도구 설명에 "조리 방식이 바뀐 것이면 새 메뉴를 등록한다"를 적는다.

**(h) 테이블과 되돌림.**

`ingredient_constituent(blend_ingredient_id, constituent_ingredient_id)`다. 기본키는 두 컬럼이고, 둘 다 `ingredient`를 가리키며, CHECK가 자기 자신을 막는다. `menu_component`와 같은 모양이다. 구성 재료 목록은 부모가 정하는 마스터 데이터라 계산으로 얻을 수 없다(AGENTS.md 금지 3번에 해당하지 않는다).

기존 행을 바꾸지 않는 순수 추가 마이그레이션이다. 되돌림은 `DROP TABLE "ingredient_constituent"`이고, 그때 합침 재료는 구성 재료 없는 일반 재료로 남아 재고와 원장은 잃지 않는다.

**(i) 층별 결합.**

ADR 0009의 같은 절처럼 그림 하나와 층마다 한 문단을 쓴다. 도메인은 재료 속성 하나, 카탈로그 검증과 메서드 하나, 풀이 함수 하나를 더하고 재고 쪽 세 디렉터리는 그대로다. 애플리케이션은 `IngredientService.registerBlend`를 더하고 급여를 세는 다섯 곳이 도메인 함수를 쓴다. 포트는 늘지 않는다(`IngredientDraft`가 `Omit<Ingredient, 'id'>`라 기존 `insertIngredient`가 구성을 받는다). 영속화는 테이블 하나를 읽고 쓴다. MCP는 도구 하나를 더한다. Slack과 스케줄러는 바뀌지 않는다.

**(j) 대가와 남는 위험.**

최소한 아래를 적어라. 없는 위험을 지어내지 마라.

- 구성 재료별 급여량(g)은 원장에서 알 수 없다. "오트밀을 몇 번 먹였는가"는 급여 이력으로 알지만 "몇 g"은 알 수 없다. ADR 0009가 상비 재료에서 받아들인 것과 같은 종류의 대가다.
- 잘못 등록한 합침 재료는 도구로 고칠 수 없다. 구성 변경, 재료 삭제, 재료 개명 도구가 없다.
- `update_menu`로 기존 메뉴의 구성을 바꾸면 과거가 다시 계산되는 위험은 그대로 남는다. 막는 것은 도구 설명과 `docs/user-intervention.md` 12번의 절차뿐이다.
- 전환 뒤 쌀과 오트밀은 식단에 없지만 임계개수 4가 걸려 있어, 설정에서 빼지 않으면 재고 알람의 임계개수 이하 표에 계속 나온다(12번).
- 합침 재료를 토핑으로 쓸 수 없다.
- 배포와 마이그레이션 사이에는 상태 적재가 없는 테이블을 읽어 실패한다(12번).

### 2. `docs/product-plan.md` 수정

- 4.1: 상비 재료 문단 뒤에 합침 재료 문단 하나. 두 재료 이상을 섞어 큐브 하나로 만든 재료이고, 재고는 합침 재료 하나로 세며, 먹인 것은 구성 재료로 센다. 메뉴 구성으로만 쓰고 토핑으로는 쓰지 않는다. 메뉴 문단의 예시에 `쌀오트밀합침죽`은 쌀오트밀 큐브 1개로 풀린다는 한 문장을 더한다. ADR 0011을 가리킨다.
- 4.6: 합침 재료의 급여는 구성 재료의 급여이고 합침 재료 자체는 도입 상태가 없다는 한 문단.
- 4.7: 제약 목록 아래에 금지 조합에는 합침 재료를 넣을 수 없다는 한 문장.
- 6장 표: 재료 행에 "구성 재료 [쌀, 오트밀](합침 재료만)"을 더한다.
- 7장 표: 재료 행에 `register_blend_ingredient`를 더한다.
- 9장: "### 재고 알람에서 정한 것" 뒤, "## 10. 미정 사항" 앞에 "### 합침 재료에서 정한 것" 절을 기존 절들과 같은 분량과 문체로 더하고 ADR 0011을 가리킨다. 9장 단계 표에는 행을 더하지 않는다.

### 3. `README.md`의 문서 표

`docs/adr/0010-stock-alert-message.md` 행 아래에 `docs/adr/0011-blend-ingredients.md` 행을 더한다. 내용 칸은 "구성 재료를 가진 합침 재료, 재고는 큐브 하나로 급여는 구성 재료로"다.

### 4. `docs/user-intervention.md`에 12번 추가

머리 문단의 "11번은 재고 알람(ADR 0010)이 더한 일이다" 뒤에 12번이 합침 재료(ADR 0011)가 더한 일이라는 문장을 잇고, 상태 표에 12번 행(일: "합침 재료 마이그레이션과 쌀오트밀 전환", 상태: "안 함")을 더한다. 11번 뒤에 "## 12. 합침 재료 마이그레이션을 적용하고 쌀오트밀로 전환한다" 절을 더한다. 10번, 11번과 같은 서술 방식이고 체크박스는 아래 순서다.

1. 배포 직후 바로 운영 컨테이너에서 `railway ssh "cd /app && pnpm db:deploy"`로 `ingredient_constituent` 마이그레이션을 적용한다. 그 전에는 상태 적재가 실패해 정합화와 브리프가 멈춘다는 것을 그대로 적어라(6번이 말하듯 배포 전 명령이 아직 없다).
2. Claude Code에서 `register_blend_ingredient`로 `쌀오트밀`을 등록한다. 분류 base, 1회분 50g, 구성 재료 쌀과 오트밀.
3. `register_menu`로 `쌀오트밀합침죽`(쌀오트밀 1개)을 등록한다. **`update_menu`로 기존 `쌀오트밀죽`의 구성을 바꾸지 않는다.** 바꾸면 지난 끼니의 쌀과 오트밀 차감이 전부 되돌려진다(ADR 0011).
4. 합침 큐브를 만든 날 `register_cooked_batch`로 `쌀오트밀` 50g 배치를 입고한다.
5. 낱개 쌀 큐브와 오트밀 큐브가 끝나는 날부터의 예정 식단을 `update_planned_meal`로 `쌀오트밀합침죽`으로 옮긴다. 남는 낱개 큐브는 실사 조정이나 폐기로 정리한다.
6. `get_alert_settings`로 읽은 뒤 `update_alert_settings`로 임계개수에서 쌀과 오트밀을 빼고 쌀오트밀을 넣는다. 통째로 갈아 끼우는 도구라 읽지 않고 쓰면 설정이 지워진다(기획 7장).

이 작업이 사람 몫인 이유도 적어라. 마이그레이션은 운영 DB에 쓰는 일이고, 언제 합침 큐브를 만들고 낱개 큐브가 언제 끝나는지는 냉동고를 보는 사람만 안다.

### 5. `docs/backlog.md`

"합침 큐브"로 시작하는 항목 한 줄을 지운다. "끼니 중량 상한" 항목과 머리 문단은 건드리지 않는다.

## Acceptance Criteria

```bash
python3 scripts/harness/check_docs.py
ls docs/adr/0011-blend-ingredients.md
grep -q 'reconcileMeals' docs/adr/0011-blend-ingredients.md
grep -q 'DROP TABLE' docs/adr/0011-blend-ingredients.md
grep -q 'BLEND_AS_TOPPING' docs/adr/0011-blend-ingredients.md
grep -q '0011-blend-ingredients' README.md
grep -q 'register_blend_ingredient' docs/product-plan.md
grep -q '합침 재료에서 정한 것' docs/product-plan.md
grep -q '^## 12\.' docs/user-intervention.md
grep -q '쌀오트밀합침죽' docs/user-intervention.md
! grep -q '합침 큐브:' docs/backlog.md
grep -q '끼니 중량 상한' docs/backlog.md
git diff --quiet "$HARNESS_BASELINE" -- src prisma test package.json
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- 코드, 스키마, 테스트를 고치지 마라. 이유: 이 phase는 문서만 고친다. AC의 마지막 줄이 잡는다.
- 위에 적힌 결정을 바꾸거나 새 결정을 더하지 마라. 이유: tech-critic-lead가 승인한 범위가 위 (a)~(j)다. 다른 판단이 필요해 보이면 구현하지 말고 보고의 `summary`에 `충돌:`로 적어라.
- ADR 0011에 구성 재료별 중량 컬럼, 합침 재료 토핑, 구성 변경 도구를 "나중에 할 일"로 설계해 두지 마라. 이유: 하지 않기로 한 것은 하지 않는 이유만 적는다.
- 다른 ADR(0001~0010)의 본문을 고치지 마라. 이유: 이번에 뒤집히는 결정이 없다.
- `docs/user-intervention.md`의 11번 이하 기존 항목을 고치지 마라. 이유: 끝난 항목도 지우지 않는 문서다.
- 새 `.md` 파일을 `docs/adr/0011-blend-ingredients.md` 외에 만들지 마라. 이유: `scripts/doc-paths.json` 허용 목록 밖이면 문서 검사가 실패한다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
