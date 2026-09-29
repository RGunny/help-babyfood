# ADR 0009: 상비 재료는 재고를 세지 않고, 임계일은 재고 표의 열로 보이며 3일 전부터 강조한다

- 상태: 채택
- 결정일: 2026-09-29

## 맥락

2026-09-26 이관 뒤 사흘 동안 운영하면서 사용자가 세 가지를 결정했다. 셋 다 `docs/backlog.md`에 적혔다가 이 ADR로 옮겨졌으므로 발언은 여기에만 남는다.

첫째, 땅콩버터, 계란, 밀가루는 큐브로 만들지 않고 늘 집에 있는 재료다. 2026-09-29에 사용자는 "재고 무한으로 해 놔"라고 했고, 큰 배치를 입고로 넣는 우회 대신 정식 기능을 택했다. 지금은 세 재료의 재고가 0이라 `reconcileMeals`(`src/domain/deduction/reconcile.ts`)가 끼니마다 그 재료의 차감을 `held`에 넣고, 상태판의 확인 필요에 "재고 부족으로 보류된 차감: 계란 1개"가 매일 오르며, `forecastShortage`(`src/domain/forecast/shortage-forecast.ts`)가 부족 1개를 계속 돌려준다.

둘째, 2026-09-29에 사용자는 "슬랙에 임계일 섹션은 필요 없어 보이고 재고 표에서 그냥 같이 보면 될 것 같아"라고 했고, 이어서 "임계치 도달 3일 전 그 행을 색칠이나 하이라이트 가능한가?"라고 물었다. 상태판과 브리프에는 재고 표와 별도로 배치 단위의 임계일 목록이 있는데(`src/slack/templates/household-board.ts`의 `expiryLines`, `src/slack/templates/daily-brief.ts`의 `expiryBlocks`), 사용자는 그 목록을 읽지 않는다.

셋째, 2026-09-29에 사용자는 "폐기 신경 쓰지 말라니까?"와 "임계일은 폐기 기한이랑 관련 없는 거 알지? 폐기는 그냥 추가 정보야"라고 했다. 임계일은 조리 후 14일이 지났음을 알리는 정보이지 버려야 하는 날이 아니다. 폐기는 부모가 실제로 버렸을 때만 기록하는 별개의 행위다. 기획안 4.5절의 "임계일 초과 N일째, 폐기 필요"를 매일 반복하는 알람과 배치 상태 "폐기 대기"는 이 모델과 다르다. 코드도 같은 이름을 쓴다. `ExpiryStage`의 `pending_discard`(`src/domain/stock/expiry.ts`), `IngredientStock.pendingDiscard`(`src/domain/stock/stock-summary.ts`), 라벨 "기한 N일 초과, 폐기 대기"(`src/slack/templates/labels.ts`)다.

정할 것은 다섯이다. 상비 재료를 도메인 모델에 어떻게 두는지, 상비 제외를 어느 층이 하는지, 상비 전환의 조건과 도구, 임계일을 재고 표에서 어떻게 보이고 언제 강조하는지, "폐기 대기"라는 말을 무엇으로 바꾸는지다.

## 결정

### 재료에 재고 방식이 생긴다: 큐브 추적과 상비

`Ingredient`에 `stockTracking: 'cubes' | 'pantry'`를 둔다(`src/domain/ingredient/ingredient.ts`). 큐브 추적(`cubes`)은 지금까지의 방식이고, 조리 배치와 원장으로 잔여 큐브를 센다. 상비(`pantry`)는 냉동 큐브가 아니라 늘 집에 있는 재료이고 땅콩버터, 계란, 밀가루가 여기 든다. 기획안 4.1절의 "모든 재료는 조리 후 냉동 큐브로 보관한다"에 예외가 생기는 것이고, 그 예외를 4.1절에 적는다.

