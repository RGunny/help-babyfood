# Phase 0: docs

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain
```

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고 status를 `error`로, `error_message`에 `dirty working tree`로 보고하고 멈춰라.

먼저 아래를 읽어라. 이 phase는 이 task 전체의 설계를 문서로 고정하는 일이고, 뒤따르는 phase 일곱 개가 여기서 쓴 ADR 0009를 읽고 구현한다. 문서가 틀리면 구현이 틀린다.

- `AGENTS.md`
- `docs/README.md` (문서 지도. 문서마다 축이 하나이고 같은 내용을 두 문서에 적지 않는다)
- `docs/backlog.md` (이 task의 요구 세 항목. 네 번째 항목 "끼니 중량 상한"은 이 task의 범위가 아니다)
- `docs/product-plan.md` 전체. 특히 4.2(조리 배치), 4.4(자동 차감과 보류), 4.5(임계일과 폐기), 4.6(도입 상태), 5장(브리프 구성과 상태판 내용), 6장(도메인 모델 표), 7장(MCP 도구 표), 9장의 "N단계에서 정한 것" 절들
- `docs/adr/0007-slack-message-templates.md` (재고 표 한 장. "임계일 알람은 표에 넣지 않는다" 문단이 이번에 뒤집힌다)
- `docs/adr/0008-slack-canvas-board.md` (상태판. 셀 색 대신 기호를 쓰는 결정, 상태판 내용 목록, 회차 투영을 도메인에 둔 근거)
- `docs/adr/0005-scheduler-and-daily-brief.md`의 "보류된 차감" 절
- `docs/user-intervention.md` 전체. 특히 머리의 상태 표와 6번, 9번 항목의 서술 방식
- `src/domain/ingredient/ingredient.ts`, `src/domain/stock/expiry.ts`, `src/domain/stock/stock-summary.ts`, `src/domain/deduction/reconcile.ts`(특히 `targetOf`와 `allocateOldestFirst`가 null일 때 `held`에 넣는 부분), `src/domain/forecast/shortage-forecast.ts` (지금 코드가 어디까지 하는지)
- `src/application/daily-brief.ts`의 `BriefStockRow`, `BriefExpiryAlert`, `DailyBrief`
- `src/slack/templates/household-board.ts`, `src/slack/templates/daily-brief.ts`, `src/slack/templates/labels.ts` (지금 양식)

## 배경

2026-09-29에 사용자가 결정한 것 세 가지다. 이 발언은 `docs/backlog.md`가 지워진 뒤 ADR 0009가 유일한 기록이 되므로 날짜와 함께 ADR에 인용하라.

1. 땅콩버터, 계란, 밀가루는 큐브로 만들지 않고 늘 집에 있는 재료다. 사용자는 "재고 무한으로 해 놔"라고 했고, 큰 배치를 넣는 우회 대신 정식 기능을 택했다. 지금은 세 재료의 재고가 0이라 `reconcileMeals`가 매 끼니 차감을 보류하고, 상태판 확인 필요에 "재고 부족으로 보류된 차감: 계란 1개"가 매일 오르며, `forecastShortage`가 부족 1개를 계속 올린다.
2. "슬랙에 임계일 섹션은 필요 없어 보이고 재고 표에서 그냥 같이 보면 될 것 같아." 그리고 "임계치 도달 3일 전 그 행을 색칠이나 하이라이트 가능한가?"
3. "폐기 신경 쓰지 말라니까?" 그리고 "임계일은 폐기 기한이랑 관련 없는 거 알지? 폐기는 그냥 추가 정보야." 임계일은 조리 후 14일이 지났음을 알리는 정보이지 버려야 하는 날이 아니다. 폐기는 부모가 실제로 버렸을 때만 기록하는 별개 행위다. 지금 기획 4.5의 "임계일 다음 날부터 '폐기 필요'를 매일 반복"과 배치 상태 "폐기 대기"는 이 모델과 다르다.

## 작업 내용

문서만 고친다. **코드는 한 줄도 건드리지 않는다.** 아래 일곱 가지를 한다.

### 1. `docs/adr/0009-pantry-ingredients-and-expiry-notice.md` 신설

이 task의 중심 문서다. 형식은 ADR 0008과 같게 한다(제목, 상태, 결정일, 맥락, 결정, 층별 결합, 대가와 남는 위험). 결정일은 2026-09-29, 상태는 채택이다. 아래 결정을 전부 담는다. 각 항목은 이미 정해진 것이므로 새로 정하지 말고 근거를 붙여 서술하라.

**(a) 재료에 재고 방식이 생긴다: 큐브 추적과 상비.**

`Ingredient.stockTracking: 'cubes' | 'pantry'`다. 상비 재료는 냉동 큐브가 아니라 늘 집에 있는 재료(땅콩버터, 계란, 밀가루)다. 4.1절의 "모든 재료는 조리 후 냉동 큐브로 보관한다"에 예외가 생기는 것이고 그것을 4.1이나 4.2에 적는다.

기획 근거는 4.4절의 보류 규칙이다. 보류는 "입고 등록이 늦었던 경우"를 위한 것인데 상비 재료는 입고가 영영 없으므로 보류가 매일 반복된다. 규칙이 잘못 적용되는 것이지 규칙이 틀린 것이 아니다.

**(b) 상비 제외는 도메인이 한다.**

`summarizeStock`, `forecastShortage`, `reconcileMeals` 셋 다 상비 재료를 결과와 차감에서 뺀다. 호출자는 거르지 않는다. 이유: 호출자가 거르면 세 호출자(재고 현황, 예측, 정합화)가 같은 규칙을 세 번 쓴다. 특히 `reconcileMeals`는 `input.catalog.getById(need.ingredientId)`(`src/domain/deduction/reconcile.ts`)로 카탈로그 전체를 요구하므로 호출자가 상비 재료를 빼서 넘길 수 없다. 이것이 동결된 도메인을 여는 이유다(ADR 0008이 회차 투영을 도메인에 둔 것과 같은 이유). 규칙은 다음과 같다.

- 상비 재료의 큐브 필요량은 차감하지 않고 보류도 만들지 않는다.
- 상비 재료 배치의 소비 이벤트는 되돌리지도 않는다. 상비 재료는 원장과 무관하다.
- 상비 재료는 재고 현황과 부족 예측에 나오지 않는다. 브리프는 대신 `pantryIngredients` 목록으로 이름만 보인다.
- 도입 상태(4.6)는 급여 이력으로 계산하므로 영향이 없다. 계란은 검증중 그대로다.

**(c) 상비 전환의 조건과 도구.**

`update_ingredient_stock_tracking(idempotencyKey, name, stockTracking)`을 7장 재료 도구에 더한다. 큐브 추적에서 상비로 바꾸려면 그 재료의 잔여 큐브가 0이어야 한다(`PANTRY_WITH_STOCK` 거부). 큐브가 표에서 사라지는 것을 막기 위해서다. 상비 재료에는 `register_cooked_batch`(`PANTRY_INGREDIENT` 거부)와 임계개수 설정(`INVALID_THRESHOLD` 거부)을 거부한다. 상비에서 큐브 추적으로 되돌리는 것은 조건이 없다.

`register_ingredient`는 바꾸지 않는다. 새 재료는 큐브 추적으로 시작하고 상비 전환은 별도 도구로 한다. 선택 인자와 기본값을 두지 않기 위해서다(AGENTS.md 금지 2번).

**(d) 임계일 목록을 없애고 재고 표에 임계일 열을 둔다.**

상태판과 브리프의 임계일 목록(배치 단위)을 없애고, 재고 표에 재료마다 잔여 배치 중 가장 이른 임계일을 `임계일` 열로 보인다. `BriefStockRow.nextExpiry: { date, stage } | null`을 애플리케이션이 `IngredientStock.batches`(조리일 순)의 첫 배치에서 `expiryDateOf`와 그 배치의 `expiry`로 채운다.

ADR 0007의 "임계일 알람은 표에 넣지 않는다. 재료가 아니라 배치 단위이고, 배치마다 '폐기 완료' 버튼이 붙는다"를 뒤집는다는 것을 명시하라. 근거는 사용자가 배치 단위 목록을 읽지 않는다는 것이다. 폐기 버튼은 브리프 메시지에서 재고 표 아래에 그대로 남는다. 캔버스에는 버튼이 없으므로(ADR 0008) 상태판에는 버튼이 없다.

**(e) 임계일 3일 전부터 강조하고, 강조 판정은 도메인이 한다.**

`ExpiryStage`를 `fresh | due_soon { daysLeft } | overdue { overdueDays }`로 바꾼다. `due_soon`은 임계일 3일 전부터 당일까지(daysLeft 3, 2, 1, 0)이고, 3일은 도메인 상수 `EXPIRY_NOTICE_DAYS = 3`이다. 재료의 `nextExpiry.stage.kind`가 `fresh`가 아니면 그 행을 강조한다. 템플릿은 그 값만 읽고 날짜 계산을 하지 않는다(어댑터가 재고 규칙을 다시 쓰지 않는다는 AGENTS.md 계층 규약).

캔버스 마크다운은 셀 색이 없어서(ADR 0008이 실측한 제약) 재료명을 굵게 하고 앞에 기호를 붙인다. 브리프 표(Block Kit `raw_text`)는 기호만 붙인다. **기호는 `⏰`이다.** 달력의 반응있음 기호 `⚠`(ADR 0008)와 다른 문자를 쓴다. 같은 캔버스에서 한 기호가 두 뜻을 가지면 안 된다. 이 이유를 적어라.

기획 4.5의 단계 표는 다음으로 바뀐다. "폐기 필요" 문구는 어디에도 남지 않는다.

| 시점 | 단계 | 표시 |
|---|---|---|
| 임계일 4일 전까지 | 여유 (`fresh`) | 없음 |
| 임계일 3일 전부터 당일까지 | 임박 (`due_soon`) | 행 강조 |
| 임계일 다음 날부터 | 지남 (`overdue`) | 행 강조, 브리프에 폐기 버튼 |
| 부모가 폐기 완료를 지시한 때 | 폐기됨 | 표에서 사라짐 |

**(f) "폐기 대기"라는 말을 없앤다.**

`IngredientStock.pendingDiscard`는 `overdue`가 되고, 사용자에게 보이는 말은 "폐기 대기"에서 "임계 지남"으로 바뀐다. 6장 조리 배치 상태 "(가용, 폐기 대기, 폐기됨)"은 "(가용, 임계 지남, 폐기됨)"이 된다. 임계일이 지난 배치를 합계, 자동 차감, 소진 예측에 똑같이 넣는 규칙(4.5절)은 그대로다. 바뀌는 것은 이름과 문구뿐이고, 근거는 위 배경 3번의 사용자 발언이다.

**(g) 층별 결합.**

도메인에 더하는 것은 재료 속성 하나, 단계 상수 하나, 세 함수의 상비 제외다. 프레임워크, DB, 시계를 여전히 모른다. 애플리케이션은 포트 메서드 `updateStockTracking` 하나와 읽기 모델 필드(`nextExpiry`, `pantryIngredients`, `overdue`)를 더한다. Slack 템플릿은 `DailyBrief`만 읽는다. MCP는 도구 하나를 더하고 출력 필드 이름을 맞춘다.

**(h) 대가와 남는 위험.**

최소한 아래를 적어라. 없는 위험을 지어내지 마라.

- `ingredient` 테이블에 컬럼이 하나 늘고 운영 DB에 마이그레이션을 사람이 돌린다(`docs/user-intervention.md` 10번).
- 상비 재료의 급여량은 원장에 남지 않는다. "계란을 몇 번 먹였는가"는 급여 이력으로 알 수 있지만 "몇 g"은 알 수 없다.
- MCP 출력의 필드 이름이 바뀐다(`pendingDiscard` → `overdue`, `expiryAlerts`의 단계 kind). 소비자는 Claude Code뿐이다.
- `due_soon`이 생기면서 `batchesNeedingExpiryAlert`가 3일 전 배치도 돌려준다. `get_stock_status`의 `expiryAlerts`가 그만큼 길어진다.
- 강조 기호는 캔버스와 Block Kit 표에서 색이 아니라 문자다. 휴대폰에서 얼마나 눈에 띄는지는 배포 뒤 사람이 본다.

### 2. `docs/product-plan.md` 수정

- 4.1 또는 4.2: 상비 재료 예외 한 문단. 4.4: 상비 재료는 차감하지도 보류하지도 않는다는 한 문단. 4.5: 첫 문장 뒤에 "임계일은 큐브를 버려야 하는 날이 아니라 오래됐음을 알리는 기준이다"를 넣고 단계 표를 위 (e)의 표로 바꾸며 "폐기 대기"를 "임계 지남"으로 고친다. 재고현황 예시 "브로콜리 12 (가용 9 / 폐기 대기 3)"도 "임계 지남 3"으로.
- 5장 브리프 구성 목록: "재고현황 표" 항목에 임계일 열과 상비 한 줄을 더하고, "임계일 알람: 전일, 당일, 초과 N일째" 항목은 취소선으로 남기고 "재고 표의 임계일 열과 3일 전 강조로 대신한다(ADR 0009)"를 붙인다. 상태판 내용 문장의 "재고현황 표, 임계일, 확인 필요"에서 임계일을 뺀다.
- 6장 표: 재료 행에 "재고 방식(큐브, 상비)"를, 조리 배치 행의 상태를 "(가용, 임계 지남, 폐기됨)"으로.
- 7장 표: 재료 행에 `update_ingredient_stock_tracking`을 더한다.
- 9장 "6단계에서 정한 것" 뒤, "## 10. 미정 사항" 앞에 "### 상비 재료와 임계일 표시에서 정한 것" 절을 기존 절들과 같은 분량과 문체로 더하고 ADR 0009를 가리킨다. 9장 단계 표에는 행을 더하지 않는다. 구현 단계가 아니라 운영 중 요구다.

### 3. ADR 0007과 0008의 뒤집힌 문장

- `docs/adr/0007-slack-message-templates.md`: "임계일 알람은 표에 넣지 않는다..." 문단을 취소선으로 남기고 "2026-09-29 ADR 0009로 뒤집혔다. 임계일은 재고 표의 열이 되었고 폐기 버튼만 표 아래에 남는다"를 붙인다. 표 예시의 "폐기대기" 열 이름은 그대로 둔다. 그때의 결정 기록이다.
- `docs/adr/0008-slack-canvas-board.md`: "위에서부터 갱신 시각, 식단 달력, 재고 표, 임계일, 확인 필요다" 문장에서 임계일을 취소선으로 남기고 0009를 가리킨다. 다른 결정은 건드리지 마라.

writing-docs 규칙: ADR 본문은 최종 상태만 담고 "개정" 절을 누적하지 않는다. 폐지된 규칙은 취소선과 폐지한 ADR 번호로 표시한다.

### 4. `docs/user-intervention.md`에 10번 추가

머리의 상태 표에 10번 행을 더하고, 9번 뒤에 "## 10. 재고 방식 마이그레이션과 상비 재료 전환" 절을 더한다. 내용은 두 가지다. 배포 뒤 `railway ssh "pnpm db:deploy"`(6번 항목이 말하듯 배포 전 명령이 아직 설정되지 않았으므로 사람이 돌린다)로 `stock_tracking` 마이그레이션을 적용하는 것, 그 뒤 Claude Code에서 `update_ingredient_stock_tracking`으로 땅콩버터, 계란, 밀가루를 `pantry`로 바꾸는 것이다. 세 재료의 잔여 큐브가 0이어야 한다는 조건을 적어라. 상태는 "안 함"이다.

### 5. `docs/backlog.md`

상비 재료, 임계일 섹션 제거, 임계일 임박 강조 세 항목을 지운다. "끼니 중량 상한" 항목은 남긴다. 다른 항목이 없으면 안내 문장은 그대로 두고 목록만 비운다.

### 6. `README.md`

문서 표에 `docs/adr/0009-pantry-ingredients-and-expiry-notice.md` 행을 더한다. 내용 칸은 "상비 재료, 재고 표의 임계일 열과 3일 전 강조"다.

### 7. 문서 규약

- 문체는 `docs/`의 다른 문서와 같게 "~한다"로 쓴다. em dash(—)를 쓰지 않는다.
- 주장에는 근거를 붙인다. 기획안 조항, ADR 번호, 파일 경로를 지목한다.
- 하지 않은 일을 했다고 적지 않는다. 이 phase가 끝난 시점에 코드는 한 줄도 바뀌지 않았다.
- 새 `.md`는 ADR 0009 하나뿐이다. `scripts/doc-paths.json`이 `docs/adr/*.md`를 허용한다. 다른 `.md`를 만들지 마라.

## Acceptance Criteria

```bash
test -f docs/adr/0009-pantry-ingredients-and-expiry-notice.md
grep -q 'stockTracking' docs/adr/0009-pantry-ingredients-and-expiry-notice.md
grep -q 'PANTRY_WITH_STOCK' docs/adr/0009-pantry-ingredients-and-expiry-notice.md
grep -q 'EXPIRY_NOTICE_DAYS' docs/adr/0009-pantry-ingredients-and-expiry-notice.md
grep -q 'due_soon' docs/adr/0009-pantry-ingredients-and-expiry-notice.md
grep -q 'nextExpiry' docs/adr/0009-pantry-ingredients-and-expiry-notice.md
grep -q '⏰' docs/adr/0009-pantry-ingredients-and-expiry-notice.md
grep -q '2026-09-29' docs/adr/0009-pantry-ingredients-and-expiry-notice.md
grep -q 'update_ingredient_stock_tracking' docs/adr/0009-pantry-ingredients-and-expiry-notice.md
grep -q 'update_ingredient_stock_tracking' docs/product-plan.md
grep -q '임계 지남' docs/product-plan.md
! grep -q '폐기 필요' docs/product-plan.md
grep -q '상비' docs/product-plan.md
grep -q '0009' docs/adr/0007-slack-message-templates.md
grep -q '0009' docs/adr/0008-slack-canvas-board.md
grep -q '^## 10\.' docs/user-intervention.md
grep -q 'update_ingredient_stock_tracking' docs/user-intervention.md
! grep -q '상비 재료:' docs/backlog.md
! grep -q '임계일 섹션 제거' docs/backlog.md
! grep -q '임계일 임박 강조' docs/backlog.md
grep -q '끼니 중량 상한' docs/backlog.md
grep -q '0009-pantry-ingredients-and-expiry-notice' README.md
python3 scripts/harness/check_docs.py
git diff --quiet "$HARNESS_BASELINE" -- src prisma test package.json
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- 코드를 고치지 마라. 이유: 문서가 먼저 바뀌어야 이후 phase가 읽을 기준이 생기고, scope가 `docs/`와 `README.md`뿐이라 러너가 phase를 실패로 처리한다.
- ADR 0009에 "개정" 절이나 변경 이력을 두지 마라. 이유: writing-docs 규칙은 최종 상태만 담는다.
- ADR 0005, 0006의 결정을 고치지 마라. 이유: 보류된 차감을 저장하지 않는 결정과 폐기 버튼의 멱등키 결정은 그대로 유효하다.
- "끼니 중량 상한" 백로그 항목을 지우거나 기획에 옮기지 마라. 이유: 이 task의 범위가 아니다.
- 강조 기호로 `⚠`를 쓰지 마라. 이유: 달력에서 반응있음 재료를 뜻한다(ADR 0008).
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
