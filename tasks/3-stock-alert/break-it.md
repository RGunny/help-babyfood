# break-it: stock-alert

phase 7에서 고장 다섯 개를 하나씩 넣었다. 그때마다 phase 파일이 지목한 테스트가 실제로 실패하는지 확인했다. 실험 기준은 phase 6 커밋 `3a8e5bb`다. 시작 전에 `pnpm prisma:generate`를 돌렸다. 인용한 출력은 모두 이 세션에서 실제로 돌린 명령의 출력이고, 색 코드와 빈 줄, 스택의 `node_modules` 줄만 걷어 냈다. 고장은 편집으로 넣고 편집으로 되돌렸다. 되돌릴 때마다 `git diff --quiet HEAD -- src test prisma; echo $?`가 `0`을 찍은 것을 확인하고 다음 고장으로 넘어갔다.

| # | 고장 | 지목한 테스트 | 실제로 실패한 테스트 | 결과 | 되돌린 뒤 |
|---|---|---|---|---|---|
| 1 | `STOCK_ALERT_HORIZON_DAYS`를 7에서 0으로 | 첫 부족일이 7일 안이면 upcoming이다 | 지목한 테스트 외 3개, 모두 4개 | 잡았다 | 39개 통과 |
| 2 | `dispatchStockAlert`의 `no_alert` 종결 삭제 | 알람 항목이 없으면 no_alert로 종결하고 보내지 않는다 | 지목한 테스트 1개 | 잡았다 | 23개 통과 |
| 3 | `claimDueStockAlerts` 첫 문장의 `ON CONFLICT (household_id, date) DO NOTHING` 삭제 | 재고 알람은 하루 한 건이다 | 지목한 테스트 외 6개, 모두 7개. 전부 기본키 충돌(`23505`)로 질의가 던졌다 | 잡았다 | 34개 통과 |
| 4 | 같은 문장의 `WHERE COALESCE(a.brief_time, …) <= ${due.time}` 삭제 | 브리프 시각 전에는 재고 알람을 클레임하지 않는다 | 지목한 테스트 외 1개, 모두 2개 | 잡았다 | 34개 통과 |
| 5 | `byUrgency`의 첫 기준을 `depletionDate`로 | 재고 표는 부족 시작일이 이른 순이다 | 지목한 테스트 외 3개, 모두 4개 | 잡았다 | 29개 통과 |

## 1. `STOCK_ALERT_HORIZON_DAYS`

`src/application/daily-brief.ts`의 상수를 0으로 바꿨다. 알람 창이 오늘 하루로 줄어든다.

```diff
  * decided and ten within the week, and the shortfall it reports is what one cooking session can
  * make rather than a month of rice.
  */
-export const STOCK_ALERT_HORIZON_DAYS = 7;
+export const STOCK_ALERT_HORIZON_DAYS = 0;
 
 /**
  * Days ahead of today within which a first shortage is urgent. Not a stored setting either.
```

`pnpm vitest run --project unit src/application/daily-brief.spec.ts`를 돌리자 네 개가 실패했다. 지목한 "첫 부족일이 7일 안이면 upcoming이다"가 그중 하나다.

