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
| `docs/adr/0006-slack-delivery-and-deployment.md` | Slack 발송 클레임과 재시도, 버튼 응답의 서명과 멱등키, Railway 배포 |
| `docs/adr/0007-slack-message-templates.md` | 코드 템플릿, 재고 표, 보낸 메시지 스냅숏 |
| `docs/adr/0008-slack-canvas-board.md` | 채널 캔버스 상태판, `state_changed_at` 갱신 판정, 회차 투영 |
| `docs/adr/0009-pantry-ingredients-and-expiry-notice.md` | 상비 재료, 재고 표의 임계일 열과 3일 전 강조 |
| `docs/adr/0010-stock-alert-message.md` | 브리프와 별도인 재고 알람 메시지, 부족 시작일 순 재고 표 |

규칙을 알고 싶으면 기획안 4장을 읽는다. 왜 그렇게 만들었는지는 ADR에 있다.

## 계층

```
Claude Code ──MCP (Streamable HTTP)──> src/mcp (구성원 토큰 인증) ────┐
Slack (휴대폰) ──버튼 응답 (HTTP)────> src/slack/inbound (서명 검증) ──┼──> src/application ──> src/domain
스케줄러 (매분 정합화, 브리프 발송, 상태판 갱신) ──> src/scheduler ───┘             │
                                                                                     └──> ports ──┬──> src/infrastructure ──> PostgreSQL
                                                                                                  └──> src/slack/outbound ──> Slack Web API (메시지, 캔버스)
```

계층 규칙과 금지 목록은 `AGENTS.md`에 있다. 에이전트와 사람이 같은 파일을 읽는다.

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

Slack을 가정에 연결한다. 가정마다 브리프를 받을 채널 id를 하나 연결하고, 구성원마다 그 사람의 Slack 사용자 id를 연결한다.

```bash
pnpm slack-link --household 재하네 --channel C0123ABCD                  # 브리프를 보낼 채널
pnpm slack-link --household 재하네 --member 엄마 --slack-user U0123ABCD  # 버튼을 누르는 사람
pnpm slack-link --household 재하네 --canvas F0123ABCD                    # 사람이 먼저 만든 채널 캔버스를 상태판으로
pnpm slack-link --list                                                   # 연결 상태
```

채널에는 봇을 초대해 두어야 한다. 초대하지 않으면 발송이 `not_in_channel`로 실패한다. 채널이 연결되지 않은 가정의 그날 브리프는 재시도 없이 건너뛴다(ADR 0006 "재시도 정책"). 버튼 응답에는 누른 사람의 Slack 사용자 id만 들어 있다. 그 id가 구성원에 연결되어 있지 않으면 서버는 누가 눌렀는지 알 수 없어서, 아무것도 기록하지 않고 "등록되지 않은 Slack 사용자입니다"만 돌려준다(`src/slack/inbound/action-dispatch.ts`). 이 명령도 `member-token`처럼 이미 있는 가정과 구성원을 연결할 뿐 새로 만들지 않는다. 채널을 옮기는 MCP 도구는 없다. 상태판 캔버스는 채널이 연결되면 서버가 다음 분에 만든다. 채널에 이미 캔버스가 있으면(채널당 하나) 서버가 만들 수 없으므로 `--canvas`로 그 id를 연결한다. 봇에는 `chat:write` 외에 `canvases:write`와 `canvases:read` 스코프가 있어야 한다.

## 환경 변수

`.env.example`에 설명과 함께 있다. `SLACK_BOT_TOKEN`과 `SLACK_SIGNING_SECRET`은 필수다. 둘 중 하나라도 없으면 서버뿐 아니라 `pnpm member-token`과 `pnpm slack-link`도 뜨지 않는다. 설정을 한곳(`src/config/env.ts`)에서 읽기 때문이다.

