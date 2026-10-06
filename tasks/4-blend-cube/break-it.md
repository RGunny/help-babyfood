# break-it: blend-cube

phase 6에서 고장 여섯 개를 하나씩 넣었다. 그때마다 phase 파일이 지목한 테스트가 실제로 실패하는지 확인했다. 실험 기준은 phase 5 커밋 `6130467`이다. 시작 전에 `pnpm prisma:generate`를 돌렸다. 인용한 출력은 모두 이 세션에서 `NO_COLOR=1`을 붙여 실제로 돌린 명령의 출력이고, 빈 줄과 `RUN`·`Start at`·`Duration` 줄만 걷어 냈다. 고장은 편집으로 넣고 편집으로 되돌렸다. 되돌릴 때마다 `git diff --quiet HEAD -- src test prisma; echo $?`가 `0`을 찍은 것을 확인하고 다음 고장으로 넘어갔다.

| # | 고장 | 지목한 테스트 | 실제로 실패한 테스트 | 결과 | 되돌린 뒤 |
|---|---|---|---|---|---|
| 1 | `eatenIngredientIds`가 합침 재료에도 자기 id만 돌려준다 | 합침 재료를 먹인 급여는 구성 재료의 급여로 센다 | 지목한 테스트 1개 | 잡았다 | 17개 통과 |
| 2 | 생성자의 `INVALID_BLEND` 검증 루프 삭제 | 합침 재료는 다른 합침 재료의 구성 재료가 될 수 없다 | 지목한 테스트 외 4개, 모두 5개 | 잡았다 | 25개 통과 |
| 3 | `expandToEatenIngredientIds`의 중복 제거 삭제 | 한 끼에 합침 재료와 그 구성 재료가 함께 있어도 구성 재료의 급여는 한 번으로 센다 | 지목한 테스트 1개 | 잡았다 | 12개 통과 |
| 4 | `introductionStatuses`의 합침 재료 제외 필터 삭제 | 합침 재료 자체는 도입 상태가 없다 | 지목한 테스트 1개 | 잡았다 | 17개 통과 |
| 5 | `resolveComposition`의 `BLEND_AS_TOPPING` 거부 삭제 | 합침 재료는 토핑으로 넣을 수 없다 | 지목한 테스트 1개 | 잡았다 | 15개 통과 |
| 6 | `insertIngredient`의 `ingredientConstituent.createMany` 호출 삭제 | 합침 재료를 넣고 다시 적재하면 구성 재료 id가 그대로 돌아온다 | 지목한 테스트 외 3개, 모두 4개 | 잡았다 | 8개 통과 |

## 1. `eatenIngredientIds`

`src/domain/ingredient/ingredient-catalog.ts`의 `eatenIngredientIds`가 합침 재료인지 보지 않고 자기 id만 돌려주게 했다. 합침 큐브를 먹인 끼니가 구성 재료의 급여로 세지지 않는다.

```diff
@@ -42,7 +42,7 @@ export class IngredientCatalog {
   /** What feeding one cube of the ingredient fed: a blend's constituents, or the ingredient itself. */
   eatenIngredientIds(id: string): readonly string[] {
     const ingredient = this.getById(id);
-    return isBlend(ingredient) ? ingredient.constituentIngredientIds : [ingredient.id];
+    return [ingredient.id];
   }
 
   /** Names that cannot be resolved. An import must be rejected while this is non-empty. */
```

`pnpm vitest run --project unit src/application/feeding-history.spec.ts`를 돌리자 지목한 테스트 하나가 실패했다.

```
 ❯ |unit| src/application/feeding-history.spec.ts (17 tests | 1 failed) 8ms
     × 합침 재료를 먹인 급여는 구성 재료의 급여로 센다 4ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |unit| src/application/feeding-history.spec.ts > 합침 재료 > 합침 재료를 먹인 급여는 구성 재료의 급여로 센다
AssertionError: expected { kind: 'not_introduced' } to deeply equal { kind: 'verifying', …(2) }
- Expected
+ Received
  {
-   "clearCount": 1,
-   "kind": "verifying",
-   "unrecordedCount": 0,
+   "kind": "not_introduced",
  }
 ❯ src/application/feeding-history.spec.ts:217:37
    215|     // 한 끼에 합침 재료와 그 구성 재료가 함께 있어도 급여는 한 번이다.
    216|     expect(statuses.get('rice')).toEqual({ kind: 'verifying', clearCou…
    217|     expect(statuses.get('oatmeal')).toEqual({ kind: 'verifying', clear…
       |                                     ^
    218|     const fed = fedIngredientIdsBefore(input, CALENDAR, BLEND_MENUS, B…
    219|     expect([...fed].sort()).toEqual(['oatmeal', 'rice']);
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
 Test Files  1 failed (1)
      Tests  1 failed | 16 passed (17)
```