근거는 기획안 4.4절의 보류 규칙이다. 보류는 "입고 등록이 늦었던 경우를 위해" 다음 정합화에서 다시 시도하는 장치다. 상비 재료는 입고가 영영 없으므로 보류가 매일 반복되고 풀리지 않는다. 규칙이 틀린 것이 아니라 규칙이 적용되면 안 되는 재료에 적용되는 것이므로, 규칙을 고치지 않고 재료에 방식을 둔다.

큰 배치를 입고로 넣는 우회는 택하지 않았다. 입고 수량은 원장 이벤트라 "무한"을 표현할 수 없고, 언젠가 0이 되면 같은 보류가 다시 생긴다. 임계일 계산(조리일 + 14일)도 붙어서 존재하지 않는 큐브의 임계일이 표에 오른다.

### 상비 제외는 도메인이 한다

`summarizeStock`, `forecastShortage`, `reconcileMeals` 셋 다 상비 재료를 결과와 차감에서 뺀다. 호출자는 거르지 않는다.

호출자가 거르면 재고 현황, 부족 예측, 정합화 세 호출자가 같은 규칙을 세 번 쓴다. 특히 `reconcileMeals`는 `input.catalog.getById(need.ingredientId)`로 카탈로그 전체를 요구하므로(`src/domain/deduction/reconcile.ts`), 호출자가 상비 재료를 빼서 넘기면 상비 재료가 든 식단에서 `getById`가 실패한다. 상비 재료를 아는 것은 도메인뿐이고, 그것이 동결된 `src/domain`을 여는 이유다. ADR 0008이 회차 투영을 애플리케이션이 아니라 도메인에 둔 것과 같은 판단이다.

규칙은 다음과 같다.

- 상비 재료의 큐브 필요량은 차감하지 않고 보류도 만들지 않는다. `reconcileMeals`의 `held`에 상비 재료가 들어가지 않는다.
- 상비 재료 배치의 소비 이벤트는 되돌리지도 않는다. 상비 재료는 원장과 무관하다. 상비로 바꾸려면 잔여 큐브가 0이어야 하므로(아래) 되돌릴 소비가 남아 있는 경우는 잔여가 0인 배치의 과거 소비뿐이고, 그것은 이미 먹인 기록으로 둔다.
- 상비 재료는 재고 현황과 부족 예측에 나오지 않는다. `summarizeStock`과 `forecastShortage`의 결과 배열에 상비 재료 행이 없다. 브리프와 상태판은 대신 `pantryIngredients` 목록으로 이름만 보인다.
- 도입 상태(기획안 4.6절)는 급여 이력으로 계산하므로 영향이 없다. 계란은 검증중 그대로다.

### 상비 전환의 조건과 도구

기획안 7장의 재료 도구에 `update_ingredient_stock_tracking(idempotencyKey, name, stockTracking)`을 더한다.

큐브 추적에서 상비로 바꾸려면 그 재료의 잔여 큐브가 0이어야 한다. 남아 있으면 `PANTRY_WITH_STOCK`으로 거부한다. 상비 재료는 재고 표에서 사라지므로, 큐브가 남은 채로 바꾸면 냉동고에 있는 큐브가 어디에도 보이지 않게 된다. 상비 재료에는 `register_cooked_batch`를 `PANTRY_INGREDIENT`로, 임계개수 설정(`update_alert_settings`)을 `INVALID_THRESHOLD`로 거부한다. 입고가 없으니 배치를 만들 수 없고, 재고를 세지 않으니 임계개수가 뜻이 없다. 상비에서 큐브 추적으로 되돌리는 것은 조건이 없다. 되돌린 뒤 입고를 등록하면 그때부터 센다.

`register_ingredient`는 바꾸지 않는다. 새 재료는 큐브 추적으로 시작하고 상비 전환은 별도 도구로 한다. 등록 도구에 선택 인자와 기본값을 두지 않기 위해서다(AGENTS.md 금지 2번).

### 임계일 목록을 없애고 재고 표에 임계일 열을 둔다

상태판과 브리프의 임계일 목록(배치 단위)을 없앤다. 대신 재고 표에 재료마다 잔여 배치 중 가장 이른 임계일을 `임계일` 열로 보인다.

