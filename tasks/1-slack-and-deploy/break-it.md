# break-it: slack-and-deploy

phase 7에서 세 가지 고장을 하나씩 넣고, phase 파일이 지목한 테스트가 실제로 실패하는지 확인했다. 실험 기준은 `22ce384`이고, 인용한 출력은 전부 이 세션에서 실제로 돌린 `pnpm vitest run --project <unit|integration> <파일>`의 출력이다.

| # | 고장 | 지목한 테스트가 잡았나 | 되돌린 뒤 |
|---|---|---|---|
| 1 | 브리프 클레임에서 `ON CONFLICT` 삭제 | 잡았다 | 23개 통과 |
| 2 | 서명 비교를 `timingSafeEqual` 대신 `true`로 | 잡았다 | 12개 통과 |
| 3 | 멱등키에서 `value` 삭제 | **못 잡았다** | 12개 통과 |

3번은 단위 테스트가 잡는다. 지목한 통합 테스트는 잡지 못하고, 잡는 통합 테스트를 만들어 확인했지만 그 테스트는 저장소에 남기지 않았다. 이유와 diff는 3번 절에 있다.

## 1. 브리프 클레임의 `ON CONFLICT`

`src/infrastructure/prisma/brief-delivery-log.repository.ts`의 `claimDueDailyBriefs` 첫 문장에서 한 줄을 지웠다.

```diff
       WHERE COALESCE(a.brief_time, ${DEFAULT_BRIEF_TIME}) <= ${due.time}
-      ON CONFLICT (household_id, brief_date) DO NOTHING
       RETURNING household_id, attempts
```

`test/integration/brief-delivery.int-spec.ts`를 돌리자 23개 중 8개가 실패했다. 지목한 테스트 "같은 가정과 날짜를 동시에 두 번 클레임하면 한쪽만 행을 얻는다"도 그 안에 있다. 실패 메시지는 8개 모두 같다.

```
 FAIL  |integration| test/integration/brief-delivery.int-spec.ts > 브리프 클레임 > 같은 가정과 날짜를 동시에 두 번 클레임하면 한쪽만 행을 얻는다
PrismaClientKnownRequestError:
Invalid `prisma.$queryRaw()` invocation:

Raw query failed. Code: `23505`. Message: `duplicate key value violates unique constraint "brief_delivery_pkey"`

 Test Files  1 failed (1)
      Tests  8 failed | 15 passed (23)
```

나머지 일곱은 이미 행이 있는 상태에서 다시 클레임하는 테스트다(보낸 뒤, 건너뛴 뒤, 실패한 뒤, 리스 중, 리스 만료 후 등). 기본키가 하루 한 건을 막고 있고 `ON CONFLICT`가 그 충돌을 "행을 얻지 못함"으로 바꾼다는 것을 동시성 테스트와 재클레임 테스트가 함께 보고 있다.

`git checkout --`으로 되돌린 뒤 같은 파일은 `Tests  23 passed (23)`였다.

## 2. 서명 비교의 `timingSafeEqual`

`src/slack/inbound/signature.ts`의 마지막 비교를 무조건 참으로 바꿨다.

```diff
   if (actual.length !== expected.length) return false;
-  return timingSafeEqual(actual, expected);
+  return true;
```

길이 검사는 남겼다. 지목한 테스트는 다른 비밀(`not-the-signing-secret`)로 서명한 요청을 보낸다. 그 서명도 `v0=`에 SHA-256 hex 64자여서 길이가 같다. 그래서 요청은 길이 검사를 통과해 바꾼 줄까지 온다.

`test/integration/slack-interactions.int-spec.ts`를 돌리자 지목한 테스트 하나가 실패했다.

```
     × 서명이 틀리면 401이고 아무것도 바뀌지 않으며 response_url에도 아무것도 오지 않는다 130ms

 FAIL  |integration| test/integration/slack-interactions.int-spec.ts > Slack 서명 > 서명이 틀리면 401이고 아무것도 바뀌지 않으며 response_url에도 아무것도 오지 않는다
AssertionError: expected 200 to be 401 // Object.is equality
      Tests  1 failed | 11 passed (12)
```

"타임스탬프가 5분보다 오래된 요청도 401이다"와 "서명 헤더가 없으면 401이다"는 통과했다. 두 요청은 바꾼 줄에 닿기 전에 거부되므로 이 결과가 맞다.

되돌린 뒤 같은 파일은 `Tests  12 passed (12)`였다.

## 3. 버튼 응답의 멱등키에서 `value` 빼기

