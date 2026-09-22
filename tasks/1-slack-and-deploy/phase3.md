# Phase 3: slack-outbound

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain
```

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고 `tasks/1-slack-and-deploy/index.json`의 phase 3 status를 `"error"`로, `error_message`에 `dirty working tree`로 적고 멈춰라.

먼저 아래를 읽어라.

- `tasks/1-slack-and-deploy/docs-diff.md`
- `docs/adr/0006-slack-delivery-and-deployment.md` (특히 SDK를 쓰지 않는 결정, `ok: false` 함정, 버튼 멱등키, 층별 결합)
- `docs/product-plan.md` 5장(브리프 구성과 버튼 목록), 4.6절(후속 메시지)
- `src/application/ports/brief-delivery.port.ts` (**이 phase가 구현하는 인터페이스다**)
- `src/application/daily-brief.ts` (`DailyBrief`의 모든 필드. 무엇을 렌더링할지가 거기 있다)
- `src/application/brief-dispatch.service.ts` (누가 이 어댑터를 부르는지)
- `src/mcp/mcp.module.ts`와 `src/mcp/server.factory.ts` (**어댑터 모듈과 `useFactory` 조립 본보기**)
- `src/mcp/tools/alert.tools.ts`의 `get_daily_brief` (브리프의 각 필드를 부모가 읽는 이름으로 바꾸는 방식)
- `src/config/env.ts`와 `src/config/env.spec.ts` (환경 변수를 더하는 방식)
- `src/infrastructure/prisma/persistence.module.ts` (`APP_ENV`, `PrismaService`를 어디서 받는지)
- `vitest.config.ts` (계층별 커버리지 임계값이 어떻게 적혀 있는지)
- `test/integration/setup/mcp-server.ts` (통합 테스트에서 Nest를 띄우고 `APP_ENV`만 갈아 끼우는 방식)

## 작업 내용

Slack으로 내보내는 어댑터를 만든다. 디렉터리는 `src/slack`이다. `src/infrastructure`가 아니다. 버튼 값 인코딩을 발송과 수신이 함께 쓰기 때문이고, 그 근거가 ADR 0006에 있다.

```
src/slack/
  actions.ts                      공유. 버튼 action id와 value 인코딩
  outbound/
    render-brief.ts
    render-reaction-prompt.ts
    slack-brief-delivery.ts
    slack-delivery.module.ts