읽기 모델은 `BriefStockRow.nextExpiry: { date, stage } | null`이다(`src/application/daily-brief.ts`). 애플리케이션이 `IngredientStock.batches`의 첫 배치에서 채운다. `summarizeStock`이 배치를 `oldestCookedFirst`로 정렬하므로 첫 배치가 조리일이 가장 이른 배치이고, 임계일은 조리일 + 14일이라 그 배치의 임계일이 가장 이르다. `date`는 `expiryDateOf`, `stage`는 그 배치의 `expiry`다. 잔여 배치가 없으면 null이다.

ADR 0007의 "임계일 알람은 표에 넣지 않는다. 재료가 아니라 배치 단위이고, 배치마다 '폐기 완료' 버튼이 붙는다"를 뒤집는다. 배치 단위가 맞지만 사용자는 그 목록을 읽지 않는다. 표의 열은 재료 단위이고 가장 이른 배치 하나를 대표로 보이면 "무엇이 오래됐는가"를 읽는 데 충분하다. 폐기 버튼은 브리프 메시지에서 재고 표 아래에 배치마다 그대로 남는다. 버튼의 멱등키와 응답 규칙은 ADR 0006 그대로다. 캔버스에는 버튼이 없으므로(ADR 0008) 상태판에는 버튼이 없다.

### 임계일 3일 전부터 강조하고, 강조 판정은 도메인이 한다

`ExpiryStage`를 `fresh | due_soon { daysLeft } | overdue { overdueDays }`로 바꾼다(`src/domain/stock/expiry.ts`). `due_soon`은 임계일 3일 전부터 당일까지이고 `daysLeft`는 3, 2, 1, 0이다. 3일은 도메인 상수 `EXPIRY_NOTICE_DAYS = 3`이다. 사용자가 "3일 전"이라고 정한 값이고 알람 설정 항목을 늘리지 않는다(ADR 0005가 `PLAN_RUNWAY_WARNING_DAYS`를 코드 상수로 둔 것과 같다).

기획안 4.5절의 단계 표는 다음으로 바뀐다.

| 시점 | 단계 | 표시 |
|---|---|---|
| 임계일 4일 전까지 | 여유 (`fresh`) | 없음 |
| 임계일 3일 전부터 당일까지 | 임박 (`due_soon`) | 행 강조 |
| 임계일 다음 날부터 | 지남 (`overdue`) | 행 강조, 브리프에 폐기 버튼 |
| 부모가 폐기 완료를 지시한 때 | 폐기됨 | 표에서 사라짐 |

재료의 `nextExpiry.stage.kind`가 `fresh`가 아니면 그 행을 강조한다. 템플릿은 그 값만 읽고 날짜 계산을 하지 않는다. 어댑터가 재고 규칙을 다시 쓰지 않는다는 AGENTS.md의 계층 규약이고, 강조 기준이 바뀌면 도메인 상수 하나만 바뀐다.

강조 방법은 두 화면이 다르다. 캔버스 마크다운은 셀 색이 없어서(ADR 0008이 실측한 제약) 재료명을 굵게 하고 앞에 기호를 붙인다. 브리프 표는 Block Kit `raw_text` 셀이라 굵게가 없으므로 기호만 붙인다. 기호는 `⏰`이다. 달력의 반응있음 기호 `⚠`(ADR 0008)와 다른 문자를 쓴다. 같은 캔버스 안에서 달력의 `⚠`는 "반응 있었던 재료가 식단에 있다"이고, 재고 표에서 같은 문자를 쓰면 한 기호가 두 뜻을 가진다. 부모는 기호를 보고 어느 표인지 다시 확인해야 한다.

### "폐기 대기"라는 말을 없앤다

