# Phase 5: mcp

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md` (계층 절. `src/mcp`는 어댑터다. 재고 규칙을 다시 구현하지 않고 애플리케이션 서비스를 호출한다)
- `tasks/4-blend-cube/docs-diff.md` (기획 7장의 재료 도구 행, ADR 0011의 (c), (e), (g))
- `docs/adr/0004-mcp-server-and-auth.md`
- `src/mcp/tools/ingredient.tools.ts`, `src/mcp/tools/reaction.tools.ts`(`get_ingredient_introduction_status`), `src/mcp/tools/menu.tools.ts`(`update_menu`), `src/mcp/tools/schemas.ts`, `src/mcp/tool-result.ts`
- `src/application/ingredient.service.ts`의 `RegisterBlendCommand`와 `registerBlend`, `src/application/reaction.service.ts`의 `IngredientIntroduction`과 `BlendIntroduction` (phase 4가 더했다. 읽기만 한다)
- `test/integration/mcp-tools.int-spec.ts` (맨 위의 `EXPECTED_TOOLS`, `call`과 `callExpectingError` 헬퍼, `describe('도구 목록', …)`)

시작하기 전에 `pnpm prisma:generate`를 돌려라.

## 동결 경로에 대하여

이 phase는 `src/domain/`을 고치지 않는다. `index.json`에 `unfreeze: ["src/domain/"]`가 있는 이유는 러너가 동결 경로를 task의 baseline과 비교하기 때문이다. AC의 `git diff --quiet HEAD -- src/domain`이 이 phase가 도메인을 건드리지 않았음을 확인한다.

## 작업 내용

### 1. `register_blend_ingredient` 도구

`src/mcp/tools/ingredient.tools.ts`에 `register_ingredient` 다음 자리에 더한다. 입력은 `idempotencyKey`, `name`, `aliases`(선택), `category`, `servingWeightGram`(양의 정수), `constituentNames`(문자열 배열, 둘 이상)다. `deps.ingredient.registerBlend({ ...caller, ...args })`를 부른다.

제목은 "합침 재료 등록"이다. 설명에는 아래를 담는다. 소비자가 LLM이므로 언제 쓰는지와 무엇이 달라지는지를 적는다.

- 두 재료 이상을 섞어 큐브 하나로 만든 재료를 등록한다(예: 쌀 30g과 오트밀 20g을 섞은 50g 큐브 "쌀오트밀").
- 재고, 차감, 부족 예측, 임계개수는 합침 재료 하나로 세고, 도입 상태와 반응 기록은 구성 재료로 센다.
- `servingWeightGram`은 섞은 큐브 하나의 중량이다.
- 메뉴 구성으로만 쓸 수 있고 토핑으로는 넣을 수 없다. 구성 재료는 먼저 등록되어 있어야 하고 등록한 뒤에는 바꿀 수 없다.

결과는 `register_ingredient`와 같이 서비스가 돌려준 재료를 그대로 준다. 구성 재료는 `constituentIngredientIds`의 id로 나가고, 이름은 `get_ingredient_introduction_status`가 준다.

### 2. `get_ingredient_introduction_status`

`src/mcp/tools/reaction.tools.ts`의 출력 매핑은 `status: entry.status`를 그대로 넘기므로 합침 재료 행은 `status: { kind: 'blend', constituentNames: [...] }`로 나간다. 코드가 그대로면 고치지 않는다. 설명에 한 문장을 더한다: 합침 재료는 도입 상태 대신 `blend`와 구성 재료 이름으로 나오고, 지켜볼 대상은 구성 재료다.

**일반 재료 행의 출력 모양은 바꾸지 마라.** 필드를 더하는 것도 안 된다.

### 3. `update_menu` 설명

`src/mcp/tools/menu.tools.ts`의 `update_menu` 설명에 아래 뜻의 문장을 더한다. "새 메뉴를 등록"이라는 말이 그대로 들어가야 한다(AC가 grep한다).

> 구성을 바꾸면 이미 급여 완료된 끼니도 새 구성으로 다시 차감된다. 잘못 등록한 구성을 고칠 때만 쓰고, 조리 방식이 바뀐 것이면 새 메뉴를 등록한다.

`update_menu`의 동작과 입력은 바꾸지 않는다.

### 4. 통합 테스트

`test/integration/mcp-tools.int-spec.ts`에 **더하기만 한다. 기존 단언과 테스트를 고치거나 지우지 마라.** `EXPECTED_TOOLS` 배열에 `'register_blend_ingredient'` 한 줄을 더하는 것은 더하기다.

- "합침 재료를 등록하면 구성 재료 둘을 가진 재료가 돌아온다": `register_ingredient`로 쌀과 오트밀을 넣고 `register_blend_ingredient`로 쌀오트밀(50g, base, [쌀, 오트밀])을 넣는다. 결과의 `name`이 쌀오트밀이고 `constituentIngredientIds`의 길이가 2다.
- "도입 상태 조회는 합침 재료를 blend와 구성 재료 이름으로 돌려준다": 위 뒤에 `get_ingredient_introduction_status`의 쌀오트밀 행이 `{ ingredientName: '쌀오트밀', status: { kind: 'blend', constituentNames: ['쌀', '오트밀'] }, stockTracking: 'cubes' }`이고 쌀과 오트밀 행은 기존 모양 그대로다.
- "구성 재료가 하나뿐인 합침 재료는 INVALID_BLEND로 거부된다": `callExpectingError`로 `code`를 본다. 입력 스키마가 먼저 거르면 그 오류 코드를 기대값으로 삼고, 어느 층이 거르는지를 테스트 이름에 맞게 적는다.
- "합침 재료를 토핑으로 넣으면 BLEND_AS_TOPPING으로 거부된다": 이 파일의 기존 테스트가 식단을 만드는 방식(`import_meal_plan` 또는 `update_planned_meal`)을 따라 합침 재료를 토핑으로 넣는다.

## Acceptance Criteria

```bash
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
grep -q "register_blend_ingredient" src/mcp/tools/ingredient.tools.ts
grep -q "새 메뉴를 등록" src/mcp/tools/menu.tools.ts
grep -q "register_blend_ingredient" test/integration/mcp-tools.int-spec.ts
grep -q "도입 상태 조회는 합침 재료를 blend와 구성 재료 이름으로 돌려준다" test/integration/mcp-tools.int-spec.ts
! git diff HEAD -- test/integration/mcp-tools.int-spec.ts | grep -E '^-[^-]' | grep -vE '^-import '
git diff --quiet HEAD -- src/domain
git diff --quiet HEAD -- src/application src/infrastructure prisma docs README.md package.json
git diff --quiet HEAD -- test ':(exclude)test/integration/mcp-tools.int-spec.ts'
git diff --quiet "$HARNESS_BASELINE" -- src/application/menu.service.ts src/application/ports
git diff --quiet "$HARNESS_BASELINE" -- src/domain/stock src/domain/deduction src/domain/forecast ':(exclude)src/domain/stock/stock.spec.ts' ':(exclude)src/domain/deduction/deduction.spec.ts' ':(exclude)src/domain/forecast/shortage-forecast.spec.ts'
git diff --quiet "$HARNESS_BASELINE" -- src/slack src/scheduler src/scripts
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `pnpm test:int`는 Docker가 필요하다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- `register_ingredient`에 `constituentNames` 인자를 더하지 마라. 이유: `verifiedBeforeMigration`은 합침 재료에 뜻이 없고 `constituentNames`는 일반 재료에 뜻이 없어 인자끼리 교차 검증이 생긴다(ADR 0011 (e)).
- 구성 재료를 바꾸거나 지우는 도구를 만들지 마라. 이유: 구성은 등록 뒤 바꿀 수 없다.
- `update_menu`의 동작을 바꾸거나 거부 조건을 더하지 마라. 이유: 설명만 고친다(ADR 0011 (g)).
- `test/integration/mcp-tools.int-spec.ts`의 기존 줄을 고치거나 지우지 마라. import 줄에 이름을 더하는 것은 된다. 이유: 일반 재료 행의 모양이 바뀌지 않았음을 기존 단언이 지킨다. AC가 import가 아닌 지워진 줄을 잡는다.
- 도구 안에서 합침 재료의 구조 규칙(둘 이상, 중복 없음 같은 것)을 판정하는 코드를 쓰지 마라. 입력 스키마의 타입 제약까지만 둔다. 이유: 규칙은 도메인 카탈로그가 판정한다.
- `src/application`, `src/domain`, `src/infrastructure`, `src/slack`을 고치지 마라. 필요한 서비스 메서드가 없으면 만들지 말고 status를 `error`로 보고하라. 이유: scope 밖이다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
