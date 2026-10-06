# Phase 6: break-it

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md`
- `tasks/3-stock-alert/break-it.md` (보고서 본보기. 요약 표, 고장마다 diff와 실제 출력 인용, 되돌린 뒤 결과)
- `tasks/4-blend-cube/docs-diff.md`
- 고장을 넣을 다섯 파일: `src/domain/ingredient/ingredient-catalog.ts`(`eatenIngredientIds`와 생성자의 `INVALID_BLEND` 검증), `src/domain/menu/menu.ts`(`expandToEatenIngredientIds`), `src/application/feeding-history.ts`(`introductionStatuses`), `src/application/composition.ts`(`resolveComposition`), `src/infrastructure/prisma/household-writer.ts`(`insertIngredient`)
- 지목한 테스트가 있는 파일: `src/application/feeding-history.spec.ts`, `src/domain/ingredient/ingredient.spec.ts`, `src/domain/menu/menu.spec.ts`, `test/integration/meal-plan.int-spec.ts`, `test/integration/blend-ingredient.int-spec.ts`

시작하기 전에 `pnpm prisma:generate`를 돌려라.

## 동결 경로에 대하여

이 phase는 `src/domain/`에 고장을 잠깐 넣었다가 되돌린다. 끝났을 때 도메인은 HEAD와 같아야 한다. `index.json`에 `unfreeze: ["src/domain/"]`가 있는 이유는 러너가 동결 경로를 task의 baseline과 비교하기 때문이다. phase 2가 도메인을 고쳐 커밋했으므로 선언이 없으면 동결 위반으로 잡힌다.

## 작업 내용

앞 phase들이 만든 테스트가 실제로 규칙을 잡고 있는지 확인한다. 여섯 고장을 **하나씩** 넣고, 지목한 테스트를 돌려 실패를 확인하고, 되돌린 뒤 통과를 확인한다. 기준점은 phase 5의 커밋(HEAD)이다. `git stash`를 쓰지 말고, 되돌릴 때는 `git checkout -- <파일>`이 아니라 편집으로 원래 코드를 되돌려라(프리앰블이 checkout을 금지한다).

| # | 고장 | 파일 | 지목한 테스트 | 실행 명령 |
|---|---|---|---|---|
| 1 | `eatenIngredientIds`가 합침 재료에도 자기 자신의 id만 돌려준다 | `src/domain/ingredient/ingredient-catalog.ts` | "합침 재료를 먹인 급여는 구성 재료의 급여로 센다" | `pnpm vitest run --project unit src/application/feeding-history.spec.ts` |
| 2 | 생성자의 `INVALID_BLEND` 검증을 통째로 뺀다 | 같은 파일 | "합침 재료는 다른 합침 재료의 구성 재료가 될 수 없다" | `pnpm vitest run --project unit src/domain/ingredient/ingredient.spec.ts` |
| 3 | `expandToEatenIngredientIds`의 중복 제거를 뺀다 | `src/domain/menu/menu.ts` | "한 끼에 합침 재료와 그 구성 재료가 함께 있어도 구성 재료의 급여는 한 번으로 센다" | `pnpm vitest run --project unit src/domain/menu/menu.spec.ts` |
| 4 | `introductionStatuses`가 합침 재료를 결과에서 빼지 않는다 | `src/application/feeding-history.ts` | "합침 재료 자체는 도입 상태가 없다" | `pnpm vitest run --project unit src/application/feeding-history.spec.ts` |
| 5 | `resolveComposition`의 `BLEND_AS_TOPPING` 거부를 뺀다 | `src/application/composition.ts` | "합침 재료는 토핑으로 넣을 수 없다" | `pnpm vitest run --project integration test/integration/meal-plan.int-spec.ts` |
| 6 | `insertIngredient`가 구성 행을 쓰지 않는다(`createMany` 호출을 뺀다) | `src/infrastructure/prisma/household-writer.ts` | "합침 재료를 넣고 다시 적재하면 구성 재료 id가 그대로 돌아온다" | `pnpm vitest run --project integration test/integration/blend-ingredient.int-spec.ts` |

고장마다 순서는 같다.

1. 고장을 넣는다. 넣은 diff를 `git diff -- <파일>`로 떠 둔다.
2. 실행 명령을 돌리고 출력을 그대로 보고서에 인용한다. 실패한 테스트 이름을 출력에서 찾아 적는다. 지목한 이름과 다르면 다른 대로 적는다.
3. 편집으로 되돌린다.
4. `git diff --quiet HEAD -- src test prisma; echo $?`를 돌리고 그 출력(0)을 보고서에 적는다. **0을 확인하기 전에는 다음 고장으로 넘어가지 않는다.**
5. 같은 실행 명령을 다시 돌려 통과 수를 적는다.

같은 파일이나 같은 `describe`의 다른 테스트가 함께 실패할 수 있다. 실패한 이름을 전부 적어라. 1번과 2번은 같은 파일이지만 따로 넣는다. 2번 고장은 타입 오류 없이 검증만 사라지게 넣는다. 6번 고장은 반환값의 `constituentIngredientIds`는 그대로 두고 DB에 쓰는 호출만 뺀다. 반환값까지 비우면 다시 적재하기 전에 실패해 무엇을 잡았는지 흐려진다.

지목한 테스트가 실패하지 않으면 그 고장을 잡는 테스트가 없다는 뜻이다. 이 phase에서는 테스트를 더할 수 없으므로(scope 밖) status를 `error`로 보고하고 `error_message`에 어느 고장을 어느 테스트도 잡지 못했는지 적어라.

결과를 `tasks/4-blend-cube/break-it.md`에 적는다. task 3의 보고서와 같은 구성이다: 요약 표(고장, 지목한 테스트, 실제로 실패한 테스트, 결과), 고장마다 diff와 실제 출력, 되돌린 뒤 `git diff --quiet`의 결과와 통과 수.

보고서 끝에 "잡지 못하는 것" 절을 두고 다음을 사실대로 적어라. 확인한 것만 적고 추측하지 마라.

- 운영 전환 절차(`docs/user-intervention.md` 12번: 마이그레이션, 합침 재료와 새 메뉴 등록, 예정 식단 옮기기, 임계개수 설정)는 어떤 테스트도 보지 않는다.
- `update_menu`로 기존 메뉴의 구성을 바꿨을 때 지난 끼니가 다시 계산되는 것은 막지 않기로 했으므로(ADR 0011) 그것을 막는 테스트도 없다.
- 상태판과 브리프의 Slack 양식은 이 task에서 바뀌지 않았고, 합침 재료가 든 메뉴가 휴대폰에서 어떻게 보이는지는 어떤 테스트도 보지 않는다.

## Acceptance Criteria

```bash
test -f tasks/4-blend-cube/break-it.md
grep -q 'eatenIngredientIds' tasks/4-blend-cube/break-it.md
grep -q 'INVALID_BLEND' tasks/4-blend-cube/break-it.md
grep -q 'expandToEatenIngredientIds' tasks/4-blend-cube/break-it.md
grep -q 'introductionStatuses' tasks/4-blend-cube/break-it.md
grep -q 'BLEND_AS_TOPPING' tasks/4-blend-cube/break-it.md
grep -q 'insertIngredient' tasks/4-blend-cube/break-it.md
grep -q 'FAIL' tasks/4-blend-cube/break-it.md
grep -q '잡지 못하는 것' tasks/4-blend-cube/break-it.md
git diff --quiet HEAD -- src prisma docs README.md test package.json
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `git diff --quiet HEAD -- src …`는 고장을 전부 되돌렸다는 뜻이다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- 고장을 넣은 채로 끝내지 마라. 이유: 되돌리지 않으면 AC의 `git diff --quiet HEAD`가 실패하고, 러너가 scope 밖 변경으로 phase를 실패 처리한다.
- 고장 둘을 동시에 넣지 마라. 이유: 어느 테스트가 어느 고장을 잡았는지 구분할 수 없다.
- 고장 하나를 되돌린 뒤 `git diff --quiet HEAD -- src test prisma`를 확인하지 않고 다음 고장으로 넘어가지 마라. 이유: 덜 되돌린 채 다음 고장을 넣으면 두 고장이 겹친다. tech-critic-lead의 승인 조건이다.
- 지목한 테스트가 잡지 못했을 때 잡은 것처럼 적지 마라. 이유: 이 phase의 목적이 그것을 드러내는 것이다. `error`로 보고하라.
- 테스트를 더하거나 고치지 마라. 이유: scope가 `tasks/4-blend-cube/`뿐이다.
- `tasks/4-blend-cube/`의 phase 파일과 `index.json`을 고치지 마라. 이유: 스펙이다. 이 phase가 만드는 파일은 `break-it.md` 하나다.
- `git stash`, `git checkout`, `git reset`을 쓰지 마라. 이유: 프리앰블이 금지한다. 편집으로 되돌린다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다. 고장 넣기는 일시적이라도 scope 밖 변경이므로 반드시 되돌린다.