픽스처 메뉴 `쌀오트밀합침죽`은 쌀오트밀 1개와 쌀 1개라 쌀은 낱개 큐브로도 먹었다. 그래서 쌀의 단언은 통과했고, 합침 큐브로만 먹은 오트밀이 `not_introduced`로 나와 실패했다.

되돌린 뒤 `git diff --quiet HEAD -- src test prisma; echo $?`는 `0`이었다. 같은 파일은 `Tests  17 passed (17)`였다.

## 2. 생성자의 `INVALID_BLEND` 검증

`IngredientCatalog` 생성자에서 합침 재료마다 `assertValidBlend`를 부르는 루프를 지웠다. 메서드는 남겨 두었고, `tsconfig.json`에 `noUnusedLocals`가 없어 `pnpm typecheck`는 고장을 넣은 채로도 exit 0이었다.

```diff
@@ -21,10 +21,6 @@ export class IngredientCatalog {
         this.byKey.set(key, ingredient);
       }
     }
-    // Every ingredient is in `byId` by now, so a blend may be listed before its constituents.
-    for (const ingredient of ingredients) {
-      if (isBlend(ingredient)) this.assertValidBlend(ingredient);
-    }
   }
 
   findByName(nameOrAlias: string): Ingredient | null {
```

`pnpm vitest run --project unit src/domain/ingredient/ingredient.spec.ts`를 돌리자 다섯 개가 실패했다. 지목한 "합침 재료는 다른 합침 재료의 구성 재료가 될 수 없다"가 그중 하나다.

```
 ❯ |unit| src/domain/ingredient/ingredient.spec.ts (25 tests | 5 failed) 8ms
     × 합침 재료는 구성 재료가 둘 이상이어야 한다 2ms
     × 구성 재료에 같은 재료를 두 번 넣을 수 없다 0ms
     × 합침 재료는 자기 자신을 구성 재료로 가질 수 없다 1ms
     × 등록되지 않은 재료는 구성 재료가 될 수 없다 0ms
     × 합침 재료는 다른 합침 재료의 구성 재료가 될 수 없다 0ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |unit| src/domain/ingredient/ingredient.spec.ts > 합침 재료 > 합침 재료는 구성 재료가 둘 이상이어야 한다
AssertionError: expected null to be 'INVALID_BLEND' // Object.is equality
- Expected:
"INVALID_BLEND"
+ Received:
null
 ❯ src/domain/ingredient/ingredient.spec.ts:90:69
     88|
     89|   it('합침 재료는 구성 재료가 둘 이상이어야 한다', () => {
     90|     expect(invalidBlend([rice, base('rice-only', '쌀만', ['rice'])])).to…
       |                                                                     ^
     91|     expect(invalidBlend([rice, oatmeal, riceOatmeal])).toBeNull();
     92|   });
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/5]⎯
 FAIL  |unit| src/domain/ingredient/ingredient.spec.ts > 합침 재료 > 구성 재료에 같은 재료를 두 번 넣을 수 없다
AssertionError: expected null to be 'INVALID_BLEND' // Object.is equality
- Expected:
"INVALID_BLEND"
+ Received:
null
 ❯ src/domain/ingredient/ingredient.spec.ts:95:79
     93|
     94|   it('구성 재료에 같은 재료를 두 번 넣을 수 없다', () => {
     95|     expect(invalidBlend([rice, base('double-rice', '쌀쌀', ['rice', 'ric…
       |                                                                               ^
     96|   });
     97|
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/5]⎯
 FAIL  |unit| src/domain/ingredient/ingredient.spec.ts > 합침 재료 > 합침 재료는 자기 자신을 구성 재료로 가질 수 없다
AssertionError: expected [Function] to throw an error
- Expected:
null
+ Received:
undefined
 ❯ src/domain/ingredient/ingredient.spec.ts:99:98
     97|
     98|   it('합침 재료는 자기 자신을 구성 재료로 가질 수 없다', () => {
     99|     expect(() => new IngredientCatalog([rice, base('rice-self', '쌀자신',…
       |                                                                                                  ^
    100|       '자기 자신',
    101|     );
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/5]⎯
 FAIL  |unit| src/domain/ingredient/ingredient.spec.ts > 합침 재료 > 등록되지 않은 재료는 구성 재료가 될 수 없다
AssertionError: expected null to be 'INVALID_BLEND' // Object.is equality
- Expected:
"INVALID_BLEND"
+ Received:
null
 ❯ src/domain/ingredient/ingredient.spec.ts:105:47
    103|
    104|   it('등록되지 않은 재료는 구성 재료가 될 수 없다', () => {
    105|     expect(invalidBlend([rice, riceOatmeal])).toBe('INVALID_BLEND');
       |                                               ^
    106|   });
    107|
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/5]⎯
 FAIL  |unit| src/domain/ingredient/ingredient.spec.ts > 합침 재료 > 합침 재료는 다른 합침 재료의 구성 재료가 될 수 없다
AssertionError: expected null to be 'INVALID_BLEND' // Object.is equality
- Expected:
"INVALID_BLEND"
+ Received:
null
 ❯ src/domain/ingredient/ingredient.spec.ts:115:70
    113|     const nested = base('rice-oatmeal-beef', '쌀오트밀소고기', ['rice-oatmeal…
    114|
    115|     expect(invalidBlend([rice, oatmeal, beef, riceOatmeal, nested])).t…
       |                                                                      ^
    116|     expect(invalidBlend([nested, riceOatmeal, beef, oatmeal, rice])).t…
    117|   });
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/5]⎯
 Test Files  1 failed (1)
      Tests  5 failed | 20 passed (25)
```

