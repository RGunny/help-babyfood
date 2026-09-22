# Phase 7: break-it

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain
```

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고 `tasks/1-slack-and-deploy/index.json`의 phase 7 status를 `"error"`로, `error_message`에 `dirty working tree`로 적고 멈춰라.

먼저 아래를 읽어라.

- `tasks/1-slack-and-deploy/docs-diff.md`
- `docs/adr/0006-slack-delivery-and-deployment.md`
- `README.md` 전체. **이 phase가 고칠 문서다**
- `docs/product-plan.md` 9장의 표
- `src/infrastructure/prisma/brief-delivery-log.repository.ts`
- `src/slack/inbound/signature.ts`
- `src/slack/inbound/action-dispatch.ts`

## 작업 내용

이 phase는 두 가지를 한다. 앞 여섯 phase가 통과시킨 테스트가 진짜인지 확인하는 것과, 그 결과를 문서에 반영하는 것이다.

### 1. 일부러 고장 내기

통과한 테스트는 두 가지 이유로 통과한다. 코드가 맞거나, 테스트가 아무것도 보지 않거나. 아래 셋을 하나씩 고장 내고 **지목한 테스트가 실제로 실패하는지** 확인한 뒤 되돌린다.

절차는 셋 모두 같다.

1. 고장을 넣는다.
2. 지목한 테스트 파일만 돌린다.
3. **실패하는 것을 확인한다.** 실패하지 않으면 그 테스트는 그 규칙을 보고 있지 않다는 뜻이다. 그때는 테스트를 고쳐서 잡히게 만들고 다시 확인한다.
4. `git checkout --` 으로 고장을 되돌린다.
5. 다시 돌려 통과하는 것을 확인한다.

| # | 고장 | 잡아야 하는 테스트 | 잡히지 않으면 뜻하는 것 |
|---|---|---|---|
| 1 | `brief-delivery-log.repository.ts`의 브리프 클레임에서 `ON CONFLICT (household_id, brief_date) DO NOTHING`을 지워 충돌 시 예외가 나게 한다 | `test/integration/brief-delivery.int-spec.ts`의 동시 클레임 테스트 | 하루 한 건이 보장되지 않는다. 인스턴스가 둘이면 브리프가 두 번 간다 |
| 2 | `signature.ts`의 비교를 `timingSafeEqual` 대신 무조건 `true`로 만든다 | `test/integration/slack-interactions.int-spec.ts`의 서명 불량 401 테스트 | 아무나 버튼 응답을 위조해 재고를 바꿀 수 있다 |
| 3 | `action-dispatch.ts`의 멱등키에서 `value`를 빼 `slack:{ts}:{action_id}`로 만든다 | `test/integration/slack-interactions.int-spec.ts`의 "같은 메시지의 서로 다른 배치 두 개를 폐기하면 둘 다 남는다" | 한 브리프에서 둘째 배치부터 폐기가 조용히 막힌다 |

세 번째가 이 task에서 가장 중요하다. 그 버그는 설계 검토에서 실제로 한 번 잡힌 것이고, 같은 실수가 다시 들어오면 부모는 "폐기 완료를 눌렀는데 재고가 그대로"인 상황을 만나게 된다. 원인을 짐작하기 어려운 종류다.

결과를 `tasks/1-slack-and-deploy/break-it.md`에 적는다. 고장마다 무엇을 바꿨고, 어떤 테스트가 어떤 메시지로 실패했고, 되돌린 뒤 통과했는지를 **실제 출력을 근거로** 적어라. 지어내지 마라.

### 2. `docs/product-plan.md` 9장

5단계 행의 "상태" 칸을 `끝`으로 바꾼다. 1~4단계와 같은 표기다.

**표의 다른 칸은 건드리지 마라.** 10장의 "Railway Postgres PITR의 플랜 조건"도 그대로 둔다. 여전히 모른다.

### 3. `README.md`

다섯 군데를 고친다.

**계층 그림.** Slack이 양방향으로 붙는다. 발송은 스케줄러가 애플리케이션을 거쳐 나가고, 버튼 응답은 `src/slack`으로 들어와 같은 애플리케이션 서비스를 부른다. 기획안 8장의 그림과 어긋나지 않게 그린다. 그림 아래 설명에 `src/slack`이 어댑터이고 재고 규칙을 다시 쓰지 않는다는 한 줄을 더한다.

**문서 표.** `docs/adr/0006-slack-delivery-and-deployment.md` 행을 더한다. 내용 칸은 한 줄이다.

**환경 변수.** `SLACK_BOT_TOKEN`과 `SLACK_SIGNING_SECRET`이 필수라는 것을 적는다. 지금 "배포할 때 놓치기 쉬운 것은 둘이다"로 시작하는 문단이 있다. 숫자가 맞게 고쳐라.

**서버에 붙기.** `pnpm slack-link` 사용법을 더한다. 어느 가정에 어느 채널을 연결하는지와, 구성원의 Slack 사용자 id를 연결해야 버튼을 누른 사람을 알 수 있다는 것을 적는다.

**지금 되는 것과 안 되는 것.** 5단계가 끝났다는 것으로 고친다. 부모가 Slack으로 브리프를 받고 버튼으로 응답할 수 있다. 배포 설정은 저장소에 있다.

**여기서 정확해야 한다.** 아직 하지 않은 것이 있다. Slack 앱은 만들어지지 않았고, Railway 프로젝트도 없고, PITR도 켜지지 않았고, 실제 이관도 하지 않았다. 그것들은 `docs/user-intervention.md`에 있고 사람이 한다. **"부모가 브리프를 받고 있다"라고 쓰지 마라.** 받을 수 있는 코드가 준비됐을 뿐이다. 그 구분을 문장으로 분명히 하라.

배포 절차를 한 문단 더한다. `railway.json`이 빌드와 배포를 정하고, `preDeployCommand`가 마이그레이션을 돌리며, 프로젝트 생성과 변수 입력은 사람이 한다는 것을 적고 `docs/user-intervention.md` 3번을 가리킨다.

## Acceptance Criteria

```bash
# 1) 고장을 전부 되돌렸다
git diff --quiet HEAD -- src/
git diff --quiet HEAD -- test/
git diff --quiet HEAD -- prisma/

