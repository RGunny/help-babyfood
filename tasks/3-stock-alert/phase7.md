# Phase 7: break-it

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md`
- `tasks/2-pantry-and-expiry/break-it.md` (보고서 본보기. 요약 표, 고장마다 diff와 실제 출력 인용, 되돌린 뒤 결과)
- `tasks/3-stock-alert/docs-diff.md`
- 고장을 넣을 다섯 곳: `src/application/daily-brief.ts`(`STOCK_ALERT_HORIZON_DAYS`), `src/application/brief-dispatch.service.ts`(`dispatchStockAlert`의 `no_alert` 종결), `src/infrastructure/prisma/brief-delivery-log.repository.ts`(`claimDueStockAlerts`의 첫 문장), `src/slack/templates/brief-lines.ts`(`byUrgency`)
- 지목한 테스트가 있는 파일: `src/application/daily-brief.spec.ts`, `src/application/brief-dispatch.service.spec.ts`, `test/integration/brief-delivery.int-spec.ts`, `src/slack/templates/daily-brief.spec.ts`

시작하기 전에 `pnpm prisma:generate`를 돌려라.

## 작업 내용

앞 phase들이 만든 테스트가 실제로 규칙을 잡고 있는지 확인한다. 다섯 고장을 **하나씩** 넣고, 지목한 테스트를 돌려 실패를 확인하고, 되돌린 뒤 통과를 확인한다. 기준점은 phase 6의 커밋(HEAD)이다. `git stash`를 쓰지 말고, 되돌릴 때는 `git checkout -- <파일>`이 아니라 편집으로 원래 코드를 되돌려라(프리앰블이 checkout을 금지한다).

| # | 고장 | 파일 | 지목한 테스트 | 실행 명령 |
|---|---|---|---|---|
| 1 | `STOCK_ALERT_HORIZON_DAYS`를 7에서 0으로 | `src/application/daily-brief.ts` | "첫 부족일이 7일 안이면 upcoming이다" | `pnpm vitest run --project unit src/application/daily-brief.spec.ts` |
| 2 | `dispatchStockAlert`에서 항목이 비었을 때의 `no_alert` 종결을 없앤다(항상 보낸다) | `src/application/brief-dispatch.service.ts` | "알람 항목이 없으면 no_alert로 종결하고 보내지 않는다" | `pnpm vitest run --project unit src/application/brief-dispatch.service.spec.ts` |
| 3 | `claimDueStockAlerts` 첫 문장의 `ON CONFLICT (household_id, date) DO NOTHING`을 뺀다 | `src/infrastructure/prisma/brief-delivery-log.repository.ts` | "재고 알람은 하루 한 건이다" | `pnpm vitest run --project integration test/integration/brief-delivery.int-spec.ts` |
| 4 | 같은 문장의 `WHERE COALESCE(a.brief_time, …) <= ${due.time}` 조건을 뺀다 | 같은 파일 | "브리프 시각 전에는 재고 알람을 클레임하지 않는다" | 3번과 같다 |
| 5 | `byUrgency`의 첫 기준을 `firstShortageDate`에서 `depletionDate`로 되돌린다 | `src/slack/templates/brief-lines.ts` | "재고 표는 부족 시작일이 이른 순이다" | `pnpm vitest run --project unit src/slack/templates/daily-brief.spec.ts` |

고장마다 순서는 같다.

1. 고장을 넣는다. 넣은 diff를 `git diff -- <파일>`로 떠 둔다.
2. 실행 명령을 돌리고 출력을 그대로 보고서에 인용한다. 실패한 테스트 이름을 출력에서 찾아 적는다. 지목한 이름과 다르면 다른 대로 적는다.
3. 편집으로 되돌린다.
4. `git diff --quiet HEAD -- src test prisma; echo $?`를 돌리고 그 출력(0)을 보고서에 적는다.
5. 같은 실행 명령을 다시 돌려 통과 수를 적는다.

3번 고장은 기본키 충돌로 질의가 던지는 식으로 실패할 수 있다. 그것도 테스트가 고장을 잡은 것이다. 어떤 오류로 실패했는지 적어라. 2번 고장은 같은 `describe`의 다른 테스트가 함께 실패할 수 있다. 실패한 이름을 전부 적어라.

지목한 테스트가 실패하지 않으면 그 고장을 잡는 테스트가 없다는 뜻이다. 이 phase에서는 테스트를 더할 수 없으므로(scope 밖) status를 `error`로 보고하고 `error_message`에 어느 고장을 어느 테스트도 잡지 못했는지 적어라. 통과한 테스트가 검증하고 있지 않다는 뜻이므로 사람이 봐야 한다.

결과를 `tasks/3-stock-alert/break-it.md`에 적는다. task 2의 보고서와 같은 구성이다: 요약 표(고장, 지목한 테스트, 실제로 실패한 테스트, 결과), 고장마다 diff와 실제 출력, 되돌린 뒤 `git diff --quiet`의 결과와 통과 수.

보고서 끝에 "잡지 못하는 것" 절을 두고 다음을 사실대로 적어라. 확인한 것만 적고 추측하지 마라.

- 템플릿 spec(`stock-alert.spec.ts`, `daily-brief.spec.ts`, `household-board.spec.ts`)은 `DailyBrief`와 `StockAlertMessage` 픽스처를 직접 넣으므로 애플리케이션의 판정 고장(1번)을 잡지 않는다.
- 휴대폰에서 메시지가 어떻게 보이는지는 어떤 테스트도 보지 않는다(`docs/user-intervention.md` 11번).

## Acceptance Criteria

```bash
test -f tasks/3-stock-alert/break-it.md
grep -q 'STOCK_ALERT_HORIZON_DAYS' tasks/3-stock-alert/break-it.md
grep -q 'no_alert' tasks/3-stock-alert/break-it.md
grep -q 'ON CONFLICT' tasks/3-stock-alert/break-it.md
grep -q 'brief_time' tasks/3-stock-alert/break-it.md
grep -q 'byUrgency' tasks/3-stock-alert/break-it.md
grep -q 'FAIL' tasks/3-stock-alert/break-it.md
grep -q '잡지 못하는 것' tasks/3-stock-alert/break-it.md
git diff --quiet HEAD -- src prisma docs README.md test
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `git diff --quiet HEAD -- src …`는 고장을 전부 되돌렸다는 뜻이다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- 고장을 넣은 채로 끝내지 마라. 이유: 되돌리지 않으면 AC의 `git diff --quiet HEAD`가 실패하고, 러너가 scope 밖 변경으로 phase를 실패 처리한다.
- 고장 둘을 동시에 넣지 마라. 3번과 4번은 같은 문장이지만 따로 넣는다. 이유: 어느 테스트가 어느 고장을 잡았는지 구분할 수 없다.
- 고장 하나를 되돌린 뒤 `git diff --quiet HEAD -- src test prisma`를 확인하지 않고 다음 고장으로 넘어가지 마라. 이유: 덜 되돌린 채 다음 고장을 넣으면 두 고장이 겹친다. tech-critic-lead의 승인 조건이다.
- 지목한 테스트가 잡지 못했을 때 잡은 것처럼 적지 마라. 이유: 이 phase의 목적이 그것을 드러내는 것이다. `error`로 보고하라.
- 테스트를 더하거나 고치지 마라. 이유: scope가 `tasks/3-stock-alert/`뿐이다.
- `git stash`, `git checkout`, `git reset`을 쓰지 마라. 이유: 프리앰블이 금지한다. 편집으로 되돌린다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다. 고장 넣기는 일시적이라도 scope 밖 변경이므로 반드시 되돌린다.
