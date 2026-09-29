# break-it: pantry-and-expiry

phase 7에서 고장 세 개를 하나씩 넣었다. 그때마다 phase 파일이 지목한 테스트가 실제로 실패하는지 확인했다. 실험 기준은 phase 6 커밋 `f4eb7ad`다. 인용한 출력은 모두 이 세션에서 실제로 돌린 `pnpm vitest run --project unit <파일>`의 출력이다. 고장은 편집으로 넣고, 원래 파일을 다시 써서 되돌렸다. 되돌릴 때마다 `git diff --quiet HEAD -- src`가 차이 없음을 확인했다.

실험에 앞서 phase 6이 남긴 통합 테스트 기대값 하나를 고쳤다. phase 6은 `daily_brief` 템플릿 버전을 3으로 올렸다(`src/slack/templates/daily-brief.ts`). 그런데 `test/integration/slack-delivery.int-spec.ts`의 "보낸 브리프는 채널, ts, 템플릿 버전과 보낸 페이로드 그대로 slack_message에 남는다"는 여전히 `templateVersion: 2`를 기대했다. 그래서 `pnpm test:int`가 phase 6 커밋에서 `Tests  1 failed | 380 passed (381)`였다(`expected 2`, `received 3`). phase 6의 AC에 통합 테스트가 없어 이 실패가 그대로 커밋됐다. 그 한 줄만 `templateVersion: 3`으로 바꿨다. `reaction_prompt`의 `templateVersion: 1`은 그대로 두었다.

| # | 고장 | 지목한 테스트가 잡았나 | 되돌린 뒤 |
|---|---|---|---|
| 1 | `targetOf`에서 상비 제외 삭제 | 잡았다 | 34개 통과 |
| 2 | `EXPIRY_NOTICE_DAYS`를 3에서 1로 | 잡았다. 다른 테스트 하나도 함께 실패했다 | 42개 통과 |
| 3 | `buildDailyBrief`의 `nextExpiry`를 언제나 `null`로 | 잡았다. 브리프 템플릿과 상태판 spec은 잡지 못한다 | 28개 통과 |

## 1. `targetOf`의 상비 제외

`src/domain/deduction/reconcile.ts`의 `targetOf`에서 상비 필터를 지웠다. 이제 상비 필요량도 차감 대상에 들어간다.

```diff
   const targetOf = (state: DueState): CubeNeed[] =>
     state.due
-      ? expandToCubeNeeds(effectiveComposition(state.meal), input.menus).filter((need) => !isPantry(need.ingredientId))
+      ? expandToCubeNeeds(effectiveComposition(state.meal), input.menus)
       : [];
```

`src/domain/deduction/deduction.spec.ts`를 돌리자 지목한 테스트 하나가 실패했다.

```
 ❯ |unit| src/domain/deduction/deduction.spec.ts (34 tests | 1 failed) 21ms
     × 상비 재료는 재고가 없어도 차감하지 않고 보류하지 않는다 4ms

 FAIL  |unit| src/domain/deduction/deduction.spec.ts > 상비 재료 > 상비 재료는 재고가 없어도 차감하지 않고 보류하지 않는다
AssertionError: expected [ { mealId: 'morning-1', …(3) } ] to deeply equal []

- Expected
+ Received

- []
+ [
+   {
+     "cubes": 1,
+     "ingredientId": "egg",
+     "mealDate": "2026-08-17",
+     "mealId": "morning-1",
+   },
+ ]

 ❯ src/domain/deduction/deduction.spec.ts:288:25

 Test Files  1 failed (1)
      Tests  1 failed | 33 passed (34)
```

상비 재료 `egg`에는 배치가 없다. 그래서 차감 대상에 들어가면 곧바로 보류된 차감이 된다. 테스트는 `held`가 비어 있는지 보고 이것을 잡았다.

같은 describe의 "상비 재료의 소비 이벤트는 되돌리지 않는다"는 통과했다. 되돌림 루프는 `consumedBatches`에서 상비 배치를 따로 거른다(`.filter(({ batch }) => !isPantry(batch.ingredientId))`). 이번 고장은 그 필터를 건드리지 않았으므로 통과하는 것이 맞다.

되돌린 뒤 같은 파일은 `Tests  34 passed (34)`였다.

## 2. `EXPIRY_NOTICE_DAYS`

`src/domain/stock/expiry.ts`의 상수를 바꿨다.

```diff
 export const DEFAULT_SHELF_LIFE_DAYS = 14;
 /** Days before the expiry date from which a batch is called due soon and its row is highlighted. */
-export const EXPIRY_NOTICE_DAYS = 3;
+export const EXPIRY_NOTICE_DAYS = 1;
```

`src/domain/stock/stock.spec.ts`를 돌리자 두 개가 실패했다. 지목한 테스트와 "임박 배치도 임계일 알람 대상이다"다.

