# 사람이 손으로 해야 하는 일

무인 세션은 이 저장소 안에서 명령을 돌리고 파일을 고치는 것까지만 한다. 웹 콘솔 로그인, 결제 수단 등록, 평문 토큰을 부모의 설정 파일에 넣기, 냉동고의 큐브 세기는 CLI로 끝나지 않는다. 하네스가 phase를 돌다가 이런 일을 만나면 사람을 기다리며 멈추지 않고 여기에 적어 두고 다음으로 넘어간다.

이 문서는 결정 기록이 아니라 작업 목록이다. 왜 그렇게 하기로 했는지는 각 항목이 지목하는 기획안 조항과 ADR에 있다. 아래 다섯 항목은 사람이 위에서부터 순서대로 처리할 수 있게 늘어놓았다. 4번은 3번이 끝나야 실제 데이터베이스에 토큰을 넣을 수 있고, 5번은 5단계까지 끝나야 한다. 1번과 2번은 나머지와 독립이다.

2026-09-26 기준 상태는 아래 표와 같다. 1~5번은 처음에 적은 일이고, 6~8번은 배포하면서 새로 드러난 일이며, 9번은 6단계(상태판)가 더한 일이다. 끝난 항목도 본문을 지우지 않는다. 같은 일을 다시 할 때(새 가정, 새 채널, 서버 이전) 순서와 값이 필요하기 때문이다.

| 번호 | 일 | 상태 |
|---|---|---|
| 1 | GitHub에 push | 끝남. 원격 `main`이 배포 브랜치다 |
| 2 | Slack 앱과 봇 토큰 | 끝남. 앱 "이유식 알리미", 채널 `C0C464ME015` |
| 3 | Railway와 PITR | 서버와 DB는 끝남. PITR은 Pro 플랜에서만 되어 보류 |
| 4 | 구성원 토큰 | 아빠 1개 발급·등록. 엄마는 아직 |
| 5 | 식단과 재고 이관 | 끝남. 식단 35일치, 재료 17개 |
| 6 | Railway 서비스 설정을 `railway.json`과 맞춘다 | 자동배포만 켜짐. 빌더·배포 전 명령·헬스체크는 아직 |
| 7 | 버튼을 누를 구성원의 Slack 사용자 id 연결 | 아빠 연결함(`U097XRTNAP4`). 엄마는 아직 |
| 8 | 대화에 노출된 봇 토큰 교체 | 안 함 |
| 9 | 캔버스 스코프 추가와 상태판 캔버스 연결 | 스코프는 끝남. 캔버스 `F0C4HPW0JP7`을 서버에 연결하는 것은 배포 뒤 |

## 1. GitHub에 push한다

- [x] 로컬 브랜치를 `git@github.com:RGunny/help-babyfood.git`에 push하고, 저장소를 공개로 둘지 비공개로 둘지 정한다.

원격에는 첫 커밋 `34bec6d Initial commit` 하나만 있다. 1단계부터 4단계까지의 작업(기획안 9장)은 전부 로컬에만 있고, 확인 시점에 `feat/harness`가 원격 `main`보다 30개 커밋 앞서 있다. push가 없으면 이 노트북이 유일한 사본이다.

사람이 해야 하는 이유는 둘이다. push에 쓰는 SSH 키나 개인 액세스 토큰이 사람의 GitHub 계정에 묶여 있고, 저장소를 공개로 둘지는 판단이 필요하다. 저장소에 가정 이름("재하네")과 아기의 급여 이력에 대한 설명이 들어 있다. 비밀 값 자체는 `.env`로 분리되어 커밋되지 않지만, 공개 범위는 사람이 정한다.

## 2. Slack 앱을 만들고 봇 토큰을 발급한다

- [x] Slack 앱을 만들고, 봇 스코프를 주고, 워크스페이스에 설치하고, 브리프를 받을 채널에 봇을 초대한 뒤 봇 토큰을 안전한 곳에 둔다.

