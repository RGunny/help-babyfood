# ADR 0004: MCP는 공식 SDK v2로 띄우고, 인증은 구성원별 Bearer 토큰으로 한다

- 상태: 채택
- 결정일: 2026-09-22

## 맥락

3단계는 기획안 7장의 도구를 Claude Code에서 부를 수 있게 만든다. 전송은 Streamable HTTP이고, NestJS 단일 서버 안에 둔다(기획안 8장).

두 가지를 정해야 한다. 하나는 MCP 프로토콜 구현을 어디서 가져올지이고, 다른 하나는 인증 방식이다. 인증은 기획안 10장이 미정으로 남겨 둔 항목이다.

애플리케이션 계층은 NestJS를 모른다. 서비스는 생성자에 포트를 받는 평범한 클래스이고 모듈이 `useFactory`로 조립한다(`src/application/application.module.ts`). 도메인 코어는 1, 2단계에서 한 줄도 바뀌지 않았다. MCP 계층도 같은 조건에서 붙어야 한다.

## 결정

### MCP 구현

공식 TypeScript SDK v2를 직접 쓴다. `@modelcontextprotocol/server`의 `createMcpHandler`로 핸들러를 만들고, `@modelcontextprotocol/node`의 `toNodeHandler`로 감싸 Nest 컨트롤러(`src/mcp/mcp.controller.ts`)에 `/mcp` 한 경로로 마운트한다.

세션은 두지 않는다. `createMcpHandler`의 팩토리가 HTTP 요청마다 새 `McpServer`를 만들고 인스턴스에 상태를 남기지 않으므로, 일관성 경계는 2단계에서 정한 가정 행 잠금 하나로 남는다.

### 인증

구성원별 Bearer 토큰을 쓰되, 게이트는 OAuth 리소스 서버의 모양을 그대로 쓴다. `@modelcontextprotocol/express`의 `requireBearerAuth` 미들웨어를 `/mcp` 앞에 두고, 우리가 쓰는 것은 `OAuthTokenVerifier.verifyAccessToken` 하나다(`src/mcp/auth/member-token.verifier.ts`).

토큰은 `member_token` 테이블에 SHA-256 해시로만 저장하고, 평문은 발급 스크립트가 한 번 출력한 뒤 남기지 않는다. 만료는 필수이고 기본 180일이다.

가정과 구성원은 토큰에서만 나온다. 도구는 인자로 받지 않는다.

## 근거

### 왜 공식 SDK인가

| 후보 | 버전과 유지 상태 | 택하거나 택하지 않은 이유 |
|---|---|---|
| 공식 SDK v2 | `@modelcontextprotocol/server` 2.0.0, 2026-07-27 공개 | 스펙과 같은 속도로 갱신된다. 인증 게이트를 그대로 제공한다. 도구 계층이 평범한 함수로 남는다 |
| `@rekog/mcp-nest` | 2.0.7, 2026-09-21 커밋 | 같은 SDK 위의 한 겹이다. peer가 `@modelcontextprotocol/* ^2.0.0-beta.5`로 beta 범위를 가리켜 해석 결과가 저장소 밖에서 정해진다. `@Tool()` 데코레이터 자동 탐색은 이 저장소가 지켜 온 "서비스에 데코레이터를 달지 않는다"와 반대 방향이다 |
| `@nestjs-mcp/server` | 1.0.1, 2026-07-31 공개 | peer가 `@nestjs/core ^11.1.18`이라 NestJS 12를 선언하지 않는다. 의존하는 SDK도 v1이다 |

v1(`@modelcontextprotocol/sdk`)이 아니라 v2를 쓴다. 저장소가 이렇게 적는다.

> **v2 is the stable release line**, released alongside the 2026-07-28 spec. v1.x continues to receive bug fixes and security updates for at least 6 months after v2's release.

출처: [typescript-sdk README](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md).

도구는 24개이고 전부 서비스 한 번 호출로 끝나는 어댑터다. 자동 탐색으로 줄어드는 코드가 없고, 늘어나는 것은 의존성과 간접 계층이다.

### 왜 OAuth 2.1이 아닌가

MCP 스펙은 인증을 필수로 두지 않는다.

> Authorization is **OPTIONAL** for MCP implementations. When supported:
>
> * Implementations using an HTTP-based transport **SHOULD** conform to this specification.

