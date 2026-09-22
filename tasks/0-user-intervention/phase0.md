# Phase 0: docs

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain -- src/ test/ prisma/ docs/
```

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고 `tasks/0-user-intervention/index.json`의 phase 0 status를 `"error"`로, `error_message`에 `dirty working tree`로 적고 멈춰라.

먼저 아래를 읽고 이 프로젝트가 어디까지 왔고 무엇이 남았는지 파악하라.

- `README.md` (계층, 개발 환경, 서버에 붙기, 환경 변수, 지금 되는 것과 안 되는 것)
- `docs/product-plan.md` (특히 9장 구현 단계와 10장 미정 사항)
- `docs/adr/0003-postgres-hosting-railway.md` (Railway와 PITR)
- `docs/adr/0004-mcp-server-and-auth.md` (구성원 토큰 발급이 왜 CLI에만 있는지)
- `docs/adr/0005-scheduler-and-daily-brief.md` (마지막 절 "대가와 남는 위험")

## 작업 내용

`docs/user-intervention.md`를 새로 만든다. **이 파일 하나만 만든다.** 코드와 다른 문서는 건드리지 않는다.

### 이 문서가 무엇인가

무인 세션이 CLI만으로 끝낼 수 없는 일을 모아 두는 곳이다. 하네스가 phase를 돌다가 사람을 기다리며 멈추는 대신, 여기에 적어 두고 다음으로 넘어가기 위한 문서다. 사람이 나중에 이 목록만 보고 순서대로 처리할 수 있어야 한다.

### 담을 항목

아래 다섯 가지를 각각 한 항목으로 적는다. 항목마다 왜 사람이 해야 하는지, 무엇을 하면 되는지, 그 결과가 저장소의 무엇과 연결되는지를 쓴다.

| 항목 | 사람이 해야 하는 이유 | 연결되는 것 |
|---|---|---|
| GitHub push | 지금까지 push하지 않았고, 원격에는 첫 커밋 하나만 있다. 자격 증명과 공개 범위 판단이 사람 몫이다 | `git@github.com:RGunny/help-babyfood.git` |
| Slack 앱 생성과 봇 토큰 발급 | 웹 콘솔에서만 가능하다. 앱 생성, 봇 스코프 부여, 워크스페이스 설치, 채널 초대 | 5단계 브리프 발송과 버튼 응답 |
| Railway 프로젝트와 Postgres, PITR 활성화 | 결제 수단과 플랜 선택이 필요하다. PITR 플랜 조건은 기획안 10장이 미정으로 남겨 두었고 프로비저닝 때 확인하기로 했다 | `docs/adr/0003-postgres-hosting-railway.md` |
| 구성원 토큰 발급 | 명령은 CLI에 있지만(`pnpm member-token`), 평문 토큰을 부모의 MCP 설정에 넣는 일은 사람이 한다. 토큰을 도구로 만들 수 없게 한 것이 ADR 0004의 결정이다 | `src/scripts/mint-member-token.ts` |
| 실제 이관 | 엑셀 식단표를 넘기고 냉동고의 실물 큐브를 세어 입고로 등록하는 일이다. 기획안 4.8절이 "이관은 서비스 개발이 끝난 뒤 한 번에 한다"로 두었다 | 기획안 4.8절 |

각 항목에 체크박스(`- [ ]`)를 붙여 사람이 처리하면서 표시할 수 있게 한다.

### 문서 규약

- 문체는 `docs/`의 다른 문서와 같게 "~한다"로 쓴다.
- 주장에는 근거를 붙인다. 기획안 조항이나 ADR 번호를 지목한다.
- em dash(—)를 문장 연결에 쓰지 않는다.
- 확인하지 않은 것을 단정하지 않는다. PITR 플랜 조건처럼 아직 모르는 것은 모른다고 적는다.

## Acceptance Criteria

아래를 순서대로 실행해 모두 exit 0이어야 한다.

```bash
# 1) 파일이 생겼다
test -f docs/user-intervention.md

# 2) 다섯 항목이 전부 들어 있다
grep -q "push" docs/user-intervention.md
grep -q "Slack" docs/user-intervention.md
grep -q "Railway" docs/user-intervention.md
grep -q "member-token" docs/user-intervention.md
grep -q "이관" docs/user-intervention.md

# 3) 체크박스 항목이 다섯 개 이상이다
test "$(grep -c '^- \[ \]' docs/user-intervention.md)" -ge 5

# 4) 코드와 설정은 한 줄도 바뀌지 않았다
test -z "$(git status --porcelain -- src/ test/ prisma/ package.json pnpm-lock.yaml vitest.config.ts)"

# 5) 도메인 불변
git diff --quiet HEAD -- src/domain/

# 6) docs/에서 바뀐 것은 이 파일 하나뿐이다
test "$(git status --porcelain -- docs/ | wc -l | tr -d ' ')" = "1"

# 7) 기존 상태가 깨지지 않았다
pnpm typecheck
pnpm lint
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 통과하면 `tasks/0-user-intervention/index.json`의 phase 0 status를 `"completed"`로 바꿔라.

세 번 고쳐도 통과하지 못하면 status를 `"error"`로 바꾸고, 같은 phase 객체의 `"error_message"`에 어떤 명령이 어떤 출력으로 실패했는지 실제 출력을 근거로 적어라.

AC 통과와 index.json 갱신을 마쳤으면 커밋하라. 메시지는 `docs: record what a human still has to do by hand`로 한다.

## 하지 말아야 할 것

- **`docs/` 안의 다른 파일을 고치지 마라.** 기획안 10장에 미정 사항이 있지만 이번 phase는 새 문서 하나만 만든다. 기획안 수정은 별도 task다.
- **`README.md`를 고치지 마라.** 이 문서로 연결하고 싶어지겠지만 이번 범위가 아니다.
- **코드를 고치지 마라.** `src/`, `test/`, `prisma/`, 설정 파일 전부 이번 phase 밖이다.
- **새 ADR을 쓰지 마라.** 이 문서는 결정 기록이 아니라 작업 목록이다.
- **하지 않은 일을 했다고 적지 마라.** Slack 앱이나 Railway 프로젝트는 아직 존재하지 않는다. 이 문서는 "앞으로 사람이 할 일"이다.
- **`tasks/` 안의 다른 파일을 고치지 마라.** `tasks/0-user-intervention/index.json`의 phase 0 status만 갱신한다.