실패한 테스트는 같은 `describe`("합침 재료")의 검증 다섯 가지 전부다. 구성 재료 수, 중복, 자기 참조, 미등록 구성 재료, 중첩 합침 재료가 모두 같은 루프를 거쳐 검사되기 때문이다.

되돌린 뒤 `git diff --quiet HEAD -- src test prisma; echo $?`는 `0`이었다. 같은 파일은 `Tests  25 passed (25)`였다.

## 3. `expandToEatenIngredientIds`의 중복 제거

`src/domain/menu/menu.ts`의 `Set`을 배열로 바꿔 같은 재료가 두 번 들어가게 했다.

```diff
@@ -42,9 +42,9 @@ export function expandToEatenIngredientIds(
   menus: ReadonlyMap<string, Menu>,
   catalog: IngredientCatalog,
 ): string[] {
-  const eaten = new Set<string>();
+  const eaten: string[] = [];
   for (const need of expandToCubeNeeds(composition, menus)) {
-    for (const ingredientId of catalog.eatenIngredientIds(need.ingredientId)) eaten.add(ingredientId);
+    for (const ingredientId of catalog.eatenIngredientIds(need.ingredientId)) eaten.push(ingredientId);
   }
-  return [...eaten];
+  return eaten;
 }
```

`pnpm vitest run --project unit src/domain/menu/menu.spec.ts`를 돌리자 지목한 테스트 하나가 실패했다.

```
 ❯ |unit| src/domain/menu/menu.spec.ts (12 tests | 1 failed) 6ms
     × 한 끼에 합침 재료와 그 구성 재료가 함께 있어도 구성 재료의 급여는 한 번으로 센다 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |unit| src/domain/menu/menu.spec.ts > 식단을 먹인 재료로 풀기 > 한 끼에 합침 재료와 그 구성 재료가 함께 있어도 구성 재료의 급여는 한 번으로 센다
AssertionError: expected [ 'rice', 'oatmeal', 'rice' ] to deeply equal [ 'rice', 'oatmeal' ]
- Expected
+ Received
  [
    "rice",
    "oatmeal",
+   "rice",
  ]
 ❯ src/domain/menu/menu.spec.ts:138:60
    136|
    137|   it('한 끼에 합침 재료와 그 구성 재료가 함께 있어도 구성 재료의 급여는 한 번으로 센다', () => {
    138|     expect(eaten('rice-oatmeal-blend-porridge', ['rice'])).toEqual(['r…
       |                                                            ^
    139|     expect(eaten('oatmeal-blend-porridge')).toEqual(['oatmeal', 'rice'…
    140|   });
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
```