```

### 1. 의존성

`@slack/types`를 **devDependency로만** 더한다.

```bash
pnpm add -D @slack/types@^3.1.0
```

`@slack/web-api`를 더하지 마라. ADR 0006이 쓰지 않기로 했다. 설치 뒤 `pnpm-lock.yaml`이 바뀐 것을 커밋에 포함한다.

### 2. `src/slack/actions.ts`

버튼의 정체를 문자열로 만들고 되읽는 곳이다. **발송과 수신이 이 파일 하나만 공유한다.** 인코딩이 두 곳에 있으면 한쪽을 고칠 때 다른 쪽이 조용히 어긋난다.

세 가지 버튼이 있다(기획안 5장).

| action id | 뜻 | value에 담기는 것 |
|---|---|---|
| `no_feed` | 끼니별 미급여 | 날짜, 끼니, 해동 여부 |
| `reaction` | 반응 없음 / 반응 있음 | 날짜, 끼니, 재료 id, 결과 |
| `discard` | 폐기 완료 | 배치 id |

`encodeX(...)`와 `decodeAction(actionId, value)`를 내보낸다. `decodeAction`은 판별 가능한 합 타입을 돌려주고, 모르는 `action_id`나 형식이 깨진 `value`에는 `null`을 돌려준다. 던지지 마라. 수신 쪽이 그것을 부모에게 보일 문장으로 바꿔야 한다.

구분자는 값에 나타나지 않는 글자를 골라라. 날짜는 `2026-09-22`, 끼니는 `morning`/`afternoon`, 재료와 배치 id는 UUID다. 고른 이유를 주석에 적어라.

Slack 버튼의 `value`는 최대 2000자다. 여기 담는 값은 그보다 훨씬 짧다.

### 3. `src/slack/outbound/render-brief.ts`

`DailyBrief`를 `{ text, blocks }`로 바꾸는 **순수 함수**다. 네트워크도 Prisma도 모른다.

기획안 5장이 정한 브리프 구성을 전부 싣는다. 날짜와 일차, 끼니별 오늘 식단, 새 재료 관찰 안내, 재고현황(합계와 가용·폐기 대기 내역, 소진 예상일), 부족 예측, 임계개수 도달 재료, 임계일 알람, 확인 필요 항목이다. `DailyBrief`의 필드가 그대로 대응한다.

버튼은 두 가지를 단다. 끼니마다 "미급여(해동 전)"과 "미급여(해동 후)", 폐기 대기 배치마다 "폐기 완료"다.

**Block Kit 한계를 넘으면 Slack이 메시지를 거부한다.** 공식 문서에서 확인한 값이다.

| 한계 | 값 | 출처 |
|---|---|---|
| 메시지당 블록 | 50개 | docs.slack.dev/reference/block-kit/blocks |
| section의 `text` | 3000자 | docs.slack.dev/reference/block-kit/blocks/section-block |
| actions 블록당 요소 | 25개 | docs.slack.dev/reference/block-kit/blocks/actions-block |

재료가 많아지면 재고현황이 먼저 한계에 닿는다. 재고 표는 section 하나에 줄로 묶고, 그래도 넘치면 잘라 내고 몇 줄이 생략됐는지 적어라. 폐기 완료 버튼이 25개를 넘으면 오래된 배치부터 25개만 싣고 나머지는 텍스트로 알려라. **한계를 넘기는 대신 자르는 쪽을 택한다.** 넘기면 브리프 전체가 가지 않는다.

`text`는 알림에 뜨는 한 줄 요약이다. 날짜와 일차 정도면 된다.

### 4. `src/slack/outbound/render-reaction-prompt.ts`

`ReactionPrompt`를 같은 모양으로 바꾼다. 재료마다 "이상 없음"과 "반응 있음" 버튼 둘을 단다. 4.6절이 말하는 "반응 기록 버튼이 달린 후속 메시지"다.

### 5. `src/slack/outbound/slack-brief-delivery.ts`

`BriefDeliveryPort`를 구현한다.

```ts
export const SLACK_API_BASE_URL = 'https://slack.com/api';

