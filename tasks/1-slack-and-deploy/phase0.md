# Phase 0: docs

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain
```

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고 `tasks/1-slack-and-deploy/index.json`의 phase 0 status를 `"error"`로, `error_message`에 `dirty working tree`로 적고 멈춰라.

먼저 아래를 읽어라. 이 phase는 5단계 전체의 설계를 문서로 고정하는 일이고, 뒤따르는 phase 일곱 개가 여기서 쓴 ADR 0006을 읽고 구현한다. 문서가 틀리면 구현이 틀린다.

- `docs/product-plan.md` 전체. 특히 5장(브리프 구성과 버튼), 4.6절(후속 메시지), 6장(브리프 발송 이력, 구성원의 Slack 사용자 ID), 8장(아키텍처와 HTTP 수신), 9장(구현 단계와 "4단계에서 정한 것"), 10장(미정 사항)
- `docs/adr/0005-scheduler-and-daily-brief.md` 전체. 특히 "브리프 시각과 발송 이력" 절과 "대가와 남는 위험" 절
- `docs/adr/0004-mcp-server-and-auth.md`의 "층별 결합" 절
- `docs/adr/0003-postgres-hosting-railway.md` 전체
- `docs/user-intervention.md`의 2번과 3번 항목
- `src/application/daily-brief.ts` (브리프 내용의 모양. `DailyBrief`, `BriefSlot`, `BriefNewIngredient`, `BriefExpiryAlert`)
- `src/application/reconcile.service.ts` (`runEveryHousehold`의 모양. 실패가 예외가 아니라 결과인 것)
- `src/infrastructure/prisma/mappers/state.mapper.ts`의 `DEFAULT_BRIEF_TIME`과 `toAlertSettings`
- `docs/adr/0002-orm-prisma.md`의 "대가" 절 (CHECK 제약을 마이그레이션 SQL에 손으로 덧붙이는 관례)

## 작업 내용

문서만 고친다. **코드는 한 줄도 건드리지 않는다.** 아래 다섯 가지를 한다.

### 1. `docs/adr/0006-slack-delivery-and-deployment.md` 신설

이 task의 중심 문서다. 뒤 phase가 이것만 읽고 구현할 수 있어야 한다. 형식은 기존 ADR과 같게 한다(제목, 상태, 결정일, 맥락, 결정, 근거, 층별 결합, 대가와 남는 위험). 결정일은 2026-09-23이다.

아래 결정을 전부 담는다. 각 항목은 이미 정해진 것이므로 새로 정하지 말고 근거를 붙여 서술하라.

**(a) Slack 호출은 SDK 없이 `fetch`로 한다.**

`@slack/web-api`를 런타임 의존성으로 넣지 않는다. 부르는 것은 `chat.postMessage` 하나이고 하루 두 건이다. SDK가 끌고 오는 `p-queue`, `p-retry`, `retry`, `eventemitter3`, `@slack/logger`는 그 규모에 필요한 것이 아니다. 버튼 응답의 `response_url`은 SDK 경로가 아니므로 어차피 `fetch`이고, 둘을 한 방식으로 맞춘다. 타입만 `@slack/types`를 devDependency로 받는다.

여기에 반드시 적을 것: **Slack Web API는 실패도 HTTP 200에 `{"ok": false, "error": "..."}` 본문으로 돌려준다.** 어댑터가 HTTP 상태만 보고 `ok`를 보지 않으면 모든 발송이 성공으로 기록된다. 이것이 SDK를 쓰지 않을 때 직접 져야 하는 책임이고, phase 3의 통합 테스트가 그 경로를 고정한다.

**(b) 발송 기록과 클레임.**

기획안 6장의 "브리프 발송 이력(발송 일시, 결과, 재시도 횟수)"을 테이블 둘로 둔다. `brief_delivery`는 기본키가 (가정, 날짜)이고, `reaction_prompt_delivery`는 (가정, 날짜, 끼니)다. 기본키가 "하루 한 건"을 강제한다.

클레임은 `INSERT ... ON CONFLICT DO NOTHING RETURNING`이다. 삽입 자체가 원자적이라 인스턴스가 둘이어도 한쪽만 행을 얻고, 잠금이 필요 없다. ADR 0005는 "가정 행 잠금 아래에서 조회 후 삽입"으로 적어 두었는데 그것을 이 방식으로 바꾼다는 사실과, 같은 목적("하루 한 건을 기본키로 강제")을 더 적은 것으로 이룬다는 점을 적어라.

후속 메시지의 기록 키를 식단 id가 아니라 (날짜, 끼니)로 두는 이유도 적어라. `ReactionService.record`가 (date, slot, ingredientName)로 받고, `no_feed_record`의 기본키가 이미 (가정, 날짜, 끼니)다. 미급여로 식단이 밀리면 실제로 먹인 날에 다시 물어야 하므로 식단 id보다 날짜와 끼니가 맞다.

**(c) 재시도 정책을 숫자로.**

| 실패한 시도 | 다음 시도까지 |
|---|---|
| 1회 | 1분 |
| 2회 | 5분 |
| 3회 | 15분 |
| 4회 | 60분 |
| 5회 | 없음. 그날은 포기한다 |

총 창은 약 81분이다. 매분 tick이 실패한 행을 곧바로 다시 잡으면 5회가 5분 만에 소진되어 5분짜리 Slack 장애에 그날 브리프를 잃는다는 것이 이 간격의 이유다. 판정은 `next_attempt_at` 컬럼으로 한다.

여기에 함께 적을 것 셋이다.

- 마지막 시도(5회째)가 실패해도 `next_attempt_at`에는 값이 들어간다. `CHECK (status <> 'failed' OR next_attempt_at IS NOT NULL)`을 만족시키기 위해서다. 다시 잡히지 않는 것은 그 컬럼이 아니라 `attempts < 5` 조건이 막는다.
- 발송 중 프로세스가 죽어 `pending`으로 남은 행은 `claimed_at`이 5분보다 오래됐을 때 다시 잡는다. 이것은 at-least-once다. `chat.postMessage`가 성공한 직후에 죽으면 같은 브리프가 두 번 간다. 부모가 같은 브리프를 두 번 보는 것과 아예 못 보는 것 중 후자가 더 나쁘다고 판단했다.
- `skipped`는 종결 상태다. 채널이 연결되지 않은 가정은 그날 `skipped`로 끝나고, 낮에 연결해도 그날 브리프는 오지 않으며 다음 날 아침부터 받는다.

**(d) 브리프 시각 판정을 SQL 선별로 한다.**

가정마다 상태를 적재해 `briefTime`을 보는 대신, 클레임 질의가 `alert_settings.brief_time <= :time`인 가정만 고른다. 매분 가정마다 전체 상태를 적재하는 것을 하루 한 번으로 줄인다. 무거운 `DailyBriefService.get`은 클레임에 성공한 가정에 대해서만 부른다.

`:time`은 `ClockPort.now().time`이 준 Asia/Seoul 벽시계 문자열이고 SQL의 `now()`가 아니다. ADR 0005가 "5단계에서 브리프 시각을 보게 되면 판정은 `ClockPort`로만 한다"로 적어 둔 것을 지킨다. 문자열 `<=` 비교가 안전한 이유는 `prisma/migrations/20260921134349_init/migration.sql`의 CHECK가 `brief_time`과 `meal_time` 둘 다 `^([01][0-9]|2[0-3]):[0-5][0-9]$`로 제로패딩을 강제하기 때문이다.

**여기에 반드시 적을 함정**: `alert_settings` 행은 없을 수 있다. `src/infrastructure/prisma/mappers/state.mapper.ts`의 `toAlertSettings`가 행이 없으면 `DEFAULT_BRIEF_TIME`(07:30)으로 떨어진다. `pnpm member-token`이 만든 새 가정이 정확히 그 상태다. 그래서 클레임 질의는 `LEFT JOIN alert_settings` + `COALESCE(brief_time, DEFAULT_BRIEF_TIME)`이어야 한다. INNER JOIN이면 `update_alert_settings`를 한 번도 부르지 않은 가정은 `get_daily_brief`로는 기본 시각을 말하는데 발송은 영원히 일어나지 않는다. 상수는 매퍼의 것을 import해 한 곳에만 둔다.

**(e) 후속 메시지의 세 갈래.**

식단의 날짜는 저장되지 않으므로 "그 끼니를 이미 먹였는가"를 SQL로 물을 수 없다. 그래서 `slot_schedule.meal_time <= :time`으로 먼저 클레임한 뒤 브리프를 만들어 보고 판정한다.

| 브리프가 말하는 것 | 처리 |
|---|---|
| 그 끼니에 식단이 없다 (`meal === null`) | `skipped`로 종결. 미급여를 등록했거나 식단이 끝난 날이다 |
| 식단은 있는데 아직 급여 완료가 아니다 | 자기 행을 지우고(`releaseClaim`) 다음 tick이 다시 잡게 한다. 정합화가 아직 돌지 않은 1분 이내다 |
| 급여 완료인데 새 재료가 없다 | `skipped`로 종결. 물어볼 것이 없다 |

첫 갈래를 `skipped` 종결로 두는 것이 중요하다. 되돌림으로 처리하면 미급여를 등록한 날에는 `fed`가 영영 true가 되지 않아 클레임과 되돌림이 자정까지 매분 반복된다.

**(f) 버튼 응답의 멱등키.**

`slack:{message.ts}:{action_id}:{value}`다. `message.ts`만으로는 한 메시지 안의 버튼들이 구분되지 않고, `action_id`까지만 써도 폐기 대기 배치가 둘이면 같은 키에 다른 본문이 온다. 그때 `src/infrastructure/prisma/household-writer.ts`의 멱등 기록이 `IDEMPOTENCY_KEY_REUSED`로 거부하므로 두 번째 배치는 폐기되지 않는다. `value`는 우리가 만드는 값이고 버튼마다 다르다. 같은 버튼을 다시 탭하면 키와 본문이 모두 같아 기록된 응답이 그대로 돌아온다.

**(g) 서명 검증.**

`X-Slack-Signature`와 `X-Slack-Request-Timestamp`를 쓴다. 기준 문자열은 `v0:{timestamp}:{raw body}`이고, 서명 비밀을 키로 HMAC-SHA256을 계산해 hex로 만든 뒤 `v0=`를 붙인 것과 비교한다. 비교는 `crypto.timingSafeEqual`이다. 타임스탬프가 현재에서 5분 넘게 떨어져 있으면 거부한다. 현재 시각은 `ClockPort.instant()`로 받는다. 출처는 https://docs.slack.dev/authentication/verifying-requests-from-slack 이다.

기준 문자열이 파싱된 본문이 아니라 **원본 바이트**라는 점을 적어라. 그래서 `main.ts`가 `rawBody: true`로 떠야 하고, 그것이 NestJS가 파서에 원본을 남기게 하는 방법이다.

**(h) 버튼 응답은 처리보다 먼저 200으로 답한다.**

순서가 `서명 검증 → 200 응답 → 구성원 해석 → 유스케이스 → response_url 통보`다. 200을 DB에 닿기 전에 내보낸다.

이유를 적어라. Slack은 3초 안에 200을 받지 못하면 사용자에게 오류를 보이고 재전송한다. 그런데 버튼이 부르는 세 유스케이스는 전부 `HouseholdWriter.write`를 타고, 그 트랜잭션의 첫 문장이 가정 행을 `FOR UPDATE`로 잡는 것이다. 그 행은 매분 도는 정합화 쓸기가 이미 잡고 있을 수 있고, `src/infrastructure/prisma/household-writer.ts`의 잠금 타임아웃과 트랜잭션 대기 한계는 둘 다 3초보다 크다. 처리를 먼저 하면 겹친 순간의 탭이 확정적으로 한계를 넘는다. 기획안 5장이 버튼에 기대하는 "한 번의 탭으로 끝난다"와 양립하지 않는다.

구성원 해석도 200 뒤다. 인덱스 조회라 잠금은 없지만 커넥션 풀 획득 자체가 쓸기에 막힐 수 있다.

지연 처리를 `void`로 띄우는 선례가 `src/mcp/auth/member-token.verifier.ts:41`에 있다. 그것이 안전한 이유는 띄운 함수가 내부에서 예외를 전부 삼키기 때문이라는 점을 함께 적어라.

바뀌지 않는 것 셋: 응답은 언제나 200이다. 처리 결과와 오류는 `response_url`에 ephemeral로 보낸다. 서명 검증 실패만 401이고 그때는 본문을 보지 않는다.

**대가**: 200을 보낸 뒤 처리 전에 프로세스가 죽으면 그 탭은 사라지고 부모는 아무 응답도 받지 못한다. 그때 부모가 다시 탭하면 멱등키가 같아 한 번만 기록된다. 이 대가는 (i)의 종료 훅 결정 옆에도 한 번 더 적어라. phase 6에서 종료 훅을 읽는 사람이 그 상호작용을 봐야 한다.

**(i) Railway 배포.**

`railway.json`으로 설정을 저장소에 둔다. `build.builder`는 `DOCKERFILE`, `deploy.preDeployCommand`는 `pnpm db:deploy`, `deploy.healthcheckPath`는 `/health`, `deploy.restartPolicyType`은 `ON_FAILURE`다. 프리디플로이 명령은 빌드와 배포 사이에 돌고, 실패하면 배포가 진행되지 않으며, 서비스 환경 변수에 접근한다. 출처는 https://docs.railway.com/reference/config-as-code 와 https://docs.railway.com/deployments/pre-deploy-command 다.

`enableShutdownHooks()`를 `main.ts`에 넣는다. ADR 0005의 "대가와 남는 위험"이 "SIGTERM에 도는 tick을 정리하지 않는다. ... 배포를 다루는 5단계에서 다시 본다"로 미뤄 둔 항목이다. 그것이 있어야 `PrismaService.onModuleDestroy`가 불리고 도는 크론이 정리된다.

**여기에 (h)의 대가를 다시 적어라.** 종료 훅이 정리하는 것은 도는 tick과 커넥션이지 버튼의 지연 처리가 아니다. 200을 보낸 뒤 유스케이스를 부르기 전에 종료가 시작되면 그 탭은 사라진다.

Railway 프로젝트 생성, 결제 수단, PITR 활성화, 도메인 연결, 환경 변수 입력은 사람이 웹 콘솔에서 한다. ADR 0003이 PITR 플랜 조건을 미정으로 남겨 두었고 그것은 아직 모르는 채다. **확인하지 않은 것을 확인한 것처럼 쓰지 마라.**

**(j) 층별 결합.**

Slack 코드는 `src/slack` 하나에 모은다. 버튼 `value`의 인코딩(`actions.ts`)을 발송 쪽과 수신 쪽이 공유하기 때문이다. 발송을 `src/infrastructure/slack`에 두면 어댑터가 인프라를 import하게 되거나 공유 코드의 세 번째 집이 필요해진다.

`src/slack`은 어댑터다. `src/mcp`, `src/scheduler`와 같은 위치이고 재고 규칙을 다시 쓰지 않는다. 버튼 셋이 부르는 것은 전부 기존 유스케이스다: `NoFeedService.register`, `ReactionService.record`, `StockService.discardBatch`.

모듈은 둘로 나눈다. `SlackDeliveryModule`(발송)은 `PersistenceModule`만 import하고 `ApplicationModule`이 그것을 import한다. `SlackInteractionModule`(수신)은 `ApplicationModule`을 import하고 `AppModule`이 그것을 import한다. 하나로 두면 순환이 된다.

애플리케이션 계층은 Slack을 모른다. `BriefDeliveryPort`는 "브리프를 전달한다"까지만 말하고 채널도 Block Kit도 모른다. 도메인 코어는 이번에도 바뀌지 않는다. 다섯 단계째다.

**(k) 대가와 남는 위험.**

최소한 아래를 적어라. 없는 위험을 지어내지 말고, 확인한 것만 적어라.

- at-least-once 중복 발송 (위 (c))
- `skipped`가 종결이라 당일 연결한 가정은 다음 날부터 (위 (c))
- `@slack/web-api`를 쓰지 않으므로 rate limit 429 처리와 `ok: false` 판정을 우리가 진다
- `SLACK_BOT_TOKEN`과 `SLACK_SIGNING_SECRET`이 필수라 `pnpm member-token`과 `pnpm slack-link`도 그 값을 요구한다
- Block Kit의 한계: 메시지당 블록 50개, section 텍스트 3000자, actions 블록당 요소 25개. 재고 재료가 많아지면 브리프가 그 한계에 닿는다

### 2. `docs/adr/0005-scheduler-and-daily-brief.md` 갱신

"브리프 시각과 발송 이력" 절의 마지막 문장이 지금 이렇게 되어 있다.

> 그 판정에는 하루 한 건이라는 규칙을 기본키로 강제하는 기록이 필요하고, 클레임은 가정 행 잠금 아래에서 조회 후 삽입으로 한다.

클레임 방식이 `INSERT ... ON CONFLICT DO NOTHING`으로 바뀌었으므로 그 문장을 고치고, 바뀐 이유와 ADR 0006을 가리키는 한 줄을 붙여라. **ADR 0005의 다른 결정은 건드리지 마라.** 4단계의 결정 기록이고 지금도 유효하다.

### 3. `docs/adr/0004-mcp-server-and-auth.md` 갱신

"층별 결합" 절에 이 문장이 있다.

> Prisma 클라이언트를 직접 잡는 곳은 토큰 검증기 하나이고, 그것은 토큰 조회가 유스케이스가 아니기 때문이다.

5단계에서 두 곳이 더 생긴다. 가정의 Slack 채널 id를 읽는 발송 어댑터와, Slack 사용자 id로 구성원을 찾는 수신 어댑터다. 문장을 일반형으로 고쳐라. 규칙은 "가정·구성원·채널 식별자를 조회하는 것은 유스케이스가 아니다"이고, 도구나 어댑터가 저장소에 닿아 재고 규칙의 두 번째 사본을 만드는 것은 여전히 금지다. ADR 0006을 가리켜라.

### 4. `docs/product-plan.md`에 "### 5단계에서 정한 것" 절 추가

"### 4단계에서 정한 것" 절 바로 뒤, "## 10. 미정 사항" 앞에 넣는다. 기존 세 절과 같은 분량과 문체로, 5단계에서 정한 것의 요약과 근거 ADR을 가리킨다. 위 (a)~(j)의 결론만 짧게 적고 자세한 근거는 ADR 0006에 둔다.

**9장 표의 5단계 "상태" 칸은 비워 둔 채로 두어라.** 코드가 하나도 없는 시점이다. 그 칸은 마지막 phase가 채운다.

10장 미정 사항에서 "Railway Postgres PITR의 플랜 조건"은 **그대로 둔다.** 아직 모른다.

### 5. `docs/user-intervention.md`의 2번과 3번 보강

2번(Slack 앱)에 지금 확정된 것을 적는다. 필요한 봇 스코프는 `chat:write`다. Interactivity의 Request URL은 `https://<서버 주소>/slack/interactions`다. 서명 비밀(Signing Secret)이 필요하고 그것이 `SLACK_SIGNING_SECRET`으로 들어간다. 봇 토큰은 `SLACK_BOT_TOKEN`이다. 브리프를 받을 채널에 봇을 초대해야 하고, 채널 id를 `pnpm slack-link`로 가정에 연결하는 것은 서버가 뜬 뒤에 한다.