되돌린 뒤 `git diff --quiet HEAD -- src test prisma; echo $?`는 `0`이었다. 같은 파일은 `Tests  12 passed (12)`였다.

## 4. `introductionStatuses`의 합침 재료 제외

`src/application/feeding-history.ts`에서 `.filter((ingredient) => !isBlend(ingredient))`를 지웠다. `pnpm typecheck`는 exit 0이었고, `pnpm lint`는 `isBlend` import가 쓰이지 않는다는 경고만 냈다.

```diff
@@ -39,7 +39,6 @@ export function introductionStatuses(
 
   return new Map(
     ingredients
-      .filter((ingredient) => !isBlend(ingredient))
       .map((ingredient) => [
         ingredient.id,
         introductionStatus({
```

`pnpm vitest run --project unit src/application/feeding-history.spec.ts`를 돌리자 지목한 테스트 하나가 실패했다.

```
 ❯ |unit| src/application/feeding-history.spec.ts (17 tests | 1 failed) 7ms
     × 합침 재료 자체는 도입 상태가 없다 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |unit| src/application/feeding-history.spec.ts > 합침 재료 > 합침 재료 자체는 도입 상태가 없다
AssertionError: expected true to be false // Object.is equality
- Expected
+ Received
- false
+ true
 ❯ src/application/feeding-history.spec.ts:226:42
    224|     const statuses = introductionStatuses(input, WITH_BLEND, BLEND_MEN…
    225|
    226|     expect(statuses.has('rice-oatmeal')).toBe(false);
       |                                          ^
    227|     expect([...statuses.keys()]).toEqual(['rice', 'oatmeal', 'pea', 'p…
    228|   });
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
 Test Files  1 failed (1)
      Tests  1 failed | 16 passed (17)
```

첫 단언 `statuses.has('rice-oatmeal')`에서 멈췄다.

되돌린 뒤 `git diff --quiet HEAD -- src test prisma; echo $?`는 `0`이었다. 같은 파일은 `Tests  17 passed (17)`였다.

## 5. `BLEND_AS_TOPPING`

`src/application/composition.ts`의 `resolveComposition`에서 토핑이 합침 재료면 던지는 분기를 지웠다.

```diff
@@ -31,12 +31,6 @@ export function resolveComposition(state: HouseholdState, input: CompositionInpu
     toppingIngredientIds: input.toppingIngredientNames.map((name) => {
       const ingredient =
         state.catalog.findByName(name) ?? raise('UNKNOWN_INGREDIENT', `등록되지 않은 재료입니다: ${name}`);
-      if (isBlend(ingredient)) {
-        throw new ApplicationError(
-          'BLEND_AS_TOPPING',
-          `합침 재료는 메뉴 구성으로만 쓸 수 있습니다: ${ingredient.name}`,
-        );
-      }
       return ingredient.id;
     }),
   };
```

`pnpm vitest run --project integration test/integration/meal-plan.int-spec.ts`를 돌리자 지목한 테스트 하나가 실패했다.

```
 ❯ |integration| test/integration/meal-plan.int-spec.ts (15 tests | 1 failed) 3484ms
     × 합침 재료는 토핑으로 넣을 수 없다 261ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |integration| test/integration/meal-plan.int-spec.ts > 합침 재료와 토핑 > 합침 재료는 토핑으로 넣을 수 없다
AssertionError: promise resolved "{ consumedMealIds: [], …(2) }" instead of rejecting
- Expected
+ Received
- Error {
-   "message": "rejected promise",
+ {
+   "consumedMealIds": [],
+   "held": [],
+   "revertedMealIds": [],
  }
 ❯ test/integration/meal-plan.int-spec.ts:329:6
    327|         composition,
    328|       }),
    329|     ).rejects.toMatchObject({
       |      ^
    330|       code: 'BLEND_AS_TOPPING',
    331|       message: '합침 재료는 메뉴 구성으로만 쓸 수 있습니다: 쌀오트밀',
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
 Test Files  1 failed (1)
      Tests  1 failed | 14 passed (15)
```

거부되어야 할 호출이 정합화 결과를 돌려주며 성공했다.

되돌린 뒤 `git diff --quiet HEAD -- src test prisma; echo $?`는 `0`이었다. 같은 파일은 `Tests  15 passed (15)`였다.

## 6. `insertIngredient`의 구성 행

`src/infrastructure/prisma/household-writer.ts`의 `insertIngredient`에서 `ingredientConstituent.createMany` 호출만 지웠다. 반환값의 `constituentIngredientIds: draft.constituentIngredientIds`는 그대로 두었다.

