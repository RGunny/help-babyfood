# docs-diff: slack-and-deploy

Baseline: `1b58221`

## `docs/adr/0004-mcp-server-and-auth.md`

```diff
diff --git c/docs/adr/0004-mcp-server-and-auth.md w/docs/adr/0004-mcp-server-and-auth.md
index 236e93e..67f6d5b 100644
--- c/docs/adr/0004-mcp-server-and-auth.md
+++ w/docs/adr/0004-mcp-server-and-auth.md
@@ -84,7 +84,7 @@ Claude Code는 정적 `Authorization` 헤더를 받는다.
 
 ## 층별 결합
 
-MCP 계층(`src/mcp`)은 애플리케이션 서비스와 `HouseholdReader` 포트만 본다. Prisma 클라이언트를 직접 잡는 곳은 토큰 검증기 하나이고, 그것은 토큰 조회가 유스케이스가 아니기 때문이다. 도구가 저장소에 닿을 수 있으면 재고 규칙의 두 번째 사본이 자라기 시작한다.
+MCP 계층(`src/mcp`)은 애플리케이션 서비스와 `HouseholdReader` 포트만 본다. 어댑터가 Prisma 클라이언트를 직접 잡는 것은 가정·구성원·채널 식별자를 조회할 때뿐이고, 그것들은 유스케이스가 아니기 때문이다. 3단계에서는 토큰 검증기 하나가 그 자리였고, 5단계에서 가정의 Slack 채널 id를 읽는 발송 어댑터와 Slack 사용자 id로 구성원을 찾는 수신 어댑터가 같은 이유로 더해진다(`docs/adr/0006-slack-delivery-and-deployment.md`의 "층별 결합"). 그 밖의 것, 특히 도구나 어댑터가 재고와 식단의 저장소에 닿는 것은 여전히 막는다. 닿을 수 있으면 재고 규칙의 두 번째 사본이 자라기 시작한다.
 
 애플리케이션 계층은 MCP를 모른다. 이번 단계에서 애플리케이션에 더한 것은 `MealPlanImportService` 하나이고, 그것도 MCP가 아니라 기획안 4.8절의 유스케이스다. 스케줄러(4단계)와 Slack 버튼(5단계)이 같은 서비스를 부르게 되며, 그때 MCP 계층은 바뀌지 않는다.
 
```

## `docs/adr/0005-scheduler-and-daily-brief.md`

```diff
diff --git c/docs/adr/0005-scheduler-and-daily-brief.md w/docs/adr/0005-scheduler-and-daily-brief.md
index 214d945..5e8ef92 100644
--- c/docs/adr/0005-scheduler-and-daily-brief.md
+++ w/docs/adr/0005-scheduler-and-daily-brief.md
@@ -49,7 +49,9 @@
 
 5단계에서 브리프를 보낼 때는 고정된 매분 크론이 가정마다 `alert_settings.brief_time`을 읽어 "시각이 지났고 오늘 것이 아직 없다"로 판정한다. 설정이 바뀔 때 잡을 다시 거는 방식은 택하지 않는다. 인스턴스가 둘이면 `update_alert_settings`가 다른 인스턴스의 레지스트리에 닿지 못해 옛 시각이 남고, 매분 확인은 매번 DB를 읽으므로 항상 현재 설정을 본다.
 
-분 단위 동등 비교가 아니라 "지났는데 없다"로 판정하는 이유는 배포나 긴 GC로 한 분을 놓쳐도 다음 분에 회복하기 위해서다. 그 판정에는 하루 한 건이라는 규칙을 기본키로 강제하는 기록이 필요하고, 클레임은 가정 행 잠금 아래에서 조회 후 삽입으로 한다.
+분 단위 동등 비교가 아니라 "지났는데 없다"로 판정하는 이유는 배포나 긴 GC로 한 분을 놓쳐도 다음 분에 회복하기 위해서다. 그 판정에는 하루 한 건이라는 규칙을 기본키로 강제하는 기록이 필요하고, 클레임은 발송 이력 행을 `INSERT ... ON CONFLICT DO NOTHING RETURNING`으로 넣어 행을 돌려받은 쪽이 그날의 발송자가 되는 방식으로 한다.
+
+5단계에서 조회 후 삽입 대신 이 방식을 택했다. 삽입 하나가 원자적이라 두 문장 사이를 지키는 가정 행 잠금이 필요 없고, 매분 도는 정합화 쓸기가 그 행을 잡고 있을 때 발송이 기다리지 않는다. 근거는 `docs/adr/0006-slack-delivery-and-deployment.md`의 "발송 기록과 클레임"에 있다.
 
 ## 근거
 
```

## `docs/adr/0006-slack-delivery-and-deployment.md`

