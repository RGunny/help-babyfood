# Phase 7: break-it

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md`
- `tasks/1-slack-and-deploy/break-it.md` (보고서 본보기. 표, diff, 실제 출력 인용, 되돌린 뒤 결과)
- `tasks/2-pantry-and-expiry/docs-diff.md`
- `src/domain/deduction/reconcile.ts`, `src/domain/stock/expiry.ts`, `src/application/daily-brief.ts` (고장을 넣을 세 곳)
- `src/domain/deduction/deduction.spec.ts`의 `describe('상비 재료')`, `src/domain/stock/stock.spec.ts`의 단계 경계 테스트, `src/application/daily-brief.spec.ts`의 임계일 열 테스트 (지목한 테스트)

## 작업 내용

앞 phase들이 만든 테스트가 실제로 규칙을 잡고 있는지 확인한다. 세 고장을 **하나씩** 넣고, 지목한 테스트를 돌려 실패를 확인하고, 되돌린 뒤 통과를 확인한다. 기준점은 phase 6의 커밋(HEAD)이다. `git stash`를 쓰지 말고, 되돌릴 때는 `git checkout -- <파일>`이 아니라 편집으로 원래 코드를 되돌려라(프리앰블이 checkout을 금지한다). 되돌린 뒤 `git diff --quiet HEAD -- src`로 깨끗한지 확인한다.

| # | 고장 | 파일 | 지목한 테스트 |
|---|---|---|---|
| 1 | `targetOf`에서 상비 제외를 없앤다 (상비 필요량도 차감 대상에 넣는다) | `src/domain/deduction/reconcile.ts` | `src/domain/deduction/deduction.spec.ts` "상비 재료는 재고가 없어도 차감하지 않고 보류하지 않는다" |
| 2 | `EXPIRY_NOTICE_DAYS`를 3에서 1로 | `src/domain/stock/expiry.ts` | `src/domain/stock/stock.spec.ts` "임계일 3일 전부터 임박이고 daysLeft가 3이다" |
| 3 | `buildDailyBrief`의 `nextExpiry`를 언제나 null로 | `src/application/daily-brief.ts` | `src/application/daily-brief.spec.ts` "임계일 열은 잔여가 있는 가장 이른 배치의 임계일과 단계다" |

3번은 `src/application/daily-brief.spec.ts`만 잡는다. `household-board.spec.ts`와 `daily-brief.spec.ts`(templates)는 `DailyBrief` 픽스처를 직접 넣으므로 실패하지 않는다. 그것을 보고서에 적어라.

고장마다 `pnpm vitest run --project unit <지목한 spec 파일>`을 돌리고 출력을 그대로 인용한다. 지목한 테스트가 실패하지 않으면 그 고장을 잡는 테스트를 해당 spec 파일에 더하고(scope 밖이므로 이 phase에서는 더할 수 없다) 대신 status를 `error`로 보고하고 `error_message`에 어느 고장을 어느 테스트도 잡지 못했는지 적어라. 통과한 테스트가 검증하고 있지 않다는 뜻이므로 사람이 봐야 한다.

결과를 `tasks/2-pantry-and-expiry/break-it.md`에 적는다. task 1의 보고서와 같은 구성이다: 요약 표, 고장마다 diff와 실제 출력, 되돌린 뒤 통과 수. 실제 출력에 나온 실패 테스트 이름을 적어라. 지목한 이름과 다르면 다른 대로 적는다.

## Acceptance Criteria

```bash
test -f tasks/2-pantry-and-expiry/break-it.md
grep -q "EXPIRY_NOTICE_DAYS" tasks/2-pantry-and-expiry/break-it.md
grep -q "nextExpiry" tasks/2-pantry-and-expiry/break-it.md
grep -q "FAIL" tasks/2-pantry-and-expiry/break-it.md
git diff --quiet HEAD -- src test prisma docs README.md
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `git diff --quiet HEAD -- src ...`는 고장을 전부 되돌렸다는 뜻이다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- 고장을 넣은 채로 끝내지 마라. 이유: 되돌리지 않으면 AC의 `git diff --quiet HEAD`가 실패하고, 러너가 scope 밖 변경으로 phase를 실패 처리한다.
- 고장 둘을 동시에 넣지 마라. 이유: 어느 테스트가 어느 고장을 잡았는지 구분할 수 없다.
- 지목한 테스트가 잡지 못했을 때 잡은 것처럼 적지 마라. 이유: 이 phase의 목적이 그것을 드러내는 것이다. `error`로 보고하라.
- `git stash`, `git checkout`, `git reset`을 쓰지 마라. 이유: 프리앰블이 금지한다. 편집으로 되돌린다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다. 고장 넣기는 일시적이라도 scope 밖 변경이므로 반드시 되돌린다.