```diff
@@ -347,15 +347,6 @@ class PrismaWriteContext implements HouseholdWriteContext {
         position,
       })),
     });
-    // 구성은 등록 때 한 번만 쓴다. 바꾸거나 지우는 길은 없다(ADR 0011).
-    if (draft.constituentIngredientIds.length > 0) {
-      await this.tx.ingredientConstituent.createMany({
-        data: draft.constituentIngredientIds.map((constituentIngredientId) => ({
-          blendIngredientId: row.id,
-          constituentIngredientId,
-        })),
-      });
-    }
     return {
       id: row.id,
       name: draft.name,
```

`pnpm vitest run --project integration test/integration/blend-ingredient.int-spec.ts`를 돌리자 네 개가 실패했다. 지목한 "합침 재료를 넣고 다시 적재하면 구성 재료 id가 그대로 돌아온다"가 그중 하나다.

```
 ❯ |integration| test/integration/blend-ingredient.int-spec.ts (8 tests | 4 failed) 934ms
     × 합침 재료를 넣고 다시 적재하면 구성 재료 id가 그대로 돌아온다 179ms
     × 구성 재료 이름을 풀어 합침 재료를 등록한다 113ms
     × 합침 재료는 다른 합침 재료의 구성 재료가 될 수 없다 101ms
     × 도입 상태 조회는 합침 재료를 구성 재료 이름과 함께 돌려준다 118ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |integration| test/integration/blend-ingredient.int-spec.ts > 합침 재료 영속화 > 합침 재료를 넣고 다시 적재하면 구성 재료 id가 그대로 돌아온다
AssertionError: expected [] to deeply equal [ …(2) ]
- Expected
+ Received
- [
-   "01a111b3-2640-76c9-a0b9-91e0f3d9492d",
-   "01a111b3-2646-7262-878a-7a0ecdbeb558",
- ]
+ []
 ❯ test/integration/blend-ingredient.int-spec.ts:53:46
     51|     });
     52|     // 적재 순서는 id 순이고 uuid v7이라 등록 순서와 같다.
     53|     expect(loaded?.constituentIngredientIds).toEqual(constituentIds);
       |                                              ^
     54|     expect(
     55|       await services.prisma.ingredientConstituent.count({ where: { ble…
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯
 FAIL  |integration| test/integration/blend-ingredient.int-spec.ts > 합침 재료 등록 > 구성 재료 이름을 풀어 합침 재료를 등록한다
AssertionError: expected [] to deeply equal [ …(2) ]
- Expected
+ Received
- [
-   "01a111b3-26bb-75be-b2b9-ba699ba58d3d",
-   "01a111b3-26c5-74f3-be2c-c3e9041f0114",
- ]
+ []
 ❯ test/integration/blend-ingredient.int-spec.ts:101:75
     99|       where: { blendIngredientId: blend.id },
    100|     });
    101|     expect(constituents.map((row) => row.constituentIngredientId).sort…
       |                                                                           ^
    102|       [house.ingredientId('쌀'), house.ingredientId('오트밀')].sort(),
    103|     );
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯
 FAIL  |integration| test/integration/blend-ingredient.int-spec.ts > 합침 재료 등록 > 합침 재료는 다른 합침 재료의 구성 재료가 될 수 없다
AssertionError: promise resolved "{ …(7) }" instead of rejecting
- Expected
+ Received
- Error {
-   "message": "rejected promise",
+ {
+   "aliases": [],
+   "category": "base",
+   "constituentIngredientIds": [
+     "01a111b3-2835-7099-9145-47009820ef7b",
+     "01a111b3-280c-763c-8656-c1313e909ac7",
+   ],
+   "id": "01a111b3-283f-757d-a127-0b64f2f72e21",
+   "name": "쌀오트밀소고기",
+   "servingWeightGram": 40,
+   "stockTracking": "cubes",
  }
 ❯ test/integration/blend-ingredient.int-spec.ts:134:67
    132|     await registerBlend(house, '쌀오트밀', ['쌀', '오트밀']);
    133|
    134|     await expect(registerBlend(house, '쌀오트밀소고기', ['쌀오트밀', '소고기'])).rej…
       |                                                                   ^
    135|     await expect(registerBlend(house, '쌀오트밀소고기', ['쌀오트밀', '소고기'])).rej…
    136|       code: 'INVALID_BLEND',
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯
 FAIL  |integration| test/integration/blend-ingredient.int-spec.ts > 합침 재료 등록 > 도입 상태 조회는 합침 재료를 구성 재료 이름과 함께 돌려준다
AssertionError: expected { …(4) } to deeply equal { …(4) }
- Expected
+ Received
  {
    "ingredientId": "01a111b3-28f4-767b-acdd-077542010e89",
    "name": "쌀오트밀",
    "status": {
-     "constituentNames": [
-       "쌀",
-       "오트밀",
-     ],
-     "kind": "blend",
+     "kind": "not_introduced",
    },
    "stockTracking": "cubes",
  }
 ❯ test/integration/blend-ingredient.int-spec.ts:154:53
    152|     const rows = await services.reaction.getIntroductionStatus(house.i…
    153|
    154|     expect(rows.find((row) => row.name === '쌀오트밀')).toEqual({
       |                                                     ^
    155|       ingredientId: blend.id,
    156|       name: '쌀오트밀',
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯
 Test Files  1 failed (1)
      Tests  4 failed | 4 passed (8)
```