```
 ❯ |unit| src/application/daily-brief.spec.ts (39 tests | 4 failed) 20ms
       × 첫 부족일이 오늘이나 내일이면 urgent다 3ms
       × 첫 부족일이 7일 안이면 upcoming이다 1ms
       × 7일 안의 부족 수량은 7일 안의 식단만 센다 1ms
       × 항목은 첫 부족일이 이른 순이고 첫 부족일이 없는 항목이 뒤다 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |unit| src/application/daily-brief.spec.ts > 데일리 브리프 > 재고 알람 > 첫 부족일이 오늘이나 내일이면 urgent다
AssertionError: expected +0 to be 7 // Object.is equality
- Expected
+ Received
- 7
+ 0
 ❯ src/application/daily-brief.spec.ts:346:44
    344|       });
    345|
    346|       expect(today.stockAlert.horizonDays).toBe(7);
       |                                            ^
    347|       expect(today.stockAlert.items).toMatchObject([
    348|         { name: '완두콩', firstShortageDate: TODAY, daysUntilShortage: 0,…
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯
 FAIL  |unit| src/application/daily-brief.spec.ts > 데일리 브리프 > 재고 알람 > 첫 부족일이 7일 안이면 upcoming이다
AssertionError: expected [] to deeply equal [ { ingredientId: 'beef', …(7) } ]
- Expected
+ Received
- [
-   {
-     "daysUntilShortage": 7,
-     "firstShortageDate": "2026-09-29",
-     "horizonShortfallCubes": 1,
-     "ingredientId": "beef",
-     "name": "소고기",
-     "thresholdCubes": null,
-     "total": 7,
-     "urgency": "upcoming",
-   },
- ]
+ []
 ❯ src/application/daily-brief.spec.ts:361:38
    359|       });
    360|
    361|       expect(today.stockAlert.items).toEqual([
       |                                      ^
    362|         {
    363|           ingredientId: 'beef',
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯
 FAIL  |unit| src/application/daily-brief.spec.ts > 데일리 브리프 > 재고 알람 > 7일 안의 부족 수량은 7일 안의 식단만 센다
AssertionError: expected [] to match object [ { name: '소고기', …(3) } ]
- Expected
+ Received
- [
-   {
-     "firstShortageDate": "2026-09-28",
-     "horizonShortfallCubes": 2,
-     "name": "소고기",
-     "urgency": "upcoming",
-   },
- ]
+ []
 ❯ src/application/daily-brief.spec.ts:451:38
    449|
    450|       expect(today.shortages).toMatchObject([{ name: '소고기', shortfallC…
    451|       expect(today.stockAlert.items).toMatchObject([
       |                                      ^
    452|         { name: '소고기', firstShortageDate: dateOf(6), horizonShortfallC…
    453|       ]);
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯
 FAIL  |unit| src/application/daily-brief.spec.ts > 데일리 브리프 > 재고 알람 > 항목은 첫 부족일이 이른 순이고 첫 부족일이 없는 항목이 뒤다
AssertionError: expected [ [ '쌀', null ], [ '완두콩', null ] ] to deeply equal [ [ '브로콜리', '2026-09-23' ], …(3) ]
- Expected
+ Received
@@ -1,15 +1,7 @@
  [
    [
-     "브로콜리",
-     "2026-09-23",
-   ],
-   [
-     "소고기",
-     "2026-09-25",
-   ],
-   [
      "쌀",
      null,
    ],
    [
      "완두콩",
 ❯ src/application/daily-brief.spec.ts:502:89
    500|       });
    501|
    502|       expect(today.stockAlert.items.map((item) => [item.name, item.fir…
       |                                                                                         ^
    503|         ['브로콜리', dateOf(1)],
    504|         ['소고기', dateOf(3)],
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯
 Test Files  1 failed (1)
      Tests  4 failed | 35 passed (39)
```

실패한 테스트는 다음 넷이다.

- 첫 부족일이 오늘이나 내일이면 urgent다: `horizonDays`가 7이 아니라 0이다.
- 첫 부족일이 7일 안이면 upcoming이다: 7일 뒤 부족인 소고기가 항목에서 빠졌다.
- 7일 안의 부족 수량은 7일 안의 식단만 센다: 엿새 뒤 부족인 소고기가 빠졌다.
- 항목은 첫 부족일이 이른 순이고 첫 부족일이 없는 항목이 뒤다: 첫 부족일이 있는 항목이 모두 빠지고 임계 항목만 남았다.

되돌린 뒤 `git diff --quiet HEAD -- src test prisma; echo $?`는 `0`이었다. 같은 파일은 `Tests  39 passed (39)`였다.

## 2. `dispatchStockAlert`의 `no_alert` 종결

`src/application/brief-dispatch.service.ts`에서 항목이 비었을 때 `no_alert`로 종결하는 분기를 지웠다. 이제 항목이 없어도 보낸다.

```diff
     const { householdId } = claim;
     try {
       const brief = await this.brief.get(householdId);
-      if (brief.stockAlert.items.length === 0) {
-        await this.log.recordSkipped(claim, NO_ALERT, instant);
-        return { kind: 'skipped', target, householdId, reason: NO_ALERT };
-      }
-
       const result = await this.delivery.deliverStockAlert(householdId, {
         date: claim.date,
         alert: brief.stockAlert,
```

`pnpm vitest run --project unit src/application/brief-dispatch.service.spec.ts`를 돌리자 지목한 테스트 하나만 실패했다.