앱 생성과 스코프 부여, 워크스페이스 설치 승인은 Slack 웹 콘솔에서만 되고 워크스페이스 관리자 권한이 필요하다. CLI로 대신할 수 없다.

이 토큰이 연결되는 곳은 5단계다. 기획안 9장의 5단계 범위가 "브리프 발송과 재시도, 버튼 응답"이고, 기획안 5장이 브리프 구성과 버튼(끼니별 미급여, 반응 없음과 반응 있음, 폐기 완료)을 정해 두었다. 버튼 응답을 누가 눌렀는지는 구성원의 Slack 사용자 ID로 매핑하며, 그 자리는 `prisma/schema.prisma`의 `slack_user_id`에 이미 있다.

콘솔에서 넣을 값은 5단계에서 확정했다(`docs/adr/0006-slack-delivery-and-deployment.md`).

| 항목 | 값 |
|---|---|
| 봇 스코프 | `chat:write` |
| Interactivity의 Request URL | `https://<서버 주소>/slack/interactions` |
| 봇 토큰(`xoxb-`로 시작) | 환경 변수 `SLACK_BOT_TOKEN` |
| 서명 비밀(Signing Secret) | 환경 변수 `SLACK_SIGNING_SECRET` |

스코프가 `chat:write` 하나인 이유는 서버가 Slack에 하는 일이 `chat.postMessage` 하나이기 때문이다. 버튼 응답의 통보는 Slack이 요청 본문에 넣어 주는 일회용 `response_url`로 보내므로 스코프를 요구하지 않는다.

서명 비밀이 필요한 이유는 수신이 HTTP이기 때문이다. 기획안 8장이 Socket Mode가 아니라 HTTP 수신으로 정했고, 공개된 URL로 들어온 요청이 Slack에서 온 것인지는 `X-Slack-Signature` 검증으로만 판정한다. 이 값은 봇 토큰과 다른 값이고 앱 설정의 Basic Information에 있다.

브리프를 받을 채널에 봇을 초대해야 한다. 초대하지 않으면 `chat.postMessage`가 `not_in_channel`로 실패한다. 채널 id를 가정에 연결하는 것은 `pnpm slack-link`로 하며, 그것은 서버가 뜬 뒤에 한다. 이 명령은 `DATABASE_URL`이 가리키는 데이터베이스에 쓴다. 채널이 연결되지 않은 가정의 그날 브리프는 재시도 없이 건너뛰고 다음 날 아침부터 발송된다(ADR 0006 "재시도 정책").

## 3. Railway 프로젝트와 Postgres를 만들고 PITR을 켠다

- [ ] Railway 프로젝트를 만들고, Postgres를 붙이고, PITR을 켤 수 있는지 확인한 뒤 켠다. 켤 수 없으면 ADR 0003의 차선책대로 Neon으로 바꾸고 ADR을 고친다.

2026-09-26에 확인한 결과: 프로젝트 `appealing-adaptation`에 서버 `help-babyfood`와 Postgres가 떠 있고, 서버 주소는 `help-babyfood-production.up.railway.app`이다. Postgres의 Backups 화면이 "Creating backups and enabling point-in-time recovery (PITR) are only available for customers on the Pro plan"이라고 답한다. 플랜 조건은 이것으로 풀렸고, Pro로 올릴지 Neon으로 옮길지는 사람이 정해야 해서 보류 중이다. 정한 뒤 ADR 0003의 상태를 고친다.

결제 수단 등록과 플랜 선택은 사람 몫이다. 그리고 확인해야 할 것이 하나 남아 있다. `docs/adr/0003-postgres-hosting-railway.md`는 상태를 "채택 (PITR 플랜 조건은 프로비저닝 때 확인)"으로 적어 두었고, 기획안 10장도 "Railway Postgres PITR의 플랜 조건. 공식 문서에 없어서 프로비저닝 때 확인한다"를 미정으로 남겼다. 어느 플랜부터 PITR이 되는지는 지금 모른다. 콘솔에서 직접 보고 판정한다.

