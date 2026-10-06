# Phase 3: persistence

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md`
- `tasks/4-blend-cube/docs-diff.md` (ADR 0011의 "테이블과 되돌림", "층별 결합")
- `prisma/schema.prisma`의 `model IngredientConstituent`와 `model Ingredient`의 관계 `constituents` (phase 1이 더했다)
- `src/domain/ingredient/ingredient.ts`의 `constituentIngredientIds`, `src/domain/ingredient/ingredient-catalog.ts`의 `INVALID_BLEND` 검증 (phase 2가 더했다)
- `src/infrastructure/prisma/household-state.repository.ts` (재료 조회와 메뉴 조회의 `include`, `orderBy`)
- `src/infrastructure/prisma/mappers/state.mapper.ts`, `src/infrastructure/prisma/mappers/state.mapper.spec.ts`
- `src/infrastructure/prisma/household-writer.ts`의 `insertIngredient`, `insertMenu`
- `src/application/ports/household-write.port.ts`의 `IngredientDraft`, `CatalogWrites` (읽기만 한다)
- `test/integration/setup/fixtures.ts`(`buildServices`가 writer를 조립하는 줄, `seedHouseholdOnly`), `test/integration/date-round-trip.int-spec.ts`(영속화 왕복 테스트의 모양)

시작하기 전에 `pnpm prisma:generate`를 돌려라.

## 동결 경로에 대하여

이 phase는 `src/domain/`을 고치지 않는다. 그런데도 `index.json`에 `unfreeze: ["src/domain/"]`가 있는 이유는 러너가 동결 경로를 task의 baseline과 비교하기 때문이다. phase 2가 도메인을 고쳐 커밋했으므로, 선언이 없으면 이 phase가 아무것도 건드리지 않아도 동결 위반으로 잡힌다. AC의 `git diff --quiet HEAD -- src/domain`이 이 phase가 도메인을 건드리지 않았음을 따로 확인한다.

## 작업 내용

phase 2는 매퍼와 writer가 `constituentIngredientIds: []`를 돌려주게만 했다. 이 phase가 실제로 읽고 쓴다.

### 1. 읽기

- `src/infrastructure/prisma/household-state.repository.ts`: 재료 조회의 `include`에 구성 행을 더한다. `constituents: { select: { constituentIngredientId: true }, orderBy: { constituentIngredientId: 'asc' } }`. 메뉴 구성이 `orderBy: { ingredientId: 'asc' }`로 순서를 고정하는 것과 같다. id가 uuid v7이라 재료를 등록한 순서다.
- `src/infrastructure/prisma/mappers/state.mapper.ts`: `IngredientRow`에 `constituents: { constituentIngredientId: string }[]`를 더하고 `toIngredient`가 그 id들을 `constituentIngredientIds`로 돌려준다.
- `prisma.ingredient.findMany`를 부르는 다른 곳(`src/infrastructure/prisma/feeding-history.repository.ts`)은 `toIngredient`를 쓰지 않으면 고치지 않는다.

### 2. 쓰기

`src/infrastructure/prisma/household-writer.ts`의 `insertIngredient`가 `draft.constituentIngredientIds`가 비어 있지 않으면 재료 행을 만든 뒤 `ingredientConstituent.createMany`로 구성 행을 넣고, 반환값의 `constituentIngredientIds`에 받은 값을 그대로 돌려준다. 같은 트랜잭션(`this.tx`)이다.

포트는 고치지 않는다. `IngredientDraft`가 `Omit<Ingredient, 'id'> & …`라 구성 재료가 이미 들어 있다.

### 3. 테스트

`src/infrastructure/prisma/mappers/state.mapper.spec.ts`에 단위 테스트 하나를 더한다.

- "구성 행이 재료의 구성 재료 id가 된다"

기존 `toIngredient` 호출에는 `constituents: []`를 넘긴다.

새 파일 `test/integration/blend-ingredient.int-spec.ts`를 만든다. 서비스 메서드(`registerBlend`)는 phase 4에 생기므로 여기서는 writer로 직접 넣는다. `fixtures.ts`의 `TestServices`는 writer를 내놓지 않으니, `fixtures.ts`를 고치지 말고 테스트 파일 안에서 `buildServices`가 하는 것과 같은 방식으로 `PrismaHouseholdWriter`를 조립한다. `describe('합침 재료 영속화', …)` 아래에 둔다.

- "합침 재료를 넣고 다시 적재하면 구성 재료 id가 그대로 돌아온다": 일반 재료 둘을 넣고, 그 둘을 구성 재료로 하는 재료를 `context.insertIngredient`로 넣은 뒤, 새 `write` 호출의 `context.load()`가 준 상태에서 그 재료의 `constituentIngredientIds`를 본다. `ingredient_constituent` 행 수도 `services.prisma`로 확인한다.
- "구성 재료가 없는 재료는 빈 배열로 적재된다"

## Acceptance Criteria

```bash
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
test -f test/integration/blend-ingredient.int-spec.ts
grep -q "합침 재료를 넣고 다시 적재하면 구성 재료 id가 그대로 돌아온다" test/integration/blend-ingredient.int-spec.ts
grep -q "구성 행이 재료의 구성 재료 id가 된다" src/infrastructure/prisma/mappers/state.mapper.spec.ts
grep -q "ingredientConstituent" src/infrastructure/prisma/household-writer.ts
git diff --quiet HEAD -- src/domain
git diff --quiet HEAD -- src/application src/mcp src/slack src/scheduler src/scripts prisma docs README.md package.json
git diff --quiet HEAD -- test
git diff --quiet "$HARNESS_BASELINE" -- src/application/ports
git diff --quiet "$HARNESS_BASELINE" -- src/domain/stock src/domain/deduction src/domain/forecast ':(exclude)src/domain/stock/stock.spec.ts' ':(exclude)src/domain/deduction/deduction.spec.ts' ':(exclude)src/domain/forecast/shortage-forecast.spec.ts'
git diff --quiet "$HARNESS_BASELINE" -- src/slack src/scheduler src/scripts
```

`git diff --quiet HEAD -- test`는 추적되는 테스트 파일이 바뀌지 않았다는 뜻이다. 새 파일 `blend-ingredient.int-spec.ts`는 아직 추적되지 않아 여기에 걸리지 않는다.

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `pnpm test:int`는 Docker가 필요하다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- `src/domain`을 고치지 마라. 이유: 위 "동결 경로에 대하여". AC가 HEAD와 비교한다.
- `src/application/ports/household-write.port.ts`에 메서드를 더하지 마라. 이유: 기존 `insertIngredient`가 구성을 받는다. tech-critic-lead의 승인 조건이다.
- 구성 재료를 바꾸거나 지우는 writer 메서드를 만들지 마라. 이유: 구성은 등록 뒤 바꿀 수 없다(ADR 0011 (e)).
- `test/integration/setup/fixtures.ts`와 기존 통합 테스트를 고치지 마라. 이유: scope 밖이고, 합침 재료가 없는 기존 동작은 바뀌지 않아야 한다. 기존 통합 테스트가 실패하면 그 테스트를 고치지 말고 `error`로 보고하라.
- 적재 때 구성 재료를 따로 검증하지 마라. 이유: `IngredientCatalog` 생성자가 이미 한다. 어댑터가 도메인 규칙을 다시 쓰지 않는다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