지금 2번에 "필요한 스코프의 정확한 목록은 아직 확정하지 않았다"와 "토큰을 넣을 환경 변수도 아직 없다. 지금 `.env.example`에는 Slack 항목이 없고, 5단계에서 추가한다"로 적힌 부분이 있다. 확정됐으므로 고쳐라.

3번(Railway)에 배포가 필요로 하는 환경 변수 목록을 적는다: `DATABASE_URL`, `MCP_ALLOWED_HOSTS`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SCHEDULER_ENABLED`. `MCP_ALLOWED_HOSTS`를 비우면 모든 요청이 403이 된다는 것과 `SCHEDULER_ENABLED`를 false로 두면 자동 차감과 브리프 발송이 둘 다 멈춘다는 것을 적어라. PITR 플랜 조건은 여전히 모른다. 그 문장을 바꾸지 마라.

**4번(구성원 토큰)은 이번 phase에서 건드리지 마라.** 환경 변수가 필수가 되는 것은 phase 3과 5이고, 그때 그 phase가 적는다.

## 문서 규약

- 문체는 `docs/`의 다른 문서와 같게 "~한다"로 쓴다.
- 주장에는 근거를 붙인다. 기획안 조항, ADR 번호, 파일 경로, 공식 문서 URL을 지목한다.
- em dash(—)를 문장 연결에 쓰지 않는다.
- 확인하지 않은 것을 단정하지 않는다. PITR 플랜 조건, Slack 앱의 존재 여부가 그것이다.
- 하지 않은 일을 했다고 적지 않는다. 이 phase가 끝난 시점에 Slack 발송 코드는 한 줄도 없다.
- 표와 인용을 쓴다. 기존 ADR이 그렇게 되어 있다.

## Acceptance Criteria

아래를 순서대로 실행해 모두 exit 0이어야 한다.

```bash
# 1) ADR 0006이 생겼고 필요한 결정이 전부 들어 있다
test -f docs/adr/0006-slack-delivery-and-deployment.md
grep -q 'ON CONFLICT' docs/adr/0006-slack-delivery-and-deployment.md
grep -q 'COALESCE' docs/adr/0006-slack-delivery-and-deployment.md
grep -q 'DEFAULT_BRIEF_TIME' docs/adr/0006-slack-delivery-and-deployment.md
grep -q 'next_attempt_at' docs/adr/0006-slack-delivery-and-deployment.md
grep -q 'timingSafeEqual' docs/adr/0006-slack-delivery-and-deployment.md
grep -q 'v0:' docs/adr/0006-slack-delivery-and-deployment.md
grep -q 'response_url' docs/adr/0006-slack-delivery-and-deployment.md
grep -q 'preDeployCommand' docs/adr/0006-slack-delivery-and-deployment.md
grep -q 'enableShutdownHooks' docs/adr/0006-slack-delivery-and-deployment.md
grep -q 'chat.postMessage' docs/adr/0006-slack-delivery-and-deployment.md
grep -q 'releaseClaim' docs/adr/0006-slack-delivery-and-deployment.md