출처: [MCP Authorization, 리비전 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

OAuth 2.1을 따르려면 인증 서버가 필요하다. SDK는 인증 서버 헬퍼를 동결했다.

> The Authorization Server helpers (`mcpAuthRouter`, `ProxyOAuthServerProvider`, …) are frozen in `@modelcontextprotocol/server-legacy/auth`. Use a dedicated identity provider for new servers; this page only covers the resource-server half.

출처: [docs/serving/authorization.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/authorization.md). 사용자는 부모 두 명이고 클라이언트는 Claude Code 하나다. IdP를 세우고 유지하는 비용이 얻는 것보다 크다.

Claude Code는 정적 `Authorization` 헤더를 받는다.

> ```bash
> claude mcp add --transport http secure-api https://api.example.com/mcp \
>   --header "Authorization: Bearer your-token"
> ```

같은 문서가 덧붙이는 주의도 이 결정에 맞는다.

> If you configured `headers.Authorization` for the server and the server rejects that header, Claude Code reports the connection as failed instead of falling back to OAuth.

출처: [Claude Code MCP 문서](https://code.claude.com/docs/en/mcp). 우리는 OAuth를 지원하지 않으므로, 토큰이 틀렸을 때 OAuth로 넘어가지 않고 실패로 보고하는 동작이 맞다.

### 전환 경로

이 결정이 싸게 뒤집히도록 게이트를 OAuth 리소스 서버 모양으로 둔다. OAuth로 옮길 때 바뀌는 것은 `verifyAccessToken`의 속(해시 조회에서 IdP의 JWT 검증으로)과 `mcpAuthMetadataRouter` 추가다. 도구 계층과 `Actor` 유도는 바뀌지 않는다.

전환의 방아쇠는 모바일 앱 커넥터다. 커넥터는 사용자마다 정적 헤더를 넣어 둘 수 없으므로 OAuth 흐름이 필요해진다.

지금은 `mcpAuthMetadataRouter`를 두지 않는다. 메타데이터를 공개하면 인증 서버가 있다고 광고하는 셈인데 없다. 401은 `WWW-Authenticate: Bearer`만 돌려준다.

## 층별 결합

MCP 계층(`src/mcp`)은 애플리케이션 서비스와 `HouseholdReader` 포트만 본다. Prisma 클라이언트를 직접 잡는 곳은 토큰 검증기 하나이고, 그것은 토큰 조회가 유스케이스가 아니기 때문이다. 도구가 저장소에 닿을 수 있으면 재고 규칙의 두 번째 사본이 자라기 시작한다.

애플리케이션 계층은 MCP를 모른다. 이번 단계에서 애플리케이션에 더한 것은 `MealPlanImportService` 하나이고, 그것도 MCP가 아니라 기획안 4.8절의 유스케이스다. 스케줄러(4단계)와 Slack 버튼(5단계)이 같은 서비스를 부르게 되며, 그때 MCP 계층은 바뀌지 않는다.

도메인 코어는 이번에도 바뀌지 않았다. 이관된 식단을 정합화에서 빼는 규칙(`reconcileMeals`의 `!meal.migrated`)은 1단계에 이미 있었다.

도구를 늘리는 방법은 `src/mcp/tools/`에 영역별 파일을 더하고 `buildServer`에서 부르는 것이다. 각 파일은 `registerXxxTools(server, deps, caller)` 하나를 내보낸다. 새 도구가 호출자를 인자로 받을 길은 없다. 호출자는 요청마다 만들어지는 서버에 닫혀 있다.

## 대가와 남는 위험

- 토큰 평문이 부모의 MCP 설정 파일과 셸 히스토리에 남는다. 완화는 구성원별 분리, 해시 저장, 만료, 폐기다. 유출을 알아차렸을 때 할 수 있는 일은 `--revoke`뿐이고, 유출을 알아차리는 수단은 `--list`의 마지막 사용 시각뿐이다.
- 토큰 발급은 DB에 닿는 경로에만 둔다(`src/scripts/mint-member-token.ts`). 도구로 토큰을 만들 수 있으면 토큰 하나의 유출이 영구적인 발판이 된다.
- `AuthInfo.expiresAt`을 비우면 SDK가 정상 토큰까지 401로 돌려준다. `member_token`에 `CHECK (expires_at > created_at)`을 걸어 만료 없는 토큰이 생기지 않게 했다.
- `@modelcontextprotocol/node`가 `hono`를 peer로 요구해 쓰지 않는 HTTP 프레임워크가 의존성에 들어온다. 어댑터가 `@hono/node-server`를 쓰기 때문이다.
- 응답이 커질 수 있다. `get_meal_plan`은 날짜 범위만큼, `get_stock_status`는 배치 수만큼 커진다. 부모 두 명의 냉동고 규모에서는 문제가 아니지만, 페이지네이션은 두지 않았다는 점을 기록해 둔다.
