# Phase 5: slack-inbound

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain
```

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고 `tasks/1-slack-and-deploy/index.json`의 phase 5 status를 `"error"`로, `error_message`에 `dirty working tree`로 적고 멈춰라.

먼저 아래를 읽어라.

- `tasks/1-slack-and-deploy/docs-diff.md`
- `docs/adr/0006-slack-delivery-and-deployment.md` (특히 서명 검증, 멱등키, ack 순서)
- `docs/product-plan.md` 5장(버튼 목록)과 8장(HTTP 수신을 택한 이유)
- `src/slack/actions.ts` (phase 3이 만든 인코딩. **이 phase는 그것을 되읽는다**)
- `src/mcp/mcp.module.ts` (**미들웨어를 경로에 거는 본보기.** `configure(consumer)`와 `forRoutes`)
- `src/mcp/mcp.controller.ts` (`@All`, `@Req`, `@Res`를 쓰는 방식)
- `src/mcp/auth/member-token.verifier.ts` (**`void`로 부수 작업을 띄우는 선례가 41행에 있다.** 그 함수가 내부에서 전부 삼키기 때문에 안전하다는 점을 확인하라)
- `src/mcp/tool-result.ts` (`DomainError`와 `ApplicationError`를 호출자가 읽을 문장으로 바꾸는 방식)
- `src/application/no-feed.service.ts`, `src/application/reaction.service.ts`, `src/application/stock.service.ts` (**버튼이 부르는 세 유스케이스.** 커맨드의 필드를 정확히 확인하라)
- `src/infrastructure/prisma/household-writer.ts` (`lockHousehold`가 트랜잭션 첫 문장에서 가정 행을 `FOR UPDATE`로 잡는 것과 `LOCK_TIMEOUT`)
- `src/main.ts`
- `test/integration/mcp-auth.int-spec.ts` (통합 테스트에서 raw HTTP를 보내는 방식과 `vi.waitFor`의 쓰임)

## 작업 내용

Slack 버튼 응답을 받는 어댑터를 만든다.

```
src/slack/inbound/
  signature.ts                순수 함수. 서명 검증
  signature.middleware.ts     경로 앞에 서는 미들웨어
  slack-member.resolver.ts    Slack 사용자 id -> 가정과 구성원
  action-dispatch.ts          디코딩한 액션 -> 유스케이스 호출
  interactions.controller.ts  POST /slack/interactions
  slack-interaction.module.ts
