# Task 생성 규격

구현 계획이 정해진 뒤, phase 단위로 실행할 task 파일을 만드는 규격이다.

phase마다 새 세션에서 실행되므로 앞 phase의 대화는 남지 않는다. 따라서 phase 파일에는 그 파일만 읽고 작업을 끝낼 수 있을 만큼의 정보를 적는다. "앞에서 논의한 대로" 같은 표현은 새 세션에서 의미가 없다.

무인 실행(`harness.json`의 `mode: "runner"`)에서는 도구 호출이 아니라 phase 파일 단위로 승인한다. 세션은 저장소 전체를 수정할 수 있으므로, 러너가 세션의 보고와 별개로 scope 밖 변경, 동결 경로 변경, verify 실패를 검사한다. 감독 실행(`mode: "supervised"`)에서는 사람이 같은 파일을 대화 세션에 전달한다.

## 0. task id와 이름

- id는 사용자가 지정하지 않으면 `tasks/index.json`의 마지막 id에 1을 더한 값이다.
- 이름은 kebab-case 한두 단어로 목적을 나타낸다.
- 디렉터리는 `tasks/{id}-{name}`.

## 1. `tasks/index.json` (task 목록, 추적)

```json
{
  "tasks": [
    { "id": 1, "name": "slack-and-deploy", "dir": "1-slack-and-deploy", "created_at": "2026-09-23T01:07:10+0900" }
  ]
}
```

진행 상태는 여기에 적지 않고 task별 `state.json`에만 기록한다.

## 2. `tasks/{id}-{name}/index.json` (스펙, 추적)

```json
{
  "project": "help-babyfood",
  "task": "slack-and-deploy",
  "prompt": "<이 task를 시작할 때 사용자가 친 원문>",
  "phases": [
    { "phase": 0, "name": "docs", "scope": ["docs/", "README.md"] },
    { "phase": 1, "name": "application", "scope": ["src/application/", "test/"], "requires": ["docker"] },
    { "phase": 2, "name": "domain-rule", "scope": ["src/domain/", "test/"], "unfreeze": ["src/domain/"], "model": "<정확한 모델 id>" }
  ]
}
```

- `phase`: 정수 또는 `"1b"` 같은 문자열. 파일 이름은 `phase{값}.md`다.
- `scope`: 이 phase가 만들거나 수정할 수 있는 경로. 필수다. 러너는 세션이 끝난 뒤 `git status`의 변경 경로가 모두 scope 안에 있는지 검사하고, 하나라도 벗어나면 phase를 error로 기록한다. 커밋 대상도 이 경로다.
- `requires`: 이 phase를 시작하기 전에 확인할 preflight 항목. 문법은 `scripts/harness/preflight.py`에 있다. AC에 통합 테스트가 있으면 `["docker"]`를 넣는다.
- `unfreeze`: `harness.json`의 `frozen_paths` 중 이 phase에서 수정을 허용할 경로. 허용하는 이유는 phase 파일 본문에 적는다.
- `model`: 이 phase만 다른 모델로 실행할 때 지정한다. 별칭이 아니라 정확한 id를 쓴다.

러너는 `state.json`(status, attempts, cost)과 `phase{N}-output.json`(세션 원문)을 기록하며, 둘 다 gitignore 대상이다. 세션은 이 파일들을 수정하지 않고 마지막 응답의 JSON(`status`, `summary`, `error_message`)으로 결과를 보고한다.

## 3. `tasks/{id}-{name}/docs-diff.md`

phase 0이 끝나면 러너가 `scripts/harness/gen_docs_diff.py`로 생성한다. 사람이나 세션이 직접 작성하지 않는다. 이후 phase의 "사전 준비"에 이 파일을 읽도록 적는다. 감독 실행에서는 phase 0이 끝난 뒤 사람이 같은 명령을 실행한다.

## 4. `tasks/{id}-{name}/phase{N}.md`

```markdown
# Phase N: <이름>

## 사전 준비

먼저 아래를 읽고 설계 의도를 파악하라.

- AGENTS.md
- docs/<기획 문서> (특히 N장)
- docs/<ADR 디렉터리>/<번호>-....md
- tasks/{id}-{name}/docs-diff.md
- <이번 phase가 고칠 파일과 그 주변>

## 작업 내용

<파일 경로, 시그니처, 규칙. 구현 방법은 세션에 맡기되 설계 의도상 바뀌면 안 되는 것은 명시한다>

## Acceptance Criteria

\`\`\`bash
<harness.json verify.fast의 명령들>
grep -q "<있어야 하는 리터럴>" <파일>
! grep -rn "<없어야 하는 import>" <디렉터리>
git diff --quiet "$HARNESS_BASELINE" -- <바뀌면 안 되는 경로>
\`\`\`

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 통과하면 status를 `completed`로 보고하라.
세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- <금지 항목. "조심해라" 대신 "X를 하지 마라. 이유: Y">
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
```