# 2) SDK를 쓰지 않기로 한 결정과 그 대가가 적혀 있다
grep -q '@slack/web-api' docs/adr/0006-slack-delivery-and-deployment.md
grep -q '"ok"' docs/adr/0006-slack-delivery-and-deployment.md
grep -q 'ack' docs/adr/0006-slack-delivery-and-deployment.md

# 3) 재시도 간격 네 개가 전부 적혀 있다
grep -q '1분' docs/adr/0006-slack-delivery-and-deployment.md
grep -q '5분' docs/adr/0006-slack-delivery-and-deployment.md
grep -q '15분' docs/adr/0006-slack-delivery-and-deployment.md
grep -q '60분' docs/adr/0006-slack-delivery-and-deployment.md

# 4) ADR 0005의 옛 클레임 문장이 남아 있지 않다
! grep -q '가정 행 잠금 아래에서 조회 후 삽입' docs/adr/0005-scheduler-and-daily-brief.md
grep -q '0006' docs/adr/0005-scheduler-and-daily-brief.md

# 5) ADR 0004의 문장이 일반형으로 바뀌었다
! grep -q 'Prisma 클라이언트를 직접 잡는 곳은 토큰 검증기 하나이고' docs/adr/0004-mcp-server-and-auth.md
grep -q '0006' docs/adr/0004-mcp-server-and-auth.md