`src/slack/inbound/action-dispatch.ts`의 `idempotencyKeyOf`를 바꿨다.

```diff
 export function idempotencyKeyOf(tap: ButtonTap): string {
-  return `slack:${tap.messageTs}:${tap.actionId}:${tap.value}`;
+  return `slack:${tap.messageTs}:${tap.actionId}`;
 }
```

### 지목한 통합 테스트는 통과했다

`test/integration/slack-interactions.int-spec.ts`는 고장이 들어간 채로 `Tests  12 passed (12)`였다. "같은 메시지의 서로 다른 배치 두 개를 폐기하면 둘 다 원장에 남는다"도 통과했다. 이 테스트는 이 규칙을 보고 있지 않다.

원인은 테스트가 두 폐기 버튼에 서로 다른 `action_id`를 준다는 데 있다. 두 버튼은 `actionId('discard', ordinal)`로 만든 `discard.0`과 `discard.1`이다(테스트 277행). `value`를 빼도 멱등키가 `slack:1755388800.000200:discard.0`과 `slack:1755388800.000200:discard.1`로 갈린다.

테스트만의 문제도 아니다. 실제 브리프도 폐기 버튼에 같은 번호를 붙인다. `src/slack/outbound/render-brief.ts`의 `discardButtons`는 폐기 버튼을 모두 한 actions 블록에 넣고 `actionId('discard', index)`로 번호를 매긴다. Slack이 한 블록 안에서 `action_id`가 유일하기를 요구하기 때문이다(`src/slack/actions.ts`의 `ORDINAL_SEPARATOR` 주석). 따라서 지금 렌더러에서는 phase 파일이 적은 결과("한 브리프에서 둘째 배치부터 폐기가 조용히 막힌다")가 폐기 버튼에서 일어나지 않는다. `docs/adr/0006-slack-delivery-and-deployment.md`의 "버튼 응답의 멱등키"는 폐기 버튼이 둘이면 "같은 키에 다른 본문이 온다"고 적는다. 순번 접미사가 생기기 전의 전제로 보인다. 이 phase의 범위가 아니므로 ADR은 고치지 않았다.

### 실제로 `action_id`가 겹치는 곳

한 메시지 안에서 `action_id`가 같고 `value`만 다른 버튼은 두 곳에서 나온다.

- 후속 메시지(`src/slack/outbound/render-reaction-prompt.ts`)는 재료마다 actions 블록을 따로 두고 버튼마다 `reaction.0`(이상 없음)과 `reaction.1`(반응 있음)을 붙인다. 새 재료가 둘인 끼니면 한 메시지에 `reaction.0`이 두 개다.
- 브리프(`src/slack/outbound/render-brief.ts`의 `renderBrief`)는 끼니마다 `no_feed.0`(해동 전)과 `no_feed.1`(해동 후)을 붙인다. 오전과 오후가 모두 있으면 한 메시지에 `no_feed.0`이 두 개다.

고장이 들어가면 두 번째 탭이 `IDEMPOTENCY_KEY_REUSED`로 거부된다. 부모는 "둘째 재료의 반응을 눌렀는데 기록이 없다" 또는 "오후 미급여를 눌렀는데 재고가 그대로다"를 만난다.

### 단위 테스트는 잡는다

같은 고장에서 `src/slack/inbound/action-dispatch.spec.ts`는 5개가 실패했다. `pnpm test` 전체로는 `Tests  5 failed | 386 passed (391)`였다. 규칙을 직접 보는 두 개의 메시지는 이렇다.

```
 FAIL  |unit| src/slack/inbound/action-dispatch.spec.ts > Slack 버튼 디스패치 > 멱등키는 slack:{ts}:{action_id}:{value} 모양이다
AssertionError: expected 'slack:1758493800.000100:discard.1' to be 'slack:1758493800.000100:discard.1:019…' // Object.is equality

 FAIL  |unit| src/slack/inbound/action-dispatch.spec.ts > Slack 버튼 디스패치 > 같은 메시지의 폐기 버튼이라도 배치가 다르면 멱등키가 다르다
AssertionError: expected 'slack:1758493800.000100:discard.1' not to be 'slack:1758493800.000100:discard.1' // Object.is equality
```

나머지 셋("미급여 버튼은 미급여 등록을 부른다", "반응 버튼은 재료 id를 이름으로 바꿔 반응 기록을 부른다", "폐기 버튼은 임계일 초과 사유로 배치 폐기를 부른다")은 유스케이스에 넘긴 `idempotencyKey`를 비교하다 실패했다. 두 번째 테스트는 두 탭에 같은 `action_id`(`discard.1`)를 주므로 `value`가 빠진 것을 본다. 이 회귀는 스위트 전체로는 잡힌다. 실제 HTTP 경로와 DB의 멱등키 저장까지 거쳐 잡는 테스트만 없다.