배포할 때 놓치기 쉬운 것은 셋이다. `MCP_ALLOWED_HOSTS`는 비워 두면 localhost만 허용하므로 모든 요청이 403이 된다. `SCHEDULER_ENABLED`를 false로 두면 자동 차감과 브리프 발송이 함께 조용히 멈춘다. 발송이 정합화와 같은 매분 tick에 붙어 있기 때문이다. `SLACK_SIGNING_SECRET`이 틀리면 서버는 뜨지만 모든 버튼 탭이 401로 거부된다.

## 배포

배포 설정은 저장소에 있다. `railway.json`이 빌드를 `Dockerfile`로 정하고, 배포 전에 `preDeployCommand`로 `pnpm db:deploy`를 돌려 마이그레이션을 적용한다. 헬스체크는 `/health`다. 다만 2026-09-26 기준으로 Railway 서비스가 이 파일을 읽지 않고 있어서, 마이그레이션은 배포 뒤 손으로 적용한다(`docs/user-intervention.md` 6번). Railway 프로젝트와 Postgres를 만들고, PITR을 켜고, 서비스 환경 변수를 넣는 일은 콘솔에서 사람이 한다. 순서와 넣을 값은 `docs/user-intervention.md` 3번에 있다.

## 하네스

기능 추가는 phase 단위로 한다. 요구는 `docs/backlog.md`에 적고, `plan-and-build` 스킬이 `tech-critic-lead` 결재를 거쳐 `tasks/{id}-{name}/`을 만들면 `python3 scripts/harness/run_phases.py {id}-{name}`이 phase마다 새 Claude 세션을 돌린다. 세션의 보고는 믿지 않고 러너가 scope 밖 변경, `src/domain` 변경, `pnpm typecheck && pnpm lint && pnpm test`를 따로 검사한다. 규격은 `prompts/task-create.md`, 설정은 `harness.json`, 문서 게이트는 `scripts/harness/check_docs.py`다. 무인 세션은 `.env`가 없는 worktree에서 돌린다(`docs/README.md`).

## 지금 되는 것과 안 되는 것

6단계까지 끝났다(기획안 9장). Claude Code에서 재고와 식단을 관리할 수 있고, 서버가 매분 정합화를 돌려 식단시간이 지난 끼니를 자동으로 차감한다. 같은 tick에서 설정한 시각이 지난 가정의 브리프를 Slack 채널로 보내고, 실패하면 재시도한다. 부모는 브리프와 후속 메시지의 버튼으로 미급여, 반응, 폐기를 응답할 수 있다. 채널 탭의 캔버스에는 상태판이 있다. 엑셀 식단표 양식의 식단 달력(월~일 한 주가 표 하나, 첫 도입 재료의 회차 표시)과 재고 표, 임계일, 확인 필요를 담고, 상태가 바뀐 뒤 1~2분 안에 서버가 다시 쓴다(ADR 0008). 배포 설정도 저장소에 있다.

2026-09-26부터 운영 중이다. 서버는 Railway의 `help-babyfood-production.up.railway.app`에 떠 있고, 식단과 재고를 이관했으며, 매일 07:30 브리프가 `#help-babyfood` 채널로 간다. 브리프의 재고는 표 한 장으로 보이고, 보낸 메시지는 `slack_message`에 남는다(ADR 0007). 양식을 미리 보려면 운영 컨테이너에서 `railway ssh "node dist/scripts/preview-slack.js --household 재하네"`를 돌린다. `--template stock_alert`는 재고 알람(ADR 0010)을 보내고, 상태판은 `--template household_board --dry-run`이 마크다운을 출력한다. 로컬의 `pnpm slack-preview`는 로컬 DB를 읽는다.

아직 남은 것은 `docs/user-intervention.md`의 표에 있다. 버튼 응답은 Slack 사용자 id를 연결한 구성원만 기록된다. 지금은 아빠만 연결되어 있고, 연결되지 않은 사람이 누르면 "등록되지 않은 Slack 사용자입니다"만 돌아온다(7번). PITR은 Railway Pro 플랜에서만 되어 보류 중이다.