# 6) 기획안에 5단계 절이 생겼고, 상태 칸과 미정 사항은 그대로다
grep -q '### 5단계에서 정한 것' docs/product-plan.md
grep -q 'Railway Postgres PITR의 플랜 조건' docs/product-plan.md

# 7) user-intervention의 옛 문장이 갱신됐다
! grep -q '필요한 스코프의 정확한 목록은 아직 확정하지 않았다' docs/user-intervention.md
grep -q 'chat:write' docs/user-intervention.md
grep -q '/slack/interactions' docs/user-intervention.md
grep -q 'SLACK_SIGNING_SECRET' docs/user-intervention.md

# 8) 코드와 설정은 한 줄도 바뀌지 않았다
test -z "$(git status --porcelain -- src/ test/ prisma/ package.json pnpm-lock.yaml vitest.config.ts .env.example README.md Dockerfile railway.json)"

# 9) 도메인 불변
git diff --quiet HEAD -- src/domain/

# 10) 기존 상태가 깨지지 않았다
pnpm typecheck
pnpm lint
pnpm test
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 통과하면 `tasks/1-slack-and-deploy/index.json`의 phase 0 status를 `"completed"`로 바꿔라.

세 번 고쳐도 통과하지 못하면 status를 `"error"`로 바꾸고, 같은 phase 객체의 `"error_message"`에 어떤 명령이 어떤 출력으로 실패했는지 실제 출력을 근거로 적어라.