```

### 1. `src/main.ts`

`NestFactory.create(AppModule, { rawBody: true })`로 바꾼다. 서명의 기준 문자열은 파싱된 본문이 아니라 원본 바이트다. NestJS 12는 이 옵션이 있을 때 json과 urlencoded 파서 모두에 `req.rawBody`를 남긴다.

`enableShutdownHooks()`는 **이번 phase가 아니다.** phase 6에서 더한다.

### 2. `src/config/env.ts`

`SLACK_SIGNING_SECRET`을 필수 항목으로 더한다. `src/config/env.spec.ts`와 `satisfies AppEnv`를 쓰는 테스트 파일들, `test/integration/setup/fixtures.ts`를 함께 고친다. phase 3이 `SLACK_BOT_TOKEN`으로 같은 일을 했으니 그 변경을 본보기로 삼아라.

`.env.example`에 항목과 설명을 더한다. `docs/user-intervention.md` 4번의 문장에 `SLACK_SIGNING_SECRET`도 함께 필요하다는 것을 더한다.

### 3. `src/slack/inbound/signature.ts`

순수 함수다. 네트워크도 Nest도 모른다.

```ts
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifySlackSignature(input: {
  readonly signingSecret: string;
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
  readonly rawBody: Buffer;
  readonly now: Date;
}): boolean;
```

절차는 공식 문서(https://docs.slack.dev/authentication/verifying-requests-from-slack)가 정한 그대로다.

1. `X-Slack-Request-Timestamp`가 `now`에서 300초를 넘게 떨어져 있으면 거짓이다. 과거와 미래 양쪽 다 본다.
2. 기준 문자열은 `v0:{timestamp}:{raw body}`다. 콜론으로 잇는다.
3. 서명 비밀을 키로 HMAC-SHA256을 계산하고 hex로 만든 뒤 `v0=`를 앞에 붙인다.
4. `X-Slack-Signature`와 비교한다. **`crypto.timingSafeEqual`을 쓴다.** 문자열 `===`로 비교하지 마라. 길이가 다르면 `timingSafeEqual`이 던지므로 먼저 길이를 본다.

헤더 이름은 대소문자를 구분하지 않는다. Node의 `req.headers`는 소문자로 준다.

### 4. `src/slack/inbound/signature.middleware.ts`

`/slack/interactions` 앞에 선다. 검증에 실패하면 **401로 끝내고 본문을 보지 않는다.** `ClockPort`로 현재 시각을 받는다. `new Date()`를 직접 부르지 마라.

### 5. `src/slack/inbound/interactions.controller.ts`

**응답 순서가 이 파일에서 가장 중요하다.**

```
서명 검증(미들웨어) → 200 응답 → 구성원 해석 → 유스케이스 → response_url로 결과 통보
```

200을 **DB에 닿기 전에** 내보낸다. 이유는 이렇다. 버튼이 부르는 세 유스케이스는 전부 `HouseholdWriter.write`를 타고, 그 트랜잭션의 첫 문장이 가정 행을 `FOR UPDATE`로 잡는 것이다. 그 행은 매분 도는 정합화 쓸기가 이미 잡고 있을 수 있다. `src/infrastructure/prisma/household-writer.ts`의 `LOCK_TIMEOUT`과 트랜잭션 대기 한계는 Slack이 요구하는 3초보다 크다. 즉 처리를 먼저 하면 겹친 순간의 탭은 3초를 넘기고, Slack은 부모에게 오류를 보인 뒤 재전송한다.

구성원 해석도 200 뒤로 내려야 한다. 인덱스 조회라 잠금은 없지만 커넥션 풀 획득 자체가 쓸기에 막힐 수 있다. **가드나 미들웨어에 구성원 해석을 넣지 마라.** 그것들은 컨트롤러보다 먼저 돌기 때문에 이 순서가 깨진다.

컨트롤러가 하는 일.

1. `application/x-www-form-urlencoded` 본문의 `payload` 필드를 JSON으로 푼다.
2. `type`이 `block_actions`가 아니면 200으로 끝낸다.
3. 즉시 200을 보낸다(빈 본문).
4. 나머지를 `void`로 띄운다. 띄우는 함수는 **자기 안에서 모든 예외를 삼켜야 한다.** rejected promise가 밖으로 나가면 처리되지 않은 거부가 된다. `src/mcp/auth/member-token.verifier.ts`의 `touch`가 같은 이유로 내부에서 삼킨다.

지연 처리가 하는 일.

1. `user.id`로 구성원을 찾는다. 없으면 `response_url`에 "등록되지 않은 Slack 사용자입니다"를 ephemeral로 보내고 **아무것도 바꾸지 않고** 끝낸다.
2. `actions[0]`의 `action_id`와 `value`를 `decodeAction`으로 푼다. `null`이면 ephemeral로 알리고 끝낸다.
3. 유스케이스를 부른다. 멱등키는 `slack:{message.ts}:{action_id}:{value}`다.
4. 결과나 오류를 `response_url`에 ephemeral로 보낸다. `DomainError`와 `ApplicationError`는 부모가 읽을 문장으로 바꾼다. 그 밖의 예외는 일반적인 실패 문구로 바꾸고 서버 로그에 남긴다. 내부 오류 메시지를 그대로 보내지 마라.

`response_url`은 받은 지 30분 안에 5회까지 쓸 수 있다. `{"response_type": "ephemeral", "text": "..."}`를 JSON으로 POST한다.

**이 순서의 대가**: 200을 보낸 뒤 처리 전에 프로세스가 죽으면 그 탭은 사라지고 부모는 아무 응답도 받지 못한다. 그때 부모가 다시 탭하면 멱등키가 같아 한 번만 기록된다. ADR 0006에 적힌 대가이고, 코드 주석에도 적어라.

### 6. `src/slack/inbound/slack-member.resolver.ts`

`member.slack_user_id`로 가정과 구성원을 찾아 `Caller`와 같은 모양(`{ householdId, actor }`)을 만든다. Prisma를 직접 잡는다. ADR 0004가 갱신한 규칙대로 구성원 식별자 조회는 유스케이스가 아니다.

`slack_user_id`는 스키마에 이미 있고 전역 유니크다. 없으면 `null`을 돌려준다.

### 7. `src/slack/inbound/action-dispatch.ts`

디코딩한 액션을 유스케이스로 보낸다. **재고 규칙을 여기에 쓰지 마라.** 세 갈래뿐이다.

| 액션 | 부르는 것 |
|---|---|
| `no_feed` | `NoFeedService.register({ householdId, actor, idempotencyKey, date, slot, thawed, reason: null })` |
| `reaction` | `ReactionService.record({ householdId, actor, idempotencyKey, date, slot, ingredientName, result })` |
| `discard` | `StockService.discardBatch({ householdId, actor, idempotencyKey, batchId, reason: 'expired' })` |

`ReactionService.record`는 재료 **이름**을 받는데 버튼 value에는 id가 들어 있다. `HouseholdReader`로 id를 이름으로 바꾼다. `src/mcp/name-directory.ts`가 같은 일을 하고 있으니 그 방식을 따른다. 이름을 못 찾으면 ephemeral로 알리고 끝낸다.

폐기 버튼의 사유가 `'expired'`인 이유는 브리프의 폐기 완료 버튼이 임계일 초과 배치에 붙기 때문이다(기획안 4.5절).

### 8. `src/slack/inbound/slack-interaction.module.ts`

컨트롤러와 미들웨어를 가진다. `ApplicationModule`과 `PersistenceModule`을 import한다. `AppModule`의 `imports`에 더한다. **`SlackDeliveryModule`을 import하지 마라.** 수신은 발송을 쓰지 않는다.

### 9. 테스트

단위 테스트.

- `src/slack/inbound/signature.spec.ts`: 올바른 서명이 통과한다. 본문이 한 글자 바뀌면 거부한다. 서명 비밀이 다르면 거부한다. 타임스탬프가 5분보다 과거면 거부한다. 미래여도 거부한다. `v0=` 접두가 없으면 거부한다. 헤더가 없으면 거부한다. 길이가 다른 서명에도 던지지 않고 거짓을 돌려준다.
- `src/slack/inbound/action-dispatch.spec.ts`: 세 액션이 각각 맞는 유스케이스를 부른다. 멱등키가 `slack:{ts}:{action_id}:{value}` 모양이다. **유스케이스가 던져도 rejected promise가 밖으로 나가지 않는다.**

통합 테스트 `test/integration/slack-interactions.int-spec.ts`.

처리가 응답보다 **뒤에** 끝나므로 기다릴 관문이 필요하다. 가짜 `response_url` 엔드포인트를 `node:http`로 띄우고, **그 엔드포인트가 ephemeral을 받은 것을 관문으로 삼아라.** 그 뒤에 원장과 기록을 확인한다. 일어나지 않을 일을 `vi.waitFor`로 기다리지 마라. 그것은 sleep이고 CI에서 흔들린다.

- 서명된 요청으로 미급여 버튼을 누르면 미급여 기록과 원장 변화가 남는다.
- 반응 버튼을 누르면 급여 반응이 기록된다.
- 폐기 버튼을 누르면 배치가 폐기된다.
- **같은 메시지의 서로 다른 배치 두 개를 폐기하면 둘 다 원장에 남는다.** 멱등키에 `value`가 들어가는 이유가 이것이다. 이 테스트가 없으면 두 번째 폐기가 조용히 막힌다.
- 같은 버튼을 두 번 탭하면 한 번만 기록된다. 두 번째 응답도 ephemeral로 온다.
- "이상 없음" 뒤 "반응 있음"을 누르면 나중 것이 남는다.
- 서명이 틀리면 401이고 아무것도 바뀌지 않는다. 가짜 `response_url`에도 아무것도 오지 않는다.
- 타임스탬프가 5분보다 오래된 요청도 401이다.
- 모르는 Slack 사용자는 200이고 ephemeral로 안내가 오지만 원장은 그대로다. **ephemeral 도착을 관문으로 쓰고 그 뒤에 원장을 확인하라.**
- 응답이 처리보다 먼저 온다. 200이 온 시점에 아직 기록이 없을 수 있고, 그것이 정상이다.

## Acceptance Criteria

```bash
# 1) 파일이 생겼다
test -f src/slack/inbound/signature.ts
test -f src/slack/inbound/signature.middleware.ts
test -f src/slack/inbound/slack-member.resolver.ts
test -f src/slack/inbound/action-dispatch.ts
test -f src/slack/inbound/interactions.controller.ts
test -f src/slack/inbound/slack-interaction.module.ts
test -f src/slack/inbound/signature.spec.ts
test -f src/slack/inbound/action-dispatch.spec.ts
test -f test/integration/slack-interactions.int-spec.ts