ADR 0003이 같은 문서에서 요구하는 것이 셋 더 있다. 복구 가능 구간은 PITR을 켠 뒤의 첫 베이스 백업부터이므로 운영 데이터를 넣기 전에 켠다. 복구 절차는 운영 데이터를 넣기 전에 한 번 실제로 수행해 본다. 서버와 DB는 사설망으로 연결하고 DB를 외부에 노출하지 않는다.

서비스 환경 변수는 콘솔에서 넣는다. 배포가 필요로 하는 것은 다섯이다.

| 변수 | 값 |
|---|---|
| `DATABASE_URL` | Railway Postgres의 사설망 접속 문자열 |
| `MCP_ALLOWED_HOSTS` | 서버의 실제 호스트 이름 |
| `SLACK_BOT_TOKEN` | 2번에서 받은 봇 토큰 |
| `SLACK_SIGNING_SECRET` | 2번에서 받은 서명 비밀 |
| `SCHEDULER_ENABLED` | `true` |

`MCP_ALLOWED_HOSTS`는 빈 값으로 두면 `localhost`만 허용한다. 배포된 서버의 실제 주소를 넣지 않으면 `/mcp`로 들어온 모든 요청이 403이 되고, 증상은 Claude Code에서 "연결 실패"로만 보인다(`.env.example`).

`SCHEDULER_ENABLED`를 false로 두면 매분 도는 크론이 등록되지 않는다. 그러면 자동 차감과 브리프 발송이 둘 다 멈춘다. 브리프 발송이 같은 tick에 붙어 있기 때문이다(`docs/adr/0006-slack-delivery-and-deployment.md`). 자동 차감이 조용히 멈추는 것은 ADR 0005가 "대가와 남는 위험"에 적어 둔 항목이고, 5단계부터는 브리프가 오지 않는 것으로도 드러난다.

## 4. 구성원 토큰을 발급해 부모의 MCP 설정에 넣는다

- [ ] 부모 두 명의 기기마다 `pnpm member-token`으로 토큰을 발급하고, 각자의 Claude Code에 `claude mcp add`로 등록한다.

2026-09-26 기준으로 `재하네/아빠`의 "아빠 맥북" 토큰 하나가 발급되어 쓰이고 있다(`node dist/scripts/mint-member-token.js --list`). 엄마 기기는 아직이다.

명령 자체는 저장소에 있다. `src/scripts/mint-member-token.ts`이고 README의 "서버에 붙기"에 사용법이 있다.

```bash
pnpm member-token --household 재하네 --member 엄마 --label "엄마 노트북"
```

사람이 해야 하는 이유는 토큰의 평문이 이 명령의 출력에 한 번만 보이고, 그 값을 부모 각자의 MCP 설정에 옮겨 넣는 일이 사람 손을 거치기 때문이다. `docs/adr/0004-mcp-server-and-auth.md`는 토큰을 MCP 도구로 만들 수 없게 두기로 했다. 토큰으로 인증한 세션이 토큰을 발급할 수 있으면 유출 하나가 영구적인 발판이 된다. 그래서 발급은 DB에 닿는 경로에만 있다.

3번 뒤에 하는 이유는 이 스크립트가 `DATABASE_URL`이 가리키는 실제 데이터베이스에 토큰 해시를 넣기 때문이다. 노트북의 로컬 DB에 발급한 토큰은 배포된 서버에서 쓸 수 없다.

유출을 알아차렸을 때 할 수 있는 일은 `pnpm member-token --revoke <토큰 id>`뿐이고, 알아차리는 수단은 `--list`가 보여 주는 마지막 사용 시각뿐이다(ADR 0004 "대가와 남는 위험"). 토큰은 기본 180일 뒤 만료되므로 그때 다시 발급한다.

`SLACK_BOT_TOKEN`과 `SLACK_SIGNING_SECRET`이 필수 환경 변수가 되었으므로 `pnpm member-token`과 `pnpm slack-link`도 두 값이 환경에 있어야 돈다. 두 스크립트가 DB만 쓰지만 `readEnv()`로 설정을 읽고, `readEnv()`는 필수 값이 없으면 거부한다(`src/config/env.ts`).