```
 ❯ |unit| src/application/brief-dispatch.service.spec.ts (23 tests | 1 failed) 11ms
     × 알람 항목이 없으면 no_alert로 종결하고 보내지 않는다 5ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |unit| src/application/brief-dispatch.service.spec.ts > 재고 알람 > 알람 항목이 없으면 no_alert로 종결하고 보내지 않는다
AssertionError: expected [] to deeply equal [ { claim: { …(4) }, …(2) } ]
- Expected
+ Received
- [
-   {
-     "at": 2026-09-22T22:30:00.000Z,
-     "claim": {
-       "attempts": 1,
-       "date": "2026-09-23",
-       "householdId": "재하네",
-       "kind": "stock_alert",
-     },
-     "reason": "no_alert",
-   },
- ]
+ []
 ❯ src/application/brief-dispatch.service.spec.ts:547:25
    545|     const outcomes = await service.runEveryHousehold();
    546|
    547|     expect(log.skipped).toEqual([{ claim: alertClaim('재하네'), reason: '…
       |                         ^
    548|     expect(log.released).toEqual([]);
    549|     expect(delivery.alerts).toEqual([]);
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
 Test Files  1 failed (1)
      Tests  1 failed | 22 passed (23)
```

`log.skipped`가 비어 있어 첫 단언에서 멈췄다. 같은 `describe`("재고 알람")의 다른 테스트는 항목이 있는 브리프를 쓰므로 통과했다.

되돌린 뒤 `git diff --quiet HEAD -- src test prisma; echo $?`는 `0`이었다. 같은 파일은 `Tests  23 passed (23)`였다.

## 3. `ON CONFLICT (household_id, date) DO NOTHING`

`src/infrastructure/prisma/brief-delivery-log.repository.ts`의 `claimDueStockAlerts` 첫 문장(`INSERT … SELECT`)에서 `ON CONFLICT` 절을 지웠다.

```diff
       FROM household h
       LEFT JOIN alert_settings a ON a.household_id = h.id
       WHERE COALESCE(a.brief_time, ${DEFAULT_BRIEF_TIME}) <= ${due.time}
-      ON CONFLICT (household_id, date) DO NOTHING
       RETURNING household_id, attempts
     `;
 
```

`pnpm vitest run --project integration test/integration/brief-delivery.int-spec.ts`를 돌리자 "재고 알람 클레임" `describe`의 일곱 개가 실패했다. 일곱 개 모두 이미 행이 있는 가정과 날짜로 다시 클레임할 때 `stock_alert_delivery_pkey` 기본키 충돌(`PrismaClientKnownRequestError`, 코드 `23505`)로 질의가 던졌다. 첫 실패 하나만 전문을 싣는다. 나머지 여섯도 오류 문구와 던진 곳(`brief-delivery-log.repository.ts:128:21`)이 같고, 테스트 파일의 호출 줄만 다르다.

```
 ❯ |integration| test/integration/brief-delivery.int-spec.ts (34 tests | 7 failed) 1461ms
     × 재고 알람은 하루 한 건이다 47ms
     × 같은 가정과 날짜의 재고 알람을 동시에 두 번 클레임하면 한쪽만 행을 얻는다 31ms
     × 보냈다고 기록한 재고 알람은 다시 클레임되지 않는다 34ms
     × 건너뛰었다고 기록한 재고 알람도 다시 클레임되지 않는다 36ms
     × 실패한 재고 알람은 다음 시도 시각이 지나면 잡히고 시도 횟수가 1 늘어난다 36ms
     × 시도 횟수가 상한인 재고 알람은 다음 시도 시각이 지나도 잡히지 않는다 34ms
     × 발송 중에 죽어 pending으로 남은 재고 알람은 리스가 지나면 다시 잡힌다 34ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |integration| test/integration/brief-delivery.int-spec.ts > 재고 알람 클레임 > 재고 알람은 하루 한 건이다