# 2) 서명 검증이 상수 시간 비교와 원본 본문을 쓴다
grep -q 'timingSafeEqual' src/slack/inbound/signature.ts
grep -q 'rawBody' src/main.ts
grep -q 'v0:' src/slack/inbound/signature.ts

# 3) 멱등키에 value가 들어간다
grep -q 'slack:' src/slack/inbound/action-dispatch.ts

# 4) 수신이 재고 규칙을 다시 쓰지 않는다
! grep -rn 'reconcileMeals\|allocateOldestFirst\|summarizeStock' src/slack/

# 5) 수신 모듈이 발송 모듈을 쓰지 않는다
! grep -q 'slack-delivery.module' src/slack/inbound/slack-interaction.module.ts

# 6) 환경 변수를 더했다
grep -q 'SLACK_SIGNING_SECRET' src/config/env.ts
grep -q 'SLACK_SIGNING_SECRET' .env.example
grep -q 'SLACK_SIGNING_SECRET' docs/user-intervention.md

# 7) 종료 훅은 아직 없다 (phase 6)
! grep -q 'enableShutdownHooks' src/main.ts

# 8) 도메인 불변
git diff --quiet HEAD -- src/domain/

# 9) 앞 계층의 규칙이 그대로다
git diff --quiet HEAD -- src/application/brief-dispatch.service.ts src/application/brief-dispatch.policy.ts