AC 통과와 index.json 갱신을 마쳤으면 커밋하라. 메시지는 `docs(slack-and-deploy): record the stage 5 design`으로 한다.

## 하지 말아야 할 것

- **`README.md`를 고치지 마라.** 계층 그림, 환경 변수, 배포 절차, "지금 되는 것과 안 되는 것"은 전부 그 내용이 참이 되는 phase에서 고친다. 이 phase가 끝난 시점에 Slack 코드는 없다.
- **`.env.example`을 고치지 마라.** `SLACK_BOT_TOKEN`은 phase 3이, `SLACK_SIGNING_SECRET`은 phase 5가 넣는다.
- **`docs/user-intervention.md`의 1번, 4번, 5번을 고치지 마라.** 2번과 3번만 이번 범위다.
- **코드를 고치지 마라.** `src/`, `test/`, `prisma/`, `package.json`, `vitest.config.ts` 전부 이번 phase 밖이다. 의존성을 설치하지 마라.
- **기획안 9장 표의 5단계 상태 칸을 채우지 마라.** 아직 아무것도 되지 않는다.
- **10장의 PITR 미정 항목을 지우지 마라.** 아직 모른다.
- **ADR 0001, 0002, 0003을 고치지 마라.** 이번 단계가 뒤집는 결정이 없다.
- **`tasks/` 안의 다른 파일을 고치지 마라.** `tasks/1-slack-and-deploy/index.json`의 phase 0 status만 갱신한다.