PrismaClientKnownRequestError: 
Invalid `prisma.$queryRaw()` invocation:
Raw query failed. Code: `23505`. Message: `duplicate key value violates unique constraint "stock_alert_delivery_pkey"`
 ❯ PrismaBriefDeliveryLog.claimDueStockAlerts src/infrastructure/prisma/brief-delivery-log.repository.ts:128:21
    126|    */
    127|   async claimDueStockAlerts(due: DeliveryDue): Promise<StockAlertClaim…
    128|     const claimed = await this.prisma.$queryRaw<BriefClaimRow[]>`
       |                     ^
    129|       INSERT INTO stock_alert_delivery (household_id, date, status, at…
    130|       SELECT h.id, ${due.date}::date, 'pending'::delivery_status, 1, $…
 ❯ test/integration/brief-delivery.int-spec.ts:257:12
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/7]⎯
…(나머지 여섯 생략)
 Test Files  1 failed (1)
      Tests  7 failed | 27 passed (34)
```

실패한 테스트는 다음 일곱이다.

- 재고 알람은 하루 한 건이다
- 같은 가정과 날짜의 재고 알람을 동시에 두 번 클레임하면 한쪽만 행을 얻는다
- 보냈다고 기록한 재고 알람은 다시 클레임되지 않는다
- 건너뛰었다고 기록한 재고 알람도 다시 클레임되지 않는다
- 실패한 재고 알람은 다음 시도 시각이 지나면 잡히고 시도 횟수가 1 늘어난다
- 시도 횟수가 상한인 재고 알람은 다음 시도 시각이 지나도 잡히지 않는다
- 발송 중에 죽어 pending으로 남은 재고 알람은 리스가 지나면 다시 잡힌다

중복 행이 생겨 단언이 깨진 것이 아니라 기본키가 중복을 막아 질의 자체가 실패했다. 어느 쪽이든 하루 두 번째 클레임이 예외 없이 빈 결과를 내야 한다는 규칙을 테스트가 잡았다.

되돌린 뒤 `git diff --quiet HEAD -- src test prisma; echo $?`는 `0`이었다. 같은 파일은 `Tests  34 passed (34)`였다.

## 4. `brief_time` 조건

같은 문장에서 `WHERE COALESCE(a.brief_time, ${DEFAULT_BRIEF_TIME}) <= ${due.time}` 줄을 지웠다. 3번 고장은 되돌린 뒤라 `ON CONFLICT`는 그대로 있다.

```diff
       SELECT h.id, ${due.date}::date, 'pending'::delivery_status, 1, ${due.instant}, ${due.instant}
       FROM household h
       LEFT JOIN alert_settings a ON a.household_id = h.id
-      WHERE COALESCE(a.brief_time, ${DEFAULT_BRIEF_TIME}) <= ${due.time}
       ON CONFLICT (household_id, date) DO NOTHING
       RETURNING household_id, attempts
     `;
```

같은 명령을 돌리자 두 개가 실패했다.

```
 ❯ |integration| test/integration/brief-delivery.int-spec.ts (34 tests | 2 failed) 1565ms
     × 브리프 시각 전에는 재고 알람을 클레임하지 않는다 63ms
     × 알람 설정을 한 번도 저장하지 않은 가정도 기본 시각 07:30에 재고 알람이 클레임된다 31ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |integration| test/integration/brief-delivery.int-spec.ts > 재고 알람 클레임 > 브리프 시각 전에는 재고 알람을 클레임하지 않는다
AssertionError: expected [ { kind: 'stock_alert', …(3) } ] to deeply equal []
- Expected
+ Received
- []
+ [
+   {
+     "attempts": 1,
+     "date": "2026-09-22",
+     "householdId": "01a10bd7-4834-7529-b38b-f30b262905a8",
+     "kind": "stock_alert",
+   },
+ ]
 ❯ test/integration/brief-delivery.int-spec.ts:238:57
    236|     await setBriefTime(house, '09:00');
    237|
    238|     expect(await log.claimDueStockAlerts(due('08:59'))).toEqual([]);
       |                                                         ^
    239|     expect(await log.claimDueStockAlerts(due('09:00'))).toHaveLength(1…
    240|   });
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯
 FAIL  |integration| test/integration/brief-delivery.int-spec.ts > 재고 알람 클레임 > 알람 설정을 한 번도 저장하지 않은 가정도 기본 시각 07:30에 재고 알람이 클레임된다