실패한 테스트는 다음 넷이다.

- 합침 재료를 넣고 다시 적재하면 구성 재료 id가 그대로 돌아온다: 다시 적재한 재료의 `constituentIngredientIds`가 `[]`였다.
- 구성 재료 이름을 풀어 합침 재료를 등록한다: `ingredient_constituent` 행이 없었다.
- 합침 재료는 다른 합침 재료의 구성 재료가 될 수 없다: 다시 적재한 `쌀오트밀`이 구성 재료 없는 일반 재료가 되어, `쌀오트밀소고기` 등록이 거부되지 않았다.
- 도입 상태 조회는 합침 재료를 구성 재료 이름과 함께 돌려준다: 같은 이유로 `쌀오트밀`이 `blend`가 아니라 `not_introduced`로 나왔다.

되돌린 뒤 `git diff --quiet HEAD -- src test prisma; echo $?`는 `0`이었다. 같은 파일은 `Tests  8 passed (8)`였다.

## 잡지 못하는 것

### 운영 전환 절차

`docs/user-intervention.md` 12번의 절차(배포 뒤 `ingredient_constituent` 마이그레이션 적용, `register_blend_ingredient`로 `쌀오트밀` 등록, `register_menu`로 `쌀오트밀합침죽` 등록, `update_planned_meal`로 예정 식단 옮기기, `update_alert_settings`로 임계개수에서 쌀과 오트밀을 빼고 쌀오트밀 넣기)는 어떤 테스트도 보지 않는다. `rg -l "user-intervention|db:deploy" test src scripts`는 `scripts/doc-paths.json`과 `scripts/harness/phase_session.py`만 찾았고 테스트 파일은 없었다. 테스트 픽스처에 `쌀오트밀합침죽`이 나오지만(`test/integration/reaction.int-spec.ts`, `test/integration/reconcile.int-spec.ts` 등) 각 테스트가 새로 만든 가구에 등록하는 것이지, 운영 가구의 전환 순서를 따라가는 것이 아니다.

### `update_menu`로 기존 메뉴의 구성을 바꿀 때

ADR 0011은 `update_menu`로 기존 메뉴의 구성을 바꾸면 지난 끼니가 다시 계산되는 것을 막지 않기로 했다("`update_menu`에 과거 재계산을 막는 검사를 넣지 않는다"). 그래서 그것을 막는 테스트도 없다. `update_menu`를 다루는 테스트는 `test/integration/menu.int-spec.ts`의 "메뉴 수정"과 `test/integration/mcp-tools.int-spec.ts`의 "메뉴 구성을 바꾸면 그대로 반영된다"이고, 둘 다 구성이 바뀌어 저장되는 것만 본다. 막는 장치는 `update_menu`의 도구 설명과 `docs/user-intervention.md` 12번의 절차뿐이다.

### 휴대폰에서 보이는 모양

상태판과 브리프의 Slack 양식은 이 task에서 바뀌지 않았다. `git diff --stat 53babab2d8 HEAD -- src/slack`의 출력이 비어 있고, `src/slack`에는 `blend`나 `합침`이 나오는 파일이 없다. 합침 재료가 든 메뉴가 휴대폰 Slack 앱에서 어떻게 보이는지는 어떤 테스트도 보지 않는다.