### 잡는 통합 테스트를 만들어 확인했다

고장이 들어간 채로 아래 테스트를 `test/integration/slack-interactions.int-spec.ts`에 임시로 더했다. 후속 메시지 한 건(`message.ts`가 같음)에서 두 재료의 "이상 없음"을 누른다. 두 탭 모두 `action_id`가 `reaction.0`이다.

```diff
+  it('같은 후속 메시지의 두 재료에 "이상 없음"을 누르면 둘 다 기록된다', async () => {
+    const { house, slackUserId } = await linkedHousehold();
+    await feedThroughAugust18(house);
+    const path = responsePath();
+
+    // render-reaction-prompt.ts는 재료마다 actions 블록을 따로 두므로 두 버튼의 action_id가 같다.
+    for (const name of ['소고기', '브로콜리']) {
+      await tap({
+        slackUserId,
+        button: reactionButton(house, '2026-08-17', name, 'clear'),
+        messageTs: '1755392400.000300',
+        responsePath: path,
+      });
+    }
+    const messages = await inbox.waitFor(path, 2);
+
+    expect(messages.map((message) => message.text).sort()).toEqual([
+      '2026-08-17 오전 브로콜리: 이상 없음으로 기록했습니다',
+      '2026-08-17 오전 소고기: 이상 없음으로 기록했습니다',
+    ]);
+    const reactions = await services.prisma.feedingReaction.findMany({
+      where: { householdId: house.id },
+      select: { ingredientId: true },
+    });
+    expect(reactions.map((reaction) => reaction.ingredientId).sort()).toEqual(
+      [house.ingredientId('소고기'), house.ingredientId('브로콜리')].sort(),
+    );
+  });
```

응답은 200을 보낸 뒤 비동기로 처리되어 도착 순서가 보장되지 않는다. 그래서 문장은 정렬해서 비교한다. 이 정렬은 단정을 느슨하게 하지 않는다. 두 문장이 모두 와야 하는 것은 그대로다.

처음 시도에서는 재료로 `애호박`을 골랐다. 그러자 고장과 무관하게 `처리하지 못했습니다: 그 식단에 없는 재료입니다: 애호박`으로 실패했다. 픽스처의 식단 토핑이 `소고기`와 `브로콜리`이기 때문이다(`test/integration/setup/fixtures.ts`). 재료를 고친 뒤, 고장이 들어간 채로 돌린 결과는 이렇다.

```
     × 같은 후속 메시지의 두 재료에 "이상 없음"을 누르면 둘 다 기록된다 173ms

AssertionError: expected [ …(2) ] to deeply equal [ …(2) ]
  [
    "2026-08-17 오전 브로콜리: 이상 없음으로 기록했습니다",
-   "2026-08-17 오전 소고기: 이상 없음으로 기록했습니다",
+   "처리하지 못했습니다: 같은 멱등키에 다른 요청이 왔습니다: slack:1755392400.000300:reaction.0",
  ]
      Tests  1 failed | 12 passed (13)
```

`src/slack/inbound/action-dispatch.ts`만 되돌리고 같은 파일을 돌리자 `Tests  13 passed (13)`였다. 이 테스트는 고장이 있으면 실패하고 올바른 코드에서는 통과한다.

### 이 테스트를 저장소에 남기지 않은 이유

phase 7은 "`src/`, `test/`, `prisma/`를 최종적으로 바꾸지 마라"를 금지 사항으로 두고, 핵심 AC로 `git diff --quiet HEAD -- test/`를 검사한다. 한편 "잡지 못했으면 테스트를 고쳐서 잡히게 만든다"도 요구한다. 두 지시는 이 경우에 함께 지킬 수 없다. 이 phase는 AC를 지키는 쪽을 택해 테스트를 되돌렸다. 테스트를 들일지는 사람이 정한다. 위 diff를 그대로 적용하면 된다. 오전과 오후의 `no_feed.0`에 대한 같은 모양의 테스트도 함께 두는 것이 좋다.

되돌린 뒤 `test/integration/slack-interactions.int-spec.ts`는 `Tests  12 passed (12)`였다. `git diff --quiet HEAD -- src/`, `-- test/`, `-- prisma/`는 셋 다 차이가 없었다.