```diff
diff --git c/docs/adr/0006-slack-delivery-and-deployment.md w/docs/adr/0006-slack-delivery-and-deployment.md
new file mode 100644
index 0000000..924e593
--- /dev/null
+++ w/docs/adr/0006-slack-delivery-and-deployment.md
@@ -0,0 +1,245 @@
+# ADR 0006: Slack 발송은 `fetch`로 하고, 하루 한 건은 클레임 행이 강제한다
+
+- 상태: 채택 (Railway PITR 플랜 조건은 ADR 0003대로 프로비저닝 때 확인)
+- 결정일: 2026-09-23
+
+## 맥락
+
+5단계는 기획안 9장이 "브리프 발송과 재시도, 버튼 응답, Railway 배포와 PITR 설정"으로 묶어 둔 범위다. 4단계까지 브리프는 내용까지만 있다. `buildDailyBrief`가 기획안 5장의 브리프를 조립하고 `get_daily_brief`가 그것을 돌려주지만, 서버가 먼저 말을 거는 경로는 없다.
+
+ADR 0005는 발송이 없으므로 발송 이력 테이블도 두지 않았고, 두 가지를 5단계로 미뤘다. 하나는 브리프 시각 판정과 하루 한 건을 강제하는 기록이고("브리프 시각과 발송 이력" 절), 다른 하나는 SIGTERM 정리다("대가와 남는 위험"). 같은 절이 남긴 문장이 이 단계의 전제다.
+
+> 잠금이 막지 못하는 것은 한 번만 일어나야 하는 외부 효과다. 4단계에는 그것이 없고, 5단계의 Slack 발송이 그것이다.
+
+정할 것은 열이다. Slack Web API를 무엇으로 부를지, 발송을 어떻게 기록하고 클레임할지, 재시도를 어떤 간격으로 할지, 브리프 시각을 어디서 판정할지, 후속 메시지를 언제 보낼지, 버튼 응답의 멱등키를 무엇으로 둘지, 서명을 어떻게 검증할지, 200을 언제 내보낼지, 배포 설정을 어디에 둘지, Slack 코드를 어느 디렉터리에 둘지다.
+
+애플리케이션 계층은 NestJS를 모르고 도메인 코어는 1단계 이후 한 줄도 바뀌지 않았다. Slack 계층도 MCP, 스케줄러와 같은 조건에서 붙는다.
+
+## 결정
+
+### Slack 호출은 SDK 없이 `fetch`로 한다
+
+`@slack/web-api`를 런타임 의존성으로 넣지 않는다. 부르는 것은 `chat.postMessage` 하나이고 하루 두 건(브리프와 후속 메시지)이다. 타입만 `@slack/types`를 devDependency로 받아 Block Kit 페이로드를 타입으로 고정한다.
+
+버튼 응답의 `response_url`은 SDK의 메서드 경로가 아니라 Slack이 요청 본문에 넣어 주는 일회용 URL이고, 그 URL에는 JSON을 그대로 POST한다. 어차피 `fetch`이므로 발송과 통보를 한 방식으로 맞춘다.
+
+**Slack Web API는 실패도 HTTP 200으로 돌려준다.** 오류는 상태 코드가 아니라 본문의 `{"ok": false, "error": "..."}`에 있다.
+
+> Web API responses are JSON objects... The `ok` field is a boolean that indicates whether the request was successful. If `ok` is `false`, an `error` field explains what went wrong.
+
+출처: https://docs.slack.dev/apis/web-api . 어댑터가 `response.ok`(HTTP 상태)만 보고 본문의 `ok`를 보지 않으면 `channel_not_found`도 `invalid_auth`도 전부 성공으로 기록되고, 발송 이력은 "매일 보냈다"고 말하는데 부모는 아무것도 받지 못한다. 이것이 SDK를 쓰지 않을 때 직접 져야 하는 책임이고, phase 3의 통합 테스트가 `ok: false` 본문을 성공으로 세지 않는 경로를 고정한다.
+
+### 발송 기록과 클레임
+
+기획안 6장의 "브리프 발송 이력(발송 일시, 결과, 재시도 횟수)"을 테이블 둘로 둔다.
+
+| 테이블 | 기본키 | 무엇이 하루 한 건인가 |
+|---|---|---|
+| `brief_delivery` | (`household_id`, `date`) | 가정마다 하루 한 건의 브리프 |
+| `reaction_prompt_delivery` | (`household_id`, `date`, `slot`) | 가정의 끼니마다 하루 한 건의 후속 메시지 |
+
+기본키가 규칙을 강제한다. 애플리케이션이 "오늘 것이 있나"를 먼저 묻고 없으면 넣는 것이 아니라, 넣어 보고 성공한 쪽이 그날의 발송자가 된다.
+
+클레임은 `INSERT ... ON CONFLICT DO NOTHING RETURNING`이다. 삽입 자체가 원자적이라 인스턴스가 둘이어도 한쪽만 행을 돌려받고, 다른 쪽은 빈 결과를 받아 그냥 넘어간다. 잠금이 필요 없다.
+
+ADR 0005는 이 클레임을 "가정 행 잠금 아래에서 조회 후 삽입"으로 적어 두었고, 그것을 이 방식으로 바꾼다. 목적은 같다. "하루 한 건을 기본키로 강제한다"를 더 적은 것으로 이룬다. 조회 후 삽입은 두 문장 사이가 벌어지지 않도록 가정 행 잠금이 필요하고, 그 잠금은 매분 도는 정합화 쓸기가 이미 잡고 있을 수 있어 발송이 쓸기를 기다리게 된다. 삽입 하나로 줄이면 기다릴 잠금이 없다.
+
+후속 메시지의 기록 키를 식단 id가 아니라 (날짜, 끼니)로 둔다. 이유가 둘이다. `ReactionService.record`가 받는 것이 `(date, slot, ingredientName)`이고 식단 id가 아니다. 그리고 `no_feed_record`의 기본키가 이미 (`household_id`, `date`, `slot`)다. 기획안 4.3절대로 미급여로 식단이 밀리면 같은 식단을 실제로 먹인 날에 다시 물어야 하므로, "그 식단에 한 번"이 아니라 "그날 그 끼니에 한 번"이 맞다.
+
+### 재시도 정책
+
+| 실패한 시도 | 다음 시도까지 |
+|---|---|
+| 1회 | 1분 |
+| 2회 | 5분 |
+| 3회 | 15분 |
+| 4회 | 60분 |
+| 5회 | 없음. 그날은 포기한다 |
+
+총 창은 약 81분이다. 판정은 `next_attempt_at` 컬럼으로 하고, 클레임 질의가 `next_attempt_at <= :now`인 행만 다시 잡는다.
+
+간격을 두는 이유는 매분 tick 때문이다. 실패한 행을 다음 tick이 곧바로 다시 잡으면 5회가 5분 만에 소진되고, 5분짜리 Slack 장애에 그날 브리프를 통째로 잃는다. 81분이면 그 길이의 장애를 넘긴다.
+
+여기에 따라오는 것이 셋이다.
+
+마지막 시도(5회째)가 실패해도 `next_attempt_at`에는 값이 들어간다. `CHECK (status <> 'failed' OR next_attempt_at IS NOT NULL)`을 만족시키기 위해서다. 다시 잡히지 않는 것을 막는 것은 그 컬럼이 아니라 클레임 질의의 `attempts < 5` 조건이다. 두 곳을 헷갈리면 "포기했는데 왜 시각이 들어 있나"를 컬럼에서 고치려 들게 된다. CHECK는 ADR 0002의 "대가"가 적은 관례대로 마이그레이션 SQL에 손으로 덧붙인다.
+
+발송 중 프로세스가 죽어 `pending`으로 남은 행은 `claimed_at`이 5분보다 오래됐을 때 다시 잡는다. 이것은 at-least-once다. `chat.postMessage`가 성공한 직후, 결과를 쓰기 전에 죽으면 같은 브리프가 두 번 간다. 부모가 같은 브리프를 두 번 보는 것과 아예 못 보는 것 중 후자가 더 나쁘다고 판단했다.
+
+`skipped`는 종결 상태다. Slack 채널이 연결되지 않은 가정은 그날 `skipped`로 끝난다. 낮에 `pnpm slack-link`로 연결해도 그날 브리프는 오지 않고 다음 날 아침부터 받는다. 재시도 대상으로 두면 채널을 영영 연결하지 않는 가정에 대해 매일 5회씩 빈 시도가 쌓인다.
+
+### 브리프 시각 판정은 SQL 선별로 한다
+
+가정마다 상태를 적재해 `briefTime`을 보는 대신, 클레임 질의가 `brief_time <= :time`인 가정만 고른다. `DailyBriefService.get`은 `buildDailyBrief`가 식단, 원장, 예측을 전부 도는 무거운 읽기이므로, 클레임에 성공한 가정에 대해서만 부른다. 매분 가정마다 전체 상태를 적재하던 것이 가정마다 하루 한 번으로 줄어든다.
+
+`:time`은 `ClockPort.now().time`이 준 Asia/Seoul 벽시계 문자열이고 SQL의 `now()`가 아니다. ADR 0005의 "대가와 남는 위험"이 적어 둔 것을 지킨다.
+
+> 시간대 계산이 두 벌이 된다. 우리 벽시계는 `Intl`을 쓰는 `SeoulClock`이고, 크론 발화 시각은 luxon이 정한다. 매분 크론에서는 둘이 만나지 않지만, 5단계에서 브리프 시각을 보게 되면 판정은 `ClockPort`로만 한다.
+
+문자열 `<=` 비교가 안전한 이유는 제로패딩이 강제되기 때문이다. `prisma/migrations/20260921134349_init/migration.sql`이 `brief_time`과 `meal_time` 둘 다 같은 CHECK로 묶는다.
+
+```sql
+ALTER TABLE "slot_schedule" ADD CONSTRAINT "slot_schedule_meal_time_check" CHECK ("meal_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
+ALTER TABLE "alert_settings" ADD CONSTRAINT "alert_settings_brief_time_check" CHECK ("brief_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
+```
+
+`'07:30' <= '09:00'`은 자릿수가 같으므로 사전순 비교가 시각 비교와 일치한다. `'7:30'`이 들어올 수 있었다면 성립하지 않는다.
+
+**함정은 `alert_settings` 행이 없을 수 있다는 것이다.** `src/infrastructure/prisma/mappers/state.mapper.ts`의 `toAlertSettings`가 행이 없으면 `DEFAULT_BRIEF_TIME`(`07:30`)으로 떨어진다.
+
+```ts
+export function toAlertSettings(row: AlertSettingsRow | null): AlertSettings {
+  return {
+    briefTime: localTime(row?.briefTime ?? DEFAULT_BRIEF_TIME),
+```
+
+`pnpm member-token`이 만든 새 가정이 정확히 그 상태다. `update_alert_settings`를 한 번도 부르지 않았으므로 행이 없다.
+
+그래서 클레임 질의는 `LEFT JOIN alert_settings`에 `COALESCE(alert_settings.brief_time, :defaultBriefTime) <= :time`이어야 한다. INNER JOIN이면 그 가정들은 `get_daily_brief`로는 07:30이라고 말하면서 발송은 영원히 일어나지 않는다. 증상이 "설정을 한 번 저장하면 고쳐진다"라서 원인을 찾기 어렵다.
+
+기본 시각 상수는 매퍼의 `DEFAULT_BRIEF_TIME`을 import해 한 곳에만 둔다. SQL에 `'07:30'`을 다시 적으면 둘이 갈라진 순간부터 조회와 발송이 다른 시각을 말한다.
+
+### 후속 메시지의 세 갈래
+
+기획안 4.6절은 "식단시간이 지나면 반응 기록 버튼이 달린 후속 메시지를 보내고, 기록이 없으면 다음 브리프에 미기록으로 올린다"로 정했다. 문제는 "그 끼니를 이미 먹였는가"를 SQL로 물을 수 없다는 것이다. 기획안 4.3절대로 식단의 날짜는 저장하지 않고 미급여 기록에서 계산하므로, 오늘 그 끼니에 놓인 식단이 무엇인지는 `projectCalendar`를 돌려야 나온다.
+
+그래서 순서를 뒤집는다. `slot_schedule.meal_time <= :time`으로 먼저 클레임하고, 브리프를 만들어 본 뒤에 판정한다. 클레임이 싸고 브리프가 비싸므로, 비싼 쪽을 하루 한 번으로 제한하는 방향이다.
+
+| 브리프가 말하는 것 | 처리 |
+|---|---|
+| 그 끼니에 식단이 없다 (`BriefSlot.meal === null`) | `skipped`로 종결. 미급여를 등록했거나 식단이 끝난 날이다 |
+| 식단은 있는데 `meal.fed`가 아직 false다 | 자기 행을 지우고(`releaseClaim`) 다음 tick이 다시 잡게 한다 |
+| `meal.fed`인데 `newIngredients`에 그 끼니의 재료가 없다 | `skipped`로 종결. 물어볼 것이 없다 |
+
+가운데 갈래가 되돌림인 이유는 창이 1분이기 때문이다. 식단시간이 막 지났고 정합화가 아직 돌지 않았으면 식단은 여전히 `planned`다. ADR 0005가 적은 대로 "식단시간 직후 최대 1분의 지연"이 있고, 그 1분을 `releaseClaim`으로 넘긴다.
+
+첫 갈래를 `skipped` 종결로 두는 것이 이 표에서 가장 중요하다. 그것도 되돌림으로 처리하면, 미급여를 등록한 날에는 그 끼니에 식단이 영영 놓이지 않으므로 `fed`가 true가 되는 일이 없고, 클레임과 되돌림이 자정까지 매분 반복된다.
+
+### 버튼 응답의 멱등키
+
+`slack:{message.ts}:{action_id}:{value}`다.
+
+`message.ts`만으로는 한 메시지 안의 버튼들이 구분되지 않는다. 브리프 한 건에 미급여, 반응, 폐기 버튼이 함께 달린다. `action_id`까지만 써도 부족하다. 폐기 대기 배치가 둘이면 "폐기 완료" 버튼이 두 개이고, 같은 키에 다른 본문(`batchId`)이 온다. 그때 `src/infrastructure/prisma/household-writer.ts`가 `IDEMPOTENCY_KEY_REUSED`로 거부한다.
+
+```ts
+if (record.requestHash !== hashPayload(request)) {
+  throw new ApplicationError(
+    'IDEMPOTENCY_KEY_REUSED',
+    `같은 멱등키에 다른 요청이 왔습니다: ${request.idempotencyKey}`,
+  );
+}
+```
+
+두 번째 배치는 폐기되지 않고 부모는 오류만 본다. `value`는 우리가 버튼을 만들 때 넣는 값이고 버튼마다 다르므로, 키에 넣으면 그 충돌이 없어진다.
+
+같은 버튼을 다시 탭하면 `message.ts`, `action_id`, `value`가 모두 같고 본문도 같다. 요청 해시가 일치하므로 기록된 응답이 그대로 돌아오고 원장에는 아무것도 더해지지 않는다. 부모가 응답을 못 봤다고 다시 누르는 것이 안전하다.
+
+### 서명 검증
+
+`X-Slack-Signature`와 `X-Slack-Request-Timestamp`를 쓴다. 기준 문자열은 `v0:{timestamp}:{raw body}`이고, 서명 비밀을 키로 HMAC-SHA256을 계산해 hex로 만든 뒤 `v0=`를 붙인 것과 비교한다. 비교는 `crypto.timingSafeEqual`이다. 타임스탬프가 현재에서 5분 넘게 떨어져 있으면 본문을 보지 않고 거부한다.
+
+출처: https://docs.slack.dev/authentication/verifying-requests-from-slack .
+
+현재 시각은 `ClockPort.instant()`로 받는다. 타임스탬프는 유닉스 초이고 절대 시각이므로 `now()`의 Seoul 벽시계가 아니다. `src/application/ports/clock.port.ts`가 그 구분을 적어 두었고, `member-token.verifier.ts`가 토큰 만료에 같은 선택을 했다.
+
+기준 문자열이 파싱된 본문이 아니라 **원본 바이트**라는 점이 이 결정의 실질이다. Slack이 보내는 것은 `application/x-www-form-urlencoded`의 `payload=<JSON>`이고, 파싱했다가 다시 직렬화하면 바이트가 달라져 서명이 맞지 않는다. 그래서 `main.ts`가 `NestFactory.create(AppModule, { rawBody: true })`로 떠야 한다. 그것이 NestJS가 파서에 원본을 남기게 하는 방법이고, 컨트롤러는 `@Req()`의 `rawBody`로 그것을 받는다.
+
+### 버튼 응답은 처리보다 먼저 200으로 답한다
+
+순서는 이렇다.
+
+```
+서명 검증 → 200 응답 → 구성원 해석 → 유스케이스 → response_url 통보
+```
+
+200을 DB에 닿기 전에 내보낸다.
+
+Slack은 3초 안에 200을 받지 못하면 사용자에게 오류를 보이고 요청을 다시 보낸다. 그런데 버튼이 부르는 세 유스케이스(`NoFeedService.register`, `ReactionService.record`, `StockService.discardBatch`)는 전부 `HouseholdWriter.write`를 타고, 그 트랜잭션의 첫 문장이 가정 행을 `FOR UPDATE`로 잡는 것이다. 그 행은 매분 도는 정합화 쓸기가 이미 잡고 있을 수 있다. `src/infrastructure/prisma/household-writer.ts`의 한계값이 둘 다 3초보다 크다.
+
+```ts
+const TRANSACTION_TIMEOUT_MS = 15_000;
+const TRANSACTION_MAX_WAIT_MS = 10_000;
+const LOCK_TIMEOUT = '5s';
+```
+
+처리를 먼저 하면 쓸기와 겹친 순간의 탭이 확정적으로 3초를 넘는다. 잠금을 기다리다 5초에 실패하든 성공하든 3초는 이미 지났다. 기획안 5장이 버튼에 기대하는 "버튼은 결과가 정해져 있어 오입력이 없고 한 번의 탭으로 끝난다"와 양립하지 않는다.
+
+구성원 해석도 200 뒤에 둔다. Slack 사용자 id로 `member`를 찾는 것은 인덱스 조회라 잠금을 잡지 않지만, 커넥션 풀에서 커넥션을 얻는 것 자체가 쓸기에 막힐 수 있다. 잠금이 없다는 것과 빠르다는 것은 다르다.
+
+지연 처리를 `void`로 띄우는 선례는 `src/mcp/auth/member-token.verifier.ts:41`에 있다.
+
+```ts
+// lastUsedAt은 요청 경로 밖에서 갱신한다. 인증이 쓰기를 하면 읽기 전용 도구도
+// 쓰기 트랜잭션을 타고, 실패하면 멀쩡한 토큰이 거부된다.
+void this.touch(record.id);
+```
+
+그것이 안전한 이유는 띄운 함수가 내부에서 예외를 전부 삼키기 때문이다(`touch`의 `try`/`catch`). `void`로 띄운 Promise가 reject되면 Node는 unhandled rejection으로 프로세스를 죽인다. Slack의 지연 처리도 같은 규칙을 지켜, 오류는 밖으로 던지지 않고 `response_url`로 보낸다.
+
+바뀌지 않는 것 셋이다. 응답은 언제나 200이다. 처리 결과와 오류는 `response_url`에 ephemeral로 보낸다. 서명 검증 실패만 401이고, 그때는 본문을 보지 않는다.
+
+**대가**: 200을 보낸 뒤 처리 전에 프로세스가 죽으면 그 탭은 사라진다. 부모는 아무 응답도 받지 못하고 원장에도 아무것도 남지 않는다. 그때 부모가 다시 탭하면 `message.ts`, `action_id`, `value`가 같아 멱등키가 같으므로, 처리가 절반 일어난 상태로 두 번 기록되는 일은 없다. 이 대가는 아래 배포 절의 종료 훅 옆에 한 번 더 적는다. 종료 훅을 읽는 사람이 그 상호작용을 봐야 하기 때문이다.
+
+### Railway 배포
+
+설정을 저장소에 둔다. `railway.json`이다.
+
+| 키 | 값 |
+|---|---|
+| `build.builder` | `DOCKERFILE` |
+| `deploy.preDeployCommand` | `pnpm db:deploy` |
+| `deploy.healthcheckPath` | `/health` |
+| `deploy.restartPolicyType` | `ON_FAILURE` |
+
+출처: https://docs.railway.com/reference/config-as-code 와 https://docs.railway.com/deployments/pre-deploy-command .
+
+프리디플로이 명령은 빌드와 배포 사이에 돌고, 실패하면 배포가 진행되지 않으며, 서비스 환경 변수에 접근한다. 마이그레이션에 이 자리가 맞는 이유는 그 셋이 전부다. 실패하면 옛 버전이 계속 뜨고, `DATABASE_URL`을 따로 넣어 줄 필요가 없다. `pnpm db:deploy`는 이미 있는 스크립트이고 `prisma migrate deploy`다.
+
+`enableShutdownHooks()`를 `main.ts`에 넣는다. ADR 0005의 "대가와 남는 위험"이 미뤄 둔 항목이다.
+
+> SIGTERM에 도는 tick을 정리하지 않는다. `main.ts`에 `enableShutdownHooks`가 없어서 프로세스가 그대로 죽고, 트랜잭션은 롤백되며 다음 tick이 같은 일을 다시 한다. 정합성 문제는 없지만 배포를 다루는 5단계에서 다시 본다.
+
+배포는 SIGTERM으로 옛 인스턴스를 내린다. 훅이 있어야 `PrismaService.onModuleDestroy`가 불려 커넥션이 닫히고, `@nestjs/schedule`이 등록한 크론이 정리된다.
+
+**종료 훅이 정리하는 것은 도는 tick과 커넥션이지 버튼의 지연 처리가 아니다.** 버튼 응답은 위에서 정한 대로 200을 먼저 보내고 처리를 `void`로 띄운다. 그 Promise는 Nest의 종료 훅이 아는 것이 아니므로, 200을 보낸 뒤 유스케이스를 부르기 전에 종료가 시작되면 그 탭은 사라진다. 배포할 때마다 그 창이 열린다. 사라진 탭은 부모가 다시 누르면 되고, 멱등키가 같아 두 번 기록되지 않는다.
+
+Railway 프로젝트 생성, 결제 수단 등록, PITR 활성화, 도메인 연결, 환경 변수 입력은 사람이 웹 콘솔에서 한다. 목록은 `docs/user-intervention.md`의 3번에 있다. ADR 0003이 PITR 플랜 조건을 "프로비저닝 때 확인"으로 남겨 두었고, 그것은 이 결정 시점에도 아직 모르는 채다. 확인한 뒤 ADR 0003의 상태를 고친다.
+
+## 층별 결합
+
+Slack 코드는 `src/slack` 하나에 모은다. 발송이 버튼의 `value`를 인코딩하고 수신이 그것을 디코딩하므로, 양쪽이 같은 모듈(`src/slack/actions.ts`)을 공유해야 한다. 발송을 `src/infrastructure/slack`에 두면 수신 어댑터가 인프라를 import하거나, 공유 코드만 담는 세 번째 집이 필요해진다.
+
+`src/slack`은 어댑터다. `src/mcp`, `src/scheduler`와 같은 위치이고 재고 규칙을 다시 쓰지 않는다. 버튼 셋이 부르는 것은 전부 기존 유스케이스다.
+
+| 버튼 | 유스케이스 |
+|---|---|
+| 끼니별 미급여 (해동 전, 해동 후) | `NoFeedService.register` |
+| 반응 없음, 반응 있음 | `ReactionService.record` |
+| 폐기 완료 | `StockService.discardBatch` |
+
+가정·구성원·채널 식별자를 조회하는 것은 유스케이스가 아니므로, 발송 어댑터가 가정의 Slack 채널 id를 읽고 수신 어댑터가 Slack 사용자 id로 구성원을 찾는 것은 Prisma에 직접 닿는다. ADR 0004의 "층별 결합"이 토큰 검증기에 대해 정한 것과 같은 규칙이다. 도구나 어댑터가 저장소에 닿아 재고 규칙의 두 번째 사본을 만드는 것은 여전히 금지다.
+
+모듈은 둘로 나눈다.
+
+| 모듈 | import하는 것 | import되는 곳 |
+|---|---|---|
+| `SlackDeliveryModule` (발송) | `PersistenceModule` | `ApplicationModule` |
+| `SlackInteractionModule` (수신) | `ApplicationModule` | `AppModule` |
+
+하나로 두면 순환이 된다. 발송은 `BriefDeliveryPort`의 구현이라 애플리케이션이 그것을 받아야 하고, 수신은 애플리케이션 서비스를 불러야 한다. 두 방향이 한 모듈에 있으면 `ApplicationModule`과 그 모듈이 서로를 import한다.
+
+애플리케이션 계층은 Slack을 모른다. `BriefDeliveryPort`는 "브리프를 전달한다"까지만 말하고 채널도 Block Kit도 모른다. 포트가 `DailyBrief`를 받고 결과를 돌려주는 모양이라, 전달 수단이 바뀌어도 애플리케이션은 바뀌지 않는다.
+
+도메인 코어는 이번에도 바뀌지 않는다. 다섯 단계째다.
+
+발송 대상을 늘리는 방법은 `BriefDeliveryPort`의 다른 구현을 만들어 `ApplicationModule`에 끼우는 것이다. 버튼을 늘리는 방법은 `src/slack/actions.ts`에 `action_id`와 `value` 인코딩을 더하고 수신 쪽 분기를 더하는 것이며, 새 버튼이 재고를 직접 만지려면 애플리케이션에 유스케이스를 먼저 만들어야 한다.
+
+## 대가와 남는 위험
+
+- 발송이 at-least-once다. `chat.postMessage`가 성공한 직후 결과를 쓰기 전에 프로세스가 죽으면, `claimed_at`이 5분을 넘긴 `pending` 행을 다시 잡아 같은 브리프를 두 번 보낸다. 브리프는 읽는 메시지이고 버튼은 멱등키로 보호되므로 중복 자체가 데이터를 망가뜨리지는 않는다.
+- `skipped`가 종결이라 채널을 낮에 연결한 가정은 그날 브리프를 받지 못한다. 다음 날 아침부터 받는다.
+- `@slack/web-api`를 쓰지 않으므로 rate limit 429 처리와 `ok: false` 판정을 우리가 진다. 하루 두 건에서 429는 현실적이지 않지만, 본문의 `ok`를 보지 않는 어댑터는 모든 실패를 성공으로 기록한다.
+- `SLACK_BOT_TOKEN`과 `SLACK_SIGNING_SECRET`이 필수 환경 변수가 된다. `src/config/env.ts`가 한곳에서 읽으므로, DB만 쓰는 `pnpm member-token`과 `pnpm slack-link`도 그 값이 없으면 뜨지 않는다.
+- Block Kit에 한계가 있다. 메시지당 블록 50개, section 텍스트 3000자, actions 블록당 요소 25개다(출처: https://docs.slack.dev/block-kit/ ). 재고 재료가 많아지면 브리프의 재고현황 표가 먼저 그 한계에 닿는다. 지금 재료 수에서는 닿지 않지만, 넘칠 때 자르는 규칙은 두지 않았다.
+- 200을 먼저 보내므로 그 뒤 처리가 죽으면 탭이 사라진다(위 "버튼 응답은 처리보다 먼저 200으로 답한다"). 배포 때마다 그 창이 열린다.
+- Railway PITR의 플랜 조건은 여전히 모른다. ADR 0003의 상태가 "채택 (PITR 플랜 조건은 프로비저닝 때 확인)"인 채로 남아 있고, 이 ADR이 그것을 해소하지 않는다.
```

## `docs/product-plan.md`

```diff
diff --git c/docs/product-plan.md w/docs/product-plan.md
index 1bc0fb5..c39e3f5 100644
--- c/docs/product-plan.md
+++ w/docs/product-plan.md
@@ -258,6 +258,14 @@ MCP는 공식 SDK v2를 직접 쓰고 `/mcp` 한 경로에 마운트하며, 세
 
 브리프는 애플리케이션 읽기 모델(`src/application/daily-brief.ts`)이 기존 도메인 함수를 조합해 만든다. 저장하지 않기로 한 보류된 차감은 읽어 온 상태에 `reconcileMeals`를 다시 걸어 `held`만 가져가며, 그래서 `get_daily_brief`는 쓰기 트랜잭션을 타지 않는다. 브리프 발송 이력은 발송이 생기는 5단계에 둔다. 근거는 `docs/adr/0005-scheduler-and-daily-brief.md`에 있다.
 
+### 5단계에서 정한 것
+
+Slack 호출은 SDK 없이 `fetch`로 한다. 부르는 것이 `chat.postMessage` 하나이고 하루 두 건이라 `@slack/web-api`가 끌고 오는 큐와 재시도 계층이 필요하지 않으며, 버튼 응답의 `response_url`은 어차피 SDK 경로가 아니다. 대신 Slack Web API가 실패도 HTTP 200에 `{"ok": false}` 본문으로 돌려준다는 것을 어댑터가 직접 봐야 한다. 발송 이력은 `brief_delivery`(가정, 날짜)와 `reaction_prompt_delivery`(가정, 날짜, 끼니) 둘이고, 기본키가 하루 한 건을 강제한다. 클레임은 `INSERT ... ON CONFLICT DO NOTHING`이라 인스턴스가 둘이어도 한쪽만 행을 얻는다. 재시도는 1분, 5분, 15분, 60분 뒤 네 번이고 5회로 끝난다.
+
+브리프 시각 판정은 클레임 질의가 `brief_time <= :time`인 가정만 고르는 방식이다. 시각은 `ClockPort`가 준 Asia/Seoul 벽시계 문자열이고, 알람 설정 행이 없는 가정을 위해 기본 시각으로 `COALESCE`한다. 후속 메시지는 식단시간으로 먼저 클레임한 뒤 브리프를 만들어 보고 판정한다. 식단의 날짜가 저장되지 않아 "이미 먹였는가"를 조회로 물을 수 없기 때문이다. 버튼 응답의 멱등키는 메시지 타임스탬프, `action_id`, 버튼 값을 합친 값이고, 같은 버튼을 다시 탭하면 기록된 응답이 그대로 돌아온다.
+
+버튼 수신은 서명을 검증한 뒤 처리보다 먼저 200을 내보낸다. 버튼이 부르는 유스케이스가 전부 가정 행 잠금을 타고 그 대기 한계가 Slack의 3초보다 크기 때문이다. 결과와 오류는 `response_url`에 ephemeral로 보낸다. 배포 설정은 `railway.json`에 두고 마이그레이션은 프리디플로이 명령으로 돌리며, `main.ts`에 종료 훅을 넣어 도는 크론과 커넥션을 정리한다. Slack 코드는 발송과 수신이 버튼 값 인코딩을 공유하므로 `src/slack` 한곳에 모으고, 애플리케이션은 `BriefDeliveryPort`까지만 알고 Slack을 모른다. 근거는 `docs/adr/0006-slack-delivery-and-deployment.md`에 있다.
+
 ## 10. 미정 사항
 
 - Railway Postgres PITR의 플랜 조건. 공식 문서에 없어서 프로비저닝 때 확인한다.
```

## `docs/user-intervention.md`

```diff
diff --git c/docs/user-intervention.md w/docs/user-intervention.md
index 64c0c93..5fb32b5 100644
--- c/docs/user-intervention.md
+++ w/docs/user-intervention.md
@@ -22,7 +22,20 @@
 
 이 토큰이 연결되는 곳은 5단계다. 기획안 9장의 5단계 범위가 "브리프 발송과 재시도, 버튼 응답"이고, 기획안 5장이 브리프 구성과 버튼(끼니별 미급여, 반응 없음과 반응 있음, 폐기 완료)을 정해 두었다. 버튼 응답을 누가 눌렀는지는 구성원의 Slack 사용자 ID로 매핑하며, 그 자리는 `prisma/schema.prisma`의 `slack_user_id`에 이미 있다.
 
-필요한 스코프의 정확한 목록은 아직 확정하지 않았다. 브리프를 채널에 보내려면 메시지 발송 권한이 필요하고, 버튼 응답은 기획안 8장이 Socket Mode가 아니라 HTTP 수신으로 정했으므로 요청 URL 설정이 함께 필요하다. 구체적인 스코프와 URL은 5단계에서 발송 코드를 쓸 때 정한다. 토큰을 넣을 환경 변수도 아직 없다. 지금 `.env.example`에는 Slack 항목이 없고, 5단계에서 추가한다.
+콘솔에서 넣을 값은 5단계에서 확정했다(`docs/adr/0006-slack-delivery-and-deployment.md`).
+
+| 항목 | 값 |
+|---|---|
+| 봇 스코프 | `chat:write` |
+| Interactivity의 Request URL | `https://<서버 주소>/slack/interactions` |
+| 봇 토큰(`xoxb-`로 시작) | 환경 변수 `SLACK_BOT_TOKEN` |
+| 서명 비밀(Signing Secret) | 환경 변수 `SLACK_SIGNING_SECRET` |
+
+스코프가 `chat:write` 하나인 이유는 서버가 Slack에 하는 일이 `chat.postMessage` 하나이기 때문이다. 버튼 응답의 통보는 Slack이 요청 본문에 넣어 주는 일회용 `response_url`로 보내므로 스코프를 요구하지 않는다.
+
+서명 비밀이 필요한 이유는 수신이 HTTP이기 때문이다. 기획안 8장이 Socket Mode가 아니라 HTTP 수신으로 정했고, 공개된 URL로 들어온 요청이 Slack에서 온 것인지는 `X-Slack-Signature` 검증으로만 판정한다. 이 값은 봇 토큰과 다른 값이고 앱 설정의 Basic Information에 있다.
+
+브리프를 받을 채널에 봇을 초대해야 한다. 초대하지 않으면 `chat.postMessage`가 `not_in_channel`로 실패한다. 채널 id를 가정에 연결하는 것은 `pnpm slack-link`로 하며, 그것은 서버가 뜬 뒤에 한다. 이 명령은 `DATABASE_URL`이 가리키는 데이터베이스에 쓴다. 채널이 연결되지 않은 가정의 그날 브리프는 재시도 없이 건너뛰고 다음 날 아침부터 발송된다(ADR 0006 "재시도 정책").
 
 ## 3. Railway 프로젝트와 Postgres를 만들고 PITR을 켠다
 
@@ -32,6 +45,20 @@
 
 ADR 0003이 같은 문서에서 요구하는 것이 셋 더 있다. 복구 가능 구간은 PITR을 켠 뒤의 첫 베이스 백업부터이므로 운영 데이터를 넣기 전에 켠다. 복구 절차는 운영 데이터를 넣기 전에 한 번 실제로 수행해 본다. 서버와 DB는 사설망으로 연결하고 DB를 외부에 노출하지 않는다.
 
+서비스 환경 변수는 콘솔에서 넣는다. 배포가 필요로 하는 것은 다섯이다.
+
+| 변수 | 값 |
+|---|---|
+| `DATABASE_URL` | Railway Postgres의 사설망 접속 문자열 |
+| `MCP_ALLOWED_HOSTS` | 서버의 실제 호스트 이름 |
+| `SLACK_BOT_TOKEN` | 2번에서 받은 봇 토큰 |
+| `SLACK_SIGNING_SECRET` | 2번에서 받은 서명 비밀 |
+| `SCHEDULER_ENABLED` | `true` |
+
+`MCP_ALLOWED_HOSTS`는 빈 값으로 두면 `localhost`만 허용한다. 배포된 서버의 실제 주소를 넣지 않으면 `/mcp`로 들어온 모든 요청이 403이 되고, 증상은 Claude Code에서 "연결 실패"로만 보인다(`.env.example`).
+
+`SCHEDULER_ENABLED`를 false로 두면 매분 도는 크론이 등록되지 않는다. 그러면 자동 차감과 브리프 발송이 둘 다 멈춘다. 브리프 발송이 같은 tick에 붙어 있기 때문이다(`docs/adr/0006-slack-delivery-and-deployment.md`). 자동 차감이 조용히 멈추는 것은 ADR 0005가 "대가와 남는 위험"에 적어 둔 항목이고, 5단계부터는 브리프가 오지 않는 것으로도 드러난다.
+
 ## 4. 구성원 토큰을 발급해 부모의 MCP 설정에 넣는다
 
 - [ ] 부모 두 명의 기기마다 `pnpm member-token`으로 토큰을 발급하고, 각자의 Claude Code에 `claude mcp add`로 등록한다.
```