### phase 파일 작성 원칙

1. phase 0은 문서 수정이다. 기획 문서, ADR, README를 먼저 고치고 코드는 수정하지 않는다. 문서가 먼저 바뀌어야 이후 phase가 읽을 기준이 생긴다.
2. 필요한 정보는 모두 phase 파일 안에 적는다. 다른 파일 경로는 읽을 대상을 가리키는 용도이고, 지시 자체는 phase 파일에 있어야 한다.
3. 한 phase에서는 한 계층만 수정한다. 도메인, 영속화, 어댑터를 한 phase에서 함께 고치면 실패했을 때 원인 위치를 구분할 수 없다. `scope`가 그 경계다.
4. AC는 실행 가능한 명령으로만 쓴다. "정상 동작한다"는 AC가 아니다. 명령은 `harness.json`의 `verify`에서 가져오고, grep은 금지 범위와 리터럴 확인에만 쓴다.
5. 변경 금지 검사는 `$HARNESS_BASELINE`을 기준으로 한다. 세션이 커밋하지 않으므로 HEAD를 써도 되지만, 러너가 설정하는 baseline을 쓰면 여러 phase가 지나도 기준이 같다.
6. 동결 경로는 기본적으로 수정할 수 없다. `harness.json`의 `frozen_paths`는 phase가 `unfreeze`로 허용하지 않는 한 러너가 baseline과 비교해 검사한다. 허용하는 phase는 이유를 본문에 적고 critic의 승인을 따로 받는다.
7. 테스트는 저장소의 관례를 따른다. 테스트 이름, 통합 테스트 위치, Testcontainers 조건은 AGENTS.md와 테스트 전략 문서에 있다. 마지막에 핵심 로직을 일부러 망가뜨려 테스트가 실패하는지 확인하는 phase(`break-it`)를 두면, 통과한 테스트가 실제로 검증하고 있는지까지 확인할 수 있다. 망가뜨리기 전의 기준점은 `git stash`가 아니라 커밋(러너 모드에서는 앞 phase의 커밋)으로 둔다.
8. 금지 사항은 구체적으로 적는다. 무인 세션은 눈에 띄는 다른 문제까지 고치려 하므로, 범위 밖 파일을 이름으로 적어 금지하고 `scope`로도 차단한다.

## 5. 러너

```bash
python3 scripts/harness/run_phases.py {id}-{name} --dry-run   # 스펙 검증과 phase 목록
python3 scripts/harness/run_phases.py {id}-{name}             # 다음 pending phase부터
python3 scripts/harness/run_phases.py {id}-{name} --resume    # error phase를 같은 세션으로 이어서
python3 scripts/harness/run_phases.py {id}-{name} --abort --yes   # baseline으로 되돌린다
```

러너의 동작 순서는 다음과 같다.

1. 잠금을 얻고 preflight(`harness.json` 항목과 미커밋 변경 없음)를 검사한다.
2. 첫 실행이면 baseline(HEAD)을 `state.json`에 기록한다.
3. pending phase마다 `requires`의 preflight를 검사하고, 프리앰블과 phase 파일 본문을 새 세션의 프롬프트로 전달한다. 파일 경로가 아니라 내용을 전달한다. 환경 변수 `HARNESS_HEADLESS=1`, `HARNESS_BASELINE`, `HARNESS_TASK`, `HARNESS_PHASE`를 설정한다.
4. 세션의 구조화 보고를 받는다. 전송 오류면 `limits.retries`만큼 재시도한다.
5. 보고 내용과 무관하게 scope 밖 변경, 동결 경로 변경, `verify_after_phase` 묶음을 검사한다. 하나라도 실패하면 error로 기록한다.
6. phase 0이 끝나면 docs-diff를 생성한다. scope 경로를 stage해 커밋하며 제목은 `docs(task): phase 0 docs`, `feat(task): phase N name`, 본문은 세션의 summary다.
7. 끝나면 누적 비용과 턴 수를 출력한다.

실패하면 `state.json`의 `error_message`와 `phase{N}-output.json`을 확인한다. phase 파일을 고친 뒤 `--resume`으로 같은 세션을 이어서 실행하거나, `--abort --yes`로 baseline으로 되돌린다. 인프라 문제(`error_kind: infra`)면 phase 파일을 고치지 않고 `--resume`한다.
