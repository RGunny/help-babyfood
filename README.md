# help-babyfood

이유식 큐브 재고와 식단을 관리하는 MCP 서버다. 냉동고에 어떤 큐브가 몇 개 남았는지 추적해 부족한 재료를 조리일 전에 알리고, 식단과 알러지 도입 이력을 한곳에 둔다.

부모가 직접 입력하는 것은 조리 후 입고 등록과 먹이지 못한 날의 보고 두 가지다. 나머지는 서버가 식단과 원장에서 계산한다.

## 문서

| 문서 | 내용 |
|---|---|
| `docs/product-plan.md` | 도메인 규칙, MCP 도구 목록, 아키텍처, 구현 단계 |
| `docs/adr/0001-runtime-and-tooling.md` | Node.js 24 이상, NestJS 12(ESM), Vitest, oxlint, pnpm 11 |
| `docs/adr/0002-orm-prisma.md` | Prisma 7, 일관성 경계와 적재 범위, 멱등키 |
| `docs/adr/0003-postgres-hosting-railway.md` | Railway Postgres와 PITR |
| `docs/adr/0004-mcp-server-and-auth.md` | MCP SDK v2, 구성원별 Bearer 토큰 |
| `docs/adr/0005-scheduler-and-daily-brief.md` | 매분 도는 정합화, 브리프 조립과 보류된 차감 |

규칙을 알고 싶으면 기획안 4장을 읽는다. 왜 그렇게 만들었는지는 ADR에 있다.

## 계층

```
Claude Code ──MCP (Streamable HTTP)──> src/mcp (구성원 토큰 인증) ──┐
                                                                    ├──> src/application ──> src/domain
스케줄러 (매분 정합화) ──────────────> src/scheduler ───────────────┘             │
                                                                                  └──> ports ──> src/infrastructure ──> PostgreSQL
```

- `src/domain` 은 프레임워크, DB, 시스템 시계를 모른다. 현재 시각도 인자로 받는다.
- `src/application` 은 NestJS를 모른다. 서비스는 생성자에 포트를 받는 평범한 클래스이고, 모듈이 `useFactory`로 조립한다.
- `src/mcp` 와 `src/scheduler` 는 어댑터다. 재고 규칙을 다시 쓰지 않고 애플리케이션을 부른다.
- Slack 버튼(5단계)도 같은 애플리케이션 서비스를 부른다.

## 개발 환경

Node.js 24 이상과 pnpm 11이 필요하다. 통합 테스트에는 Docker가 필요하다.

```bash
pnpm install
cp .env.example .env
docker compose up -d          # 로컬 PostgreSQL, 포트 55432
pnpm db:migrate
pnpm prisma:generate          # Prisma 7은 migrate가 generate를 자동 실행하지 않는다
pnpm start:dev
```

스키마를 바꿀 때는 `pnpm db:migrate --create-only`로 SQL을 먼저 만든다. Prisma 스키마 언어에 CHECK와 부분 인덱스가 없어서 그 둘은 생성된 SQL에 손으로 덧붙인다. 기존 마이그레이션의 "여기부터는 손으로 덧붙인 제약이다" 아래를 보면 된다.

## 테스트

| 명령 | 범위 | Docker |
|---|---|---|
| `pnpm test` | 단위 | 불필요 |
| `pnpm test:int` | 통합. Testcontainers가 PostgreSQL을 따로 띄운다 | 필요 |
| `pnpm test:cov` | 단위와 통합, 계층별 커버리지 임계값 검사 | 필요 |
| `pnpm test:e2e` | 부팅한 서버. `DATABASE_URL`과 살아 있는 PostgreSQL이 필요하다 | 필요 |
| `pnpm typecheck` / `pnpm lint` | 타입과 린트 | 불필요 |

`docker compose`로 띄운 컨테이너는 마이그레이션 개발용이다. 통합 테스트는 자기 컨테이너를 따로 띄우고 워커마다 DB를 복제한다.

## 서버에 붙기

토큰을 발급한다. 평문은 이때 한 번만 보인다.

```bash
pnpm member-token --household 재하네 --member 엄마 --label "엄마 노트북"
pnpm member-token --list      # 살아 있는 토큰과 마지막 사용 시각
pnpm member-token --revoke <토큰 id>
```

MCP 도구로는 토큰을 만들 수 없다. 토큰으로 인증한 세션이 토큰을 발급할 수 있으면 유출 하나가 영구적인 발판이 된다.

Claude Code에 붙인다.

```bash
claude mcp add --transport http babyfood https://<서버 주소>/mcp \
  --header "Authorization: Bearer <발급받은 토큰>"
```

## 환경 변수

`.env.example`에 설명과 함께 있다. 배포할 때 놓치기 쉬운 것은 둘이다. `MCP_ALLOWED_HOSTS`는 비워 두면 localhost만 허용하므로 모든 요청이 403이 되고, `SCHEDULER_ENABLED`를 false로 두면 자동 차감이 조용히 멈춘다.

## 지금 되는 것과 안 되는 것

4단계까지 끝났다(기획안 9장). Claude Code에서 재고와 식단을 관리할 수 있고, 서버가 매분 정합화를 돌려 식단시간이 지난 끼니를 자동으로 차감한다. `get_daily_brief`로 오늘 브리프 내용을 조회할 수 있다.

남은 것은 5단계다. 브리프를 Slack으로 보내는 것과 버튼 응답, Railway 배포와 PITR 설정이 아직 없다. 지금은 브리프를 부모가 아니라 에이전트가 불러서 본다.