export class SlackBriefDelivery implements BriefDeliveryPort {
  constructor(
    private readonly prisma: PrismaTransaction,
    private readonly botToken: string,
    private readonly baseUrl: string = SLACK_API_BASE_URL,
  ) {}
}
```

`baseUrl`을 생성자 인자로 두는 이유는 통합 테스트가 가짜 서버를 가리키게 하기 위해서다. **환경 변수를 새로 만들지 마라.** 운영에서는 기본값을 쓴다.

하는 일은 셋이다.

1. 가정의 `slackChannelId`를 읽는다. Prisma를 직접 잡는다. ADR 0004가 갱신한 규칙대로 채널 식별자 조회는 유스케이스가 아니다.
2. 채널이 없으면 네트워크를 타지 않고 `{ kind: 'skipped', reason: 'not_linked' }`를 돌려준다.
3. 있으면 `POST {baseUrl}/chat.postMessage`에 `Authorization: Bearer {botToken}`과 `Content-Type: application/json; charset=utf-8`로 `{ channel, text, blocks }`를 보낸다.

**응답 판정이 이 파일에서 가장 중요하다.** Slack Web API는 실패도 HTTP 200에 `{"ok": false, "error": "channel_not_found"}` 본문으로 돌려준다. HTTP 상태만 보면 모든 발송이 성공으로 기록된다. 반드시 본문의 `ok`를 보고, false면 `error` 값을 담아 던져라. HTTP 상태가 2xx가 아닌 경우도 던진다. 성공이면 응답의 `ts`를 `reference`로 돌려준다.

`fetch`를 쓴다. Node 24 이상이 전역으로 제공한다(`docs/adr/0001-runtime-and-tooling.md`의 `engines.node`).

### 6. `src/slack/outbound/slack-delivery.module.ts`

`BRIEF_DELIVERY` 토큰을 `SlackBriefDelivery`에 바인딩하고 내보낸다. `PersistenceModule`만 import한다. **`ApplicationModule`을 import하지 마라.** 순환이 된다.

### 7. `src/config/env.ts`

`SLACK_BOT_TOKEN`을 필수 항목으로 더한다. `DATABASE_URL`과 같은 `required` 취급이다. `src/config/env.spec.ts`에 없으면 거부하는 테스트를 더하고, 기존 테스트들이 쓰는 최소 환경에도 이 값을 넣어 통과하게 고쳐라.

`satisfies AppEnv`로 환경 객체를 만드는 테스트 파일 셋도 함께 고친다.

- `test/integration/wiring.int-spec.ts`
- `test/integration/setup/mcp-server.ts`
- `test/integration/scheduler.int-spec.ts`

`test/integration/setup/fixtures.ts`의 `buildServices`도 `PrismaService`에 넘기는 환경 객체를 만든다. 같이 고친다.

`SLACK_SIGNING_SECRET`은 **이번 phase가 아니다.** phase 5에서 그것을 쓰는 코드와 함께 더한다.

### 8. `src/application/application.module.ts` 배선

`BriefDispatchService`를 `useFactory`로 조립해 provider에 넣고 `exports`에 더한다. 기존 서비스들과 같은 모양이다. 서비스에 데코레이터를 달지 마라.

```ts
{
  provide: BriefDispatchService,
  useFactory: (log, delivery, brief, clock) => new BriefDispatchService(log, delivery, brief, clock),
  inject: [BRIEF_DELIVERY_LOG, BRIEF_DELIVERY, DailyBriefService, CLOCK],
}
```

`ApplicationModule`의 `imports`에 `SlackDeliveryModule`을 더한다. `PersistenceModule`을 import하는 것과 같은 모양이다.

### 9. `vitest.config.ts`

임계값에 `src/slack/**`를 더한다. 값은 `src/mcp/**`, `src/scheduler/**`와 같은 lines 90, branches 75, functions 90, statements 90이다. 어댑터라 분기가 적다는 같은 이유다. 주석으로 그 이유를 적어라.

### 10. `.env.example`과 `docs/user-intervention.md`

`.env.example`에 `SLACK_BOT_TOKEN` 항목과 설명을 더한다. 다른 항목처럼 왜 필요한지와 없으면 어떻게 되는지를 적는다.

`docs/user-intervention.md`의 4번 항목에 한 줄을 더한다. `SLACK_BOT_TOKEN`이 필수가 되었으므로 `pnpm member-token`과 `pnpm slack-link`도 그 값이 환경에 있어야 돈다. 두 스크립트가 `readEnv()`를 타기 때문이다. 다른 항목은 건드리지 마라.

### 11. 테스트

단위 테스트.

- `src/slack/actions.spec.ts`: 세 가지 버튼의 value가 인코딩과 디코딩을 왕복한다. 모르는 `action_id`는 `null`이다. 형식이 깨진 value도 `null`이다. 던지지 않는다.
- `src/slack/outbound/render-brief.spec.ts`: 블록이 50개를 넘지 않는다. 어떤 section의 텍스트도 3000자를 넘지 않는다. 어떤 actions 블록도 요소 25개를 넘지 않는다. **재료를 100개 넣어도 그렇다.** 폐기 대기 배치마다 폐기 버튼이 하나다. 버튼 value가 `decodeAction`으로 되읽힌다. 재고가 비어 있어도 렌더링된다. 새 재료가 있으면 그 문구가 들어간다.
- `src/slack/outbound/render-reaction-prompt.spec.ts`: 재료마다 버튼이 둘이다. value가 되읽힌다.

통합 테스트 `test/integration/slack-delivery.int-spec.ts`. `node:http`로 가짜 Slack 서버를 띄우고 `baseUrl`을 그리로 돌린다.

- 채널이 연결된 가정은 `chat.postMessage`로 간다. 요청에 `Authorization: Bearer`와 채널 id가 실린다.
- 응답의 `ts`가 `reference`로 돌아온다.
- **`{"ok": false, "error": "channel_not_found"}`를 HTTP 200으로 돌려받으면 던진다.** 성공으로 기록되지 않는다.
- HTTP 500을 받아도 던진다.
- 채널이 연결되지 않은 가정은 `skipped`이고 가짜 서버에 요청이 하나도 오지 않는다.

## Acceptance Criteria

```bash
# 1) 파일이 생겼다
test -f src/slack/actions.ts
test -f src/slack/outbound/render-brief.ts
test -f src/slack/outbound/render-reaction-prompt.ts
test -f src/slack/outbound/slack-brief-delivery.ts
test -f src/slack/outbound/slack-delivery.module.ts
test -f src/slack/actions.spec.ts
test -f src/slack/outbound/render-brief.spec.ts
test -f test/integration/slack-delivery.int-spec.ts

# 2) SDK를 넣지 않았다
! grep -q '@slack/web-api' package.json
grep -q '@slack/types' package.json
python3 -c "import json,sys; d=json.load(open('package.json')); sys.exit(0 if '@slack/types' in d['devDependencies'] and '@slack/types' not in d.get('dependencies',{}) else 1)"

# 3) HTTP 200에 실린 실패를 판정하고, 그 경로가 테스트로 고정돼 있다
grep -q '"ok"\|\.ok' src/slack/outbound/slack-brief-delivery.ts
grep -q 'channel_not_found' test/integration/slack-delivery.int-spec.ts

# 4) 애플리케이션 계층은 여전히 Slack을 모른다
! grep -rni 'slack' src/application/brief-dispatch.service.ts src/application/ports/brief-delivery.port.ts
! grep -rn 'blocks' src/application/

# 5) 발송 모듈이 애플리케이션을 import하지 않는다
! grep -q 'application.module' src/slack/outbound/slack-delivery.module.ts

# 6) 커버리지 임계값에 새 디렉터리가 들어갔다
grep -q "src/slack" vitest.config.ts

# 7) 환경 변수는 봇 토큰만 더했다
grep -q 'SLACK_BOT_TOKEN' src/config/env.ts
grep -q 'SLACK_BOT_TOKEN' .env.example
! grep -q 'SLACK_SIGNING_SECRET' src/config/env.ts

# 8) 수신 쪽은 아직 없다
! test -d src/slack/inbound

# 9) 도메인 불변
git diff --quiet HEAD -- src/domain/

# 10) 타입, 린트, 테스트
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
pnpm test:cov
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 통과하면 `tasks/1-slack-and-deploy/index.json`의 phase 3 status를 `"completed"`로 바꿔라.

세 번 고쳐도 통과하지 못하면 status를 `"error"`로 바꾸고, `"error_message"`에 어떤 명령이 어떤 출력으로 실패했는지 실제 출력을 근거로 적어라.

AC 통과와 index.json 갱신을 마쳤으면 커밋하라. 메시지는 `feat(slack-and-deploy): phase 3 slack outbound`로 한다.

## 하지 말아야 할 것

- **`@slack/web-api`를 설치하지 마라.** ADR 0006이 쓰지 않기로 했고, 런타임 의존성 다섯 개가 따라 들어온다.
- **HTTP 상태만 보고 성공으로 판정하지 마라.** Slack은 실패도 200으로 준다.
- **Block Kit 한계를 넘기지 마라.** 넘기는 대신 자른다.
- **Slack API 주소를 환경 변수로 만들지 마라.** 생성자 기본값이면 된다.
- **`src/application`에 Slack 타입이나 Block Kit을 들이지 마라.**
- **`SLACK_SIGNING_SECRET`을 더하지 마라.** 읽는 곳이 없는 필수 변수가 두 phase 동안 남는다.
- **`src/slack/inbound`를 만들지 마라.** phase 5다.
- **`vitest.config.ts`의 기존 임계값을 낮추지 마라.** 새 항목만 더한다.
- **`src/scheduler`를 고치지 마라.** 잡은 phase 4다.
- **`src/domain`을 고치지 마라.**
- **`docs/user-intervention.md`의 4번 말고 다른 항목을 고치지 마라.**
- **`tasks/` 안의 다른 파일을 고치지 마라.** `tasks/1-slack-and-deploy/index.json`의 phase 3 status만 갱신한다.