```
 ❯ |unit| src/domain/stock/stock.spec.ts (42 tests | 2 failed) 18ms
     × 임계일 3일 전부터 임박이고 daysLeft가 3이다 4ms
     × 임박 배치도 임계일 알람 대상이다 1ms

 FAIL  |unit| src/domain/stock/stock.spec.ts > 임계일 > 임계일 3일 전부터 임박이고 daysLeft가 3이다
AssertionError: expected { kind: 'fresh' } to deeply equal { kind: 'due_soon', daysLeft: 3 }

- Expected
+ Received

  {
-   "daysLeft": 3,
-   "kind": "due_soon",
+   "kind": "fresh",
  }

 ❯ src/domain/stock/stock.spec.ts:164:35

 FAIL  |unit| src/domain/stock/stock.spec.ts > 재고현황 > 임박 배치도 임계일 알람 대상이다
AssertionError: expected [ [ 'expired', …(1) ], …(2) ] to deeply equal [ [ 'expired', …(1) ], …(3) ]

- Expected
+ Received

@@ -12,17 +12,10 @@
        "daysLeft": 1,
        "kind": "due_soon",
      },
    ],
    [
-     "due-in-3-days",
-     {
-       "daysLeft": 3,
-       "kind": "due_soon",
-     },
-   ],
-   [
      "beef-batch",

 Test Files  1 failed (1)
      Tests  2 failed | 40 passed (42)
```

임계일 사흘 전 배치가 `fresh`가 되었다. 그래서 단계 경계 테스트가 실패했고, 그 배치가 임계일 알람 대상에서도 빠졌다. 하루 전 배치(`due-tomorrow`)와 당일 배치(`beef-batch`)는 새 경계 1 안에 있어 그대로 남았다.

되돌린 뒤 같은 파일은 `Tests  42 passed (42)`였다.

## 3. `buildDailyBrief`의 `nextExpiry`

`src/application/daily-brief.ts`에서 재고 행의 `nextExpiry`를 언제나 `null`로 바꿨다.

```diff
       depletionDate: forecasts.get(stock.ingredientId)?.depletionDate ?? null,
       // 배치는 조리일 순이라 첫 배치의 임계일이 가장 이르다.
-      nextExpiry:
-        stock.batches.length === 0
-          ? null
-          : {
-              date: expiryDateOf(stock.batches[0].batch, state.alertSettings.shelfLifeDays),
-              stage: stock.batches[0].expiry,
-            },
+      nextExpiry: null,
     })),
```

`src/application/daily-brief.spec.ts`를 돌리자 지목한 테스트 하나가 실패했다.

```
 ❯ |unit| src/application/daily-brief.spec.ts (28 tests | 1 failed) 14ms
       × 임계일 열은 잔여가 있는 가장 이른 배치의 임계일과 단계다 3ms

 FAIL  |unit| src/application/daily-brief.spec.ts > 데일리 브리프 > 재고현황 > 임계일 열은 잔여가 있는 가장 이른 배치의 임계일과 단계다
AssertionError: expected null to deeply equal { date: '2026-09-23', stage: { …(2) } }

- Expected:
{
  "date": "2026-09-23",
  "stage": {
    "daysLeft": 1,
    "kind": "due_soon",
  },
}

+ Received:
null

 ❯ src/application/daily-brief.spec.ts:273:74

 Test Files  1 failed (1)
      Tests  1 failed | 27 passed (28)
```

"배치가 없는 재료의 임계일 열은 비어 있다"는 통과했다. 고장 뒤의 값도 `null`이므로 통과하는 것이 맞다.

### 이 고장을 잡는 곳은 `src/application/daily-brief.spec.ts` 하나다

같은 고장을 넣은 채로 `DailyBrief`를 소비하는 다른 spec도 돌렸다.

| spec | 결과 |
|---|---|
| `src/application/household-board.spec.ts` | `Tests  15 passed (15)` |
| `src/slack/templates/daily-brief.spec.ts` | `Tests  27 passed (27)` |
| `src/slack/templates/household-board.spec.ts` | `Tests  12 passed (12)` |

세 파일은 `DailyBrief` 픽스처를 직접 만들어 넣는다. 그래서 `buildDailyBrief`가 무엇을 계산하든 결과가 달라지지 않는다. 이 spec들은 `nextExpiry`가 주어졌을 때 임계일 열과 강조를 어떻게 그리는지를 본다. `nextExpiry`를 올바르게 채우는지는 보지 않는다. 계산의 회귀는 `src/application/daily-brief.spec.ts`만 잡는다. `pnpm test` 전체로는 `Tests  1 failed | 477 passed (478)`였고, 실패한 하나는 위 테스트다.

되돌린 뒤 `src/application/daily-brief.spec.ts`는 `Tests  28 passed (28)`였다. `git diff --quiet HEAD -- src`도 차이가 없었다.