## 5. 엑셀 식단표와 냉동고 재고를 실제로 이관한다

- [x] 엑셀 식단표를 에이전트에게 넘겨 `import_meal_plan`의 미리보기로 검증한 뒤 확정하고, 냉동고의 큐브를 조리일과 함께 세어 입고로 등록하고, 이미 검증이 끝난 재료 목록을 한 번에 등록한다.

기획안 4.8절이 "이관은 서비스 개발이 끝난 뒤 한 번에 한다"로 두었다. 5단계가 끝난 뒤에 한다.

사람이 해야 하는 일인 이유는 입력이 저장소 밖에 있기 때문이다. 엑셀 식단표는 부모의 파일이고, 재고는 냉동고 문을 열어 실물 큐브를 세어야 나온다. 서버가 계산해 줄 수 있는 값이 아니다.

4.8절이 함께 정한 것이 셋 있다. 이관 시점에 이미 먹인 식단은 급여 이력으로만 기록하고 재고는 차감하지 않으며, 정합화가 다시 차감하지 않도록 이관된 식단임을 표시한다. 과거 식단의 반응 결과는 식단마다 입력하지 않고, 이미 검증이 끝난 재료 목록을 한 번에 등록해 검증완료로 시작한다. 엑셀의 셀 색상(첫 도입 표시)은 가져오지 않는다.

이관이 끝나면 기준은 서버의 식단이고 엑셀은 더 이상 갱신하지 않는다(기획안 2장). 끼니가 한쪽만 밀리면 엑셀의 칸과 실제 날짜가 어긋나 두 곳을 함께 유지할 수 없다.

2026-09-26에 이관했다. 재료 17개, 메뉴 3개, 오전 끼니 하나(시작일 2026-08-31, 식단시간 10:00), 식단 35건(1~27일차 급여 완료, 28~35일차 예정)이 들어갔다. 이미 먹인 재료도 `verifiedBeforeMigration` 없이 등록되어, 브리프의 새 재료 관찰에 쌀·오트밀·소고기까지 1회차로 올라온다. 동작에는 지장이 없고 브리프가 시끄러울 뿐이다. 이 플래그는 재료를 만들 때만 줄 수 있어서, 고치려면 DB를 직접 고쳐야 한다.

## 6. Railway 서비스 설정을 `railway.json`과 맞춘다

- [ ] Railway 콘솔의 `help-babyfood` 서비스 Settings에서 소스 브랜치, 빌더, 배포 전 명령, 헬스체크를 저장소의 `railway.json`과 같게 둔다.

2026-09-26에 Railway API로 서비스 설정을 읽어 보니 `railway.json`이 하나도 반영되어 있지 않았다.

| 항목 | `railway.json` | 서비스 실제 값 |
|---|---|---|
| 빌더 | `DOCKERFILE` | `RAILPACK` |
| 배포 전 명령 | `pnpm db:deploy` | 없음 |
| 헬스체크 | `/health` | 없음 |
| 자동배포 트리거(`repoTriggers`) | `main` | 없음. 같은 날 콘솔에서 켜서 지금은 `main` |

트리거가 없던 동안 두 가지 일이 실제로 일어났다. `main`에 push해도 배포가 시작되지 않아 `railway redeploy --from-source`로 손으로 올렸다. 그리고 배포에 `20260926170000_slack_message` 마이그레이션이 적용되지 않아, 컨테이너 안에서 `pnpm db:deploy`를 손으로 돌렸다. 둘 다 놓치면 조용히 지나간다. 마이그레이션이 빠진 채로 뜬 서버는 새 테이블에 쓰는 순간에야 실패한다.

자동배포는 켜졌지만 배포 전 명령은 여전히 없다. 따라서 다음에 마이그레이션이 든 커밋을 push하면 배포는 시작되지만 마이그레이션은 돌지 않는다. 그때까지는 배포 뒤 `railway ssh "cd /app && pnpm db:deploy"`를 손으로 돌린다.