AssertionError: expected [ { kind: 'stock_alert', …(3) } ] to deeply equal []
- Expected
+ Received
- []
+ [
+   {
+     "attempts": 1,
+     "date": "2026-09-22",
+     "householdId": "01a10bd7-4873-717c-b471-057ebe90f2cc",
+     "kind": "stock_alert",
+   },
+ ]
 ❯ test/integration/brief-delivery.int-spec.ts:245:57
    243|     const house = await household();
    244|
    245|     expect(await log.claimDueStockAlerts(due('07:29'))).toEqual([]);
       |                                                         ^
    246|
    247|     const claims = await log.claimDueStockAlerts(due('07:30'));
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯
 Test Files  1 failed (1)
      Tests  2 failed | 32 passed (34)
```

실패한 테스트는 지목한 "브리프 시각 전에는 재고 알람을 클레임하지 않는다"와 "알람 설정을 한 번도 저장하지 않은 가정도 기본 시각 07:30에 재고 알람이 클레임된다"다. 둘 다 시각 전(`08:59`, `07:29`)의 클레임이 빈 배열이어야 하는데 한 건을 얻었다.

되돌린 뒤 `git diff --quiet HEAD -- src test prisma; echo $?`는 `0`이었다. 같은 파일은 `Tests  34 passed (34)`였다.

## 5. `byUrgency`

`src/slack/templates/brief-lines.ts`의 `byUrgency` 첫 기준을 `firstShortageDate`에서 `depletionDate`로 되돌렸다.

```diff
  * earliest batch is near or past its expiry date. Within a group the order of `brief.stock` is kept.
  */
 export function byUrgency(a: IngredientRow, b: IngredientRow): number {
-  if (a.firstShortageDate !== b.firstShortageDate) {
-    if (a.firstShortageDate === null) return 1;
-    if (b.firstShortageDate === null) return -1;
-    return a.firstShortageDate.localeCompare(b.firstShortageDate);
+  if (a.depletionDate !== b.depletionDate) {
+    if (a.depletionDate === null) return 1;
+    if (b.depletionDate === null) return -1;
+    return a.depletionDate.localeCompare(b.depletionDate);
   }
   const threshold = Number(b.thresholdCubes !== null) - Number(a.thresholdCubes !== null);
   if (threshold !== 0) return threshold;
```

`pnpm vitest run --project unit src/slack/templates/daily-brief.spec.ts`를 돌리자 네 개가 실패했다. 마지막 스냅숏 diff는 길어 앞부분만 싣는다.

```
 ❯ |unit| src/slack/templates/daily-brief.spec.ts (29 tests | 4 failed) 14ms
       × 재고 표는 부족 시작일이 이른 순이다 4ms
       × 재고가 0이어도 식단에 있는 재료는 표에 남는다 1ms
       × 재고도 식단도 임계개수도 없는 재료만 재고 0 줄로 간다 0ms
     × 2026-09-26 운영 브리프와 같은 모양의 입력이 고정된 페이로드를 낸다 4ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |unit| src/slack/templates/daily-brief.spec.ts > 브리프 렌더링 > 재고현황 표 > 재고 표는 부족 시작일이 이른 순이다
AssertionError: expected [ '재료', '소진만', '먼저 부족', '늦게 부족', …(3) ] to deeply equal [ '재료', '먼저 부족', '늦게 부족', '임계', …(3) ]
- Expected
+ Received
  [
    "재료",
+   "소진만",
    "먼저 부족",
    "늦게 부족",
    "임계",
    "⏰ 임박",
    "나머지",
-   "소진만",
  ]
 ❯ src/slack/templates/daily-brief.spec.ts:340:55
    338|       );
    339|
    340|       expect(tableRows(blocks).map(([name]) => name)).toEqual([
       |                                                       ^
    341|         '재료',
    342|         '먼저 부족',
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯
 FAIL  |unit| src/slack/templates/daily-brief.spec.ts > 브리프 렌더링 > 재고현황 표 > 재고가 0이어도 식단에 있는 재료는 표에 남는다
AssertionError: expected [ …(2) ] to deeply equal [ …(2) ]
- Expected
+ Received
  [
    [
-     "당근",
-     "0",
-     "0",
+     "쌀",
+     "5",
+     "5",
      "0",
      "–",
-     "09-23",
+     "–",
      "–",
    ],
    [
-     "쌀",
-     "5",
-     "5",
+     "당근",
      "0",
-     "–",
+     "0",
+     "0",
      "–",
+     "09-23",
      "–",
    ],
  ]
 ❯ src/slack/templates/daily-brief.spec.ts:387:42
    385|       );
    386|
    387|       expect(tableRows(blocks).slice(1)).toEqual([
       |                                          ^
    388|         ['당근', '0', '0', '0', '–', '09-23', '–'],
    389|         ['쌀', '5', '5', '0', '–', '–', '–'],
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯
 FAIL  |unit| src/slack/templates/daily-brief.spec.ts > 브리프 렌더링 > 재고현황 표 > 재고도 식단도 임계개수도 없는 재료만 재고 0 줄로 간다
AssertionError: expected [ '재료', '계란', '당근' ] to deeply equal [ '재료', '당근', '계란' ]
- Expected
+ Received
  [
    "재료",
-   "당근",
    "계란",
+   "당근",
  ]
 ❯ src/slack/templates/daily-brief.spec.ts:407:55
    405|       );
    406|
    407|       expect(tableRows(blocks).map(([name]) => name)).toEqual(['재료', '…
       |                                                       ^
    408|       expect(contextText(blocks)).toBe('재고 0: 오이');
    409|     });
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯
 FAIL  |unit| src/slack/templates/daily-brief.spec.ts > 브리프 v5 페이로드 > 2026-09-26 운영 브리프와 같은 모양의 입력이 고정된 페이로드를 낸다
Error: Snapshot `브리프 v5 페이로드 > 2026-09-26 운영 브리프와 같은 모양의 입력이 고정된 페이로드를 낸다 1` mismatched
- Expected
+ Received
@@ -89,181 +89,181 @@
            }
          ],
          [
            {
              "type": "raw_text",
-             "text": "당근"
+             "text": "⏰ 소고기"
…(스냅숏 diff 이하 생략)
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  4 failed | 25 passed (29)
```

실패한 테스트는 다음 넷이다.

- 재고 표는 부족 시작일이 이른 순이다: 소진일만 있고 부족 시작일이 없는 "소진만"이 맨 위로 올라왔다.
- 재고가 0이어도 식단에 있는 재료는 표에 남는다: 소진일이 없는 당근이 쌀 뒤로 밀렸다.
- 재고도 식단도 임계개수도 없는 재료만 재고 0 줄로 간다: 당근과 계란의 순서가 바뀌었다.
- 2026-09-26 운영 브리프와 같은 모양의 입력이 고정된 페이로드를 낸다: 스냅숏의 재고 표 행 순서가 달라졌다.

되돌린 뒤 `git diff --quiet HEAD -- src test prisma; echo $?`는 `0`이었다. 같은 파일은 `Tests  29 passed (29)`였다.

## 잡지 못하는 것

### 템플릿 spec은 애플리케이션의 판정 고장을 잡지 않는다

1번 고장(`STOCK_ALERT_HORIZON_DAYS = 0`)을 다시 넣은 채로 템플릿 spec 세 개를 함께 돌렸다.

```
pnpm vitest run --project unit src/slack/templates/stock-alert.spec.ts src/slack/templates/daily-brief.spec.ts src/slack/templates/household-board.spec.ts

 Test Files  3 passed (3)
      Tests  53 passed (53)
```

세 파일은 입력을 직접 만들어 넣는다. `stock-alert.spec.ts`는 `BriefStockAlertItem` 픽스처로 `stockAlertTemplate.render({ date, alert: { horizonDays: 7, items } })`를 부르고, `daily-brief.spec.ts`와 `household-board.spec.ts`는 `DailyBrief` 픽스처를 넣는다. 그래서 `buildDailyBrief`가 알람 항목을 무엇으로 판정하든 결과가 달라지지 않는다. 판정의 회귀는 `src/application/daily-brief.spec.ts`만 잡는다. 확인한 뒤 고장을 되돌렸고 `git diff --quiet HEAD -- src test prisma; echo $?`는 `0`이었다.

### 휴대폰에서 보이는 모양

휴대폰 Slack 앱에서 재고 알람 메시지가 어떻게 보이는지는 어떤 테스트도 보지 않는다. 템플릿 spec은 Slack에 보낼 블록 페이로드를 본다. 실제 화면 확인은 `docs/user-intervention.md` 11번("재고 알람 마이그레이션과 휴대폰 확인")에 사람이 할 일로 남아 있다.