# 2) 고장 실험 기록이 남았다
test -f tasks/1-slack-and-deploy/break-it.md
grep -q 'ON CONFLICT' tasks/1-slack-and-deploy/break-it.md
grep -q 'timingSafeEqual' tasks/1-slack-and-deploy/break-it.md
grep -q '멱등키' tasks/1-slack-and-deploy/break-it.md

# 3) 기획안 9장의 5단계 행 상태 칸이 끝으로 바뀌었다
python3 -c "
row = [l for l in open('docs/product-plan.md') if l.startswith('| 5. Slack과 배포')]
assert len(row) == 1, row
cells = [c.strip() for c in row[0].strip().strip('|').split('|')]
assert cells[-1] == '끝', cells
"
grep -q 'Railway Postgres PITR의 플랜 조건' docs/product-plan.md

# 4) README가 갱신됐다
grep -q '0006' README.md
grep -q 'slack-link' README.md
grep -q 'SLACK_SIGNING_SECRET' README.md
grep -q 'railway.json' README.md
grep -q 'user-intervention' README.md

# 5) 사람이 할 일 목록은 그대로 남아 있다
test "$(grep -c '^- \[ \]' docs/user-intervention.md)" -ge 5

# 6) 도메인 불변
git diff --quiet HEAD -- src/domain/

# 7) 전부 통과한다
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
pnpm test:cov
```

1번이 이 phase의 핵심 AC다. 고장이 하나라도 남아 있으면 실패다.

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 통과하면 `tasks/1-slack-and-deploy/index.json`의 phase 7 status를 `"completed"`로 바꿔라.

세 번 고쳐도 통과하지 못하면 status를 `"error"`로 바꾸고, `"error_message"`에 어떤 명령이 어떤 출력으로 실패했는지 실제 출력을 근거로 적어라.

**고장을 되돌리지 못한 채로 끝내지 마라.** 그 경우에도 status를 `"error"`로 적고 무엇이 남았는지 밝혀라.

AC 통과와 index.json 갱신을 마쳤으면 커밋하라. 메시지는 `test(slack-and-deploy): verify the tests catch the failures they claim to`로 한다.

## 하지 말아야 할 것

- **고장을 남겨 두지 마라.** 되돌린 것을 `git diff`로 확인한다.
- **테스트가 고장을 잡지 못했는데 잡았다고 적지 마라.** 잡지 못했으면 테스트를 고쳐서 잡히게 만든 뒤 그 사실을 적는다.
- **고장을 잡으려고 테스트를 느슨하게 고치지 마라.** 방향이 반대다.
- **"부모가 브리프를 받고 있다"라고 쓰지 마라.** Slack 앱도 Railway 프로젝트도 아직 없다.
- **PITR 플랜 조건을 아는 것처럼 쓰지 마라.**
- **`docs/user-intervention.md`의 체크박스를 지우거나 체크하지 마라.** 사람이 한 일이 없다.
- **`src/`, `test/`, `prisma/`를 최종적으로 바꾸지 마라.** 이 phase의 산출물은 문서와 실험 기록이다.
- **`src/domain`을 고치지 마라.** 다섯 단계 동안 한 줄도 바뀌지 않았고, 그것이 README에 적을 사실이다.
- **`tasks/` 안의 다른 파일을 고치지 마라.** `tasks/1-slack-and-deploy/index.json`의 phase 7 status 갱신과 `break-it.md` 생성만 한다.