CLI가 배포 때마다 "Config as Code (railway.json / railway.toml) is deprecated. Prefer Infrastructure as Code (.railway/railway.ts)"라고 경고한다. 설정을 저장소에 두는 방식을 `railway config migrate`로 옮길지, 콘솔에 직접 넣을지는 사람이 정한다. 어느 쪽이든 끝나면 위 표를 API로 다시 읽어 확인한다.

## 7. 버튼을 누를 구성원의 Slack 사용자 id를 연결한다

- [ ] 부모 각자의 Slack 사용자 id(`U`로 시작)를 찾아 `pnpm slack-link --household 재하네 --member 아빠 --slack-user U…`로 연결한다.

2026-09-26에 구성원 `아빠`를 `U097XRTNAP4`에 연결했다(`node dist/scripts/link-slack.js --list`). 연결되지 않은 구성원은 브리프의 버튼을 누르면 서버는 누가 눌렀는지 모르므로 아무것도 기록하지 않고 "등록되지 않은 Slack 사용자입니다"만 답한다(`src/slack/inbound/action-dispatch.ts`).

Slack 사용자 id는 Slack에서 자기 프로필 → 점 세 개 메뉴 → "Copy member ID"로 얻는다. 봇의 스코프가 `chat:write` 하나라 서버가 id를 대신 찾아 줄 수 없다. 엄마도 버튼을 쓰려면 먼저 4번대로 구성원을 만든 뒤 같은 명령으로 연결한다. 운영 DB에 써야 하므로 Railway 컨테이너에서 `node dist/scripts/link-slack.js …`로 돌린다.

## 8. 대화에 노출된 Slack 봇 토큰을 교체한다

- [ ] Slack 앱 설정의 OAuth & Permissions에서 봇 토큰을 재발급하고, Railway의 `SLACK_BOT_TOKEN`을 새 값으로 바꾼다.

2번에서 받은 봇 토큰과 서명 비밀이 에이전트 대화에 평문으로 붙여 넣어졌다. 대화 기록에 남은 값은 지울 수 없으므로 값 자체를 바꾼다. 서명 비밀도 같은 이유로 Basic Information에서 재발급하고 `SLACK_SIGNING_SECRET`을 바꾼다. 봇 토큰을 바꾸면 기존 토큰은 즉시 무효가 되므로, 바꾼 뒤 `railway ssh "node dist/scripts/preview-slack.js --household 재하네"`로 발송이 되는지 확인한다.

## 9. 캔버스 스코프를 더하고 상태판 캔버스를 연결한다

- [x] Slack 앱의 Bot Token Scopes에 `canvases:write`와 `canvases:read`를 더하고 워크스페이스에 재설치한다.
- [ ] 6단계 배포 뒤, 손으로 만든 캔버스를 서버에 연결한다.

6단계(ADR 0008)의 상태판은 서버가 `conversations.canvases.create`와 `canvases.edit`로 채널 캔버스를 만들고 고친다. 두 메서드가 `canvases:write`를 요구하고, 구역 조회(`canvases.sections.lookup`)가 `canvases:read`를 요구한다. 스코프 추가와 재설치는 Slack 콘솔의 OAuth & Permissions에서만 된다.

2026-09-26에 스코프를 더하고 재설치했다. 운영 컨테이너에서 `conversations.canvases.create`를 채널 `C0C464ME015`로 호출해 무료 플랜에서도 채널 캔버스가 만들어지는 것을 확인했고, 그때 만든 캔버스가 `F0C4HPW0JP7`이다. 채널당 캔버스는 하나뿐이라 서버가 새로 만들려 하면 `channel_canvas_already_exists`로 건너뛴다. 배포 뒤 아래 명령으로 그 캔버스를 가정에 연결하면 다음 tick부터 서버가 내용을 채운다.

```bash
railway ssh "node dist/scripts/link-slack.js --household 재하네 --canvas F0C4HPW0JP7"
```

캔버스를 사람이 지웠다면 `slack_canvas` 행을 지워야 서버가 새로 만든다. 그 절차는 ADR 0008 "대가와 남는 위험"에 있다.