`IngredientStock.pendingDiscard`는 `overdue`가 되고, 사용자에게 보이는 말은 "폐기 대기"에서 "임계 지남"으로 바뀐다. 기획안 6장 조리 배치의 상태 "(가용, 폐기 대기, 폐기됨)"은 "(가용, 임계 지남, 폐기됨)"이 된다. "폐기 필요" 문구는 어디에도 남지 않는다.

임계일이 지난 배치를 합계, 자동 차감, 소진 예측에 똑같이 넣는 규칙(기획안 4.5절)은 그대로다. 서버가 임계일을 이유로 재고를 줄이지 않는 것도 그대로다. 바뀌는 것은 이름과 문구뿐이다. 근거는 맥락의 세 번째 발언이다. 임계일은 정보이고 폐기는 부모의 행위이므로, 서버가 배치를 "폐기 대기"로 부르는 것은 서버가 폐기를 요구하는 것처럼 읽힌다.

## 층별 결합

```
domain      Ingredient.stockTracking, EXPIRY_NOTICE_DAYS, ExpiryStage(fresh | due_soon | overdue)
            summarizeStock · forecastShortage · reconcileMeals 가 상비 재료를 뺀다
                │
application HouseholdWritePort.updateStockTracking
            DailyBrief: BriefStockRow.nextExpiry, BriefStockRow.overdue, pantryIngredients
                │
slack       templates/daily-brief.ts, household-board.ts 가 DailyBrief만 읽는다
mcp         update_ingredient_stock_tracking, get_stock_status 출력 필드 이름
```

도메인에 더하는 것은 재료 속성 하나(`stockTracking`), 단계 상수 하나(`EXPIRY_NOTICE_DAYS`), 세 함수의 상비 제외다. 프레임워크, DB, 시계를 여전히 모른다. 상비 여부는 `Ingredient`에 있으므로 세 함수는 이미 받는 인자로 판정하고 시그니처가 늘지 않는다.

애플리케이션은 포트 메서드 `updateStockTracking` 하나와 읽기 모델 필드 `nextExpiry`, `pantryIngredients`, `overdue`를 더한다. 보류된 차감을 저장하지 않고 `reconcileMeals`를 다시 걸어 `held`만 가져가는 구조(ADR 0005)는 그대로이고, 상비 재료가 `held`에 오지 않으므로 애플리케이션이 따로 거를 것이 없다.

Slack 템플릿은 `DailyBrief`만 읽는다. 강조 여부는 `nextExpiry.stage.kind`로 판정하고 날짜를 계산하지 않는다. 임계일 목록 섹션과 그 라인 함수는 사라지고, 폐기 버튼은 `overdue` 배치에 그대로 붙는다.

MCP는 도구 하나(`update_ingredient_stock_tracking`)를 더하고 `get_stock_status`, `get_daily_brief`의 출력 필드 이름을 읽기 모델에 맞춘다.

## 대가와 남는 위험

- `ingredient` 테이블에 `stock_tracking` 컬럼이 하나 늘고 운영 DB에 마이그레이션을 사람이 돌린다. 배포 전 명령이 아직 설정되지 않았기 때문이다(`docs/user-intervention.md` 6번, 10번). 그 뒤 세 재료를 상비로 바꾸는 것도 사람이 한다.
- 상비 재료의 급여량은 원장에 남지 않는다. "계란을 몇 번 먹였는가"는 급여 이력으로 알 수 있지만 "몇 g"은 알 수 없다.
- MCP 출력의 필드 이름이 바뀐다. `pendingDiscard`가 `overdue`로, `expiryAlerts`의 단계 `kind`가 `fresh | due_soon | overdue`로 바뀐다. 소비자는 Claude Code뿐이라 호환 필드를 두지 않는다.
- `due_soon`이 생기면서 `batchesNeedingExpiryAlert`가 3일 전 배치도 돌려준다. `get_stock_status`의 `expiryAlerts`가 그만큼 길어진다.
- 강조 기호는 캔버스와 Block Kit 표에서 색이 아니라 문자다. 휴대폰에서 얼마나 눈에 띄는지는 배포 뒤 사람이 본다.