# 10) 타입, 린트, 테스트
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
pnpm test:cov
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 통과하면 `tasks/1-slack-and-deploy/index.json`의 phase 5 status를 `"completed"`로 바꿔라.

세 번 고쳐도 통과하지 못하면 status를 `"error"`로 바꾸고, `"error_message"`에 어떤 명령이 어떤 출력으로 실패했는지 실제 출력을 근거로 적어라.

AC 통과와 index.json 갱신을 마쳤으면 커밋하라. 메시지는 `feat(slack-and-deploy): phase 5 slack inbound`로 한다.

## 하지 말아야 할 것

- **DB에 닿은 뒤에 200을 보내지 마라.** 매분 쓸기가 가정 행을 잡고 있으면 3초를 넘긴다.
- **구성원 해석을 가드나 미들웨어에 두지 마라.** 컨트롤러보다 먼저 돌아 ack 순서가 깨진다.
- **`void`로 띄운 함수에서 예외가 새게 두지 마라.** 함수 안에서 전부 삼킨다.
- **처리 실패를 비200으로 답하지 마라.** Slack이 재전송하고 부모는 오류를 본다. 서명 검증 실패만 401이다.
- **내부 오류 메시지를 그대로 `response_url`로 보내지 마라.**
- **문자열 `===`로 서명을 비교하지 마라.**
- **파싱된 본문으로 서명을 계산하지 마라.** 원본 바이트여야 한다.
- **일어나지 않을 일을 `vi.waitFor`로 기다리지 마라.** ephemeral 도착을 관문으로 쓴다.
- **재고 규칙이나 날짜 계산을 `src/slack`에 쓰지 마라.** 세 유스케이스를 부르는 것이 전부다.
- **`enableShutdownHooks`를 더하지 마라.** phase 6이다.
- **`src/domain`을 고치지 마라.**
- **`src/slack/actions.ts`의 인코딩을 바꾸지 마라.** phase 3이 정했고 발송이 그것으로 버튼을 만든다.
- **`tasks/` 안의 다른 파일을 고치지 마라.** `tasks/1-slack-and-deploy/index.json`의 phase 5 status만 갱신한다.
