# Task 생성 프롬프트

구현 계획이 컨텍스트에 있는 상태에서, 무인으로 직렬 실행할 task 파일들을 만든다.

phase는 저마다 새 Claude 세션에서 돈다. 앞 phase의 대화는 남지 않는다. 그래서 phase 파일은 **그 파일 하나만 보고 작업을 끝낼 수 있어야** 한다. "앞에서 논의한 대로" 같은 문장은 그 세션에게 아무 뜻이 없다.

무인 실행 구간에서는 승인 단위가 도구 호출이 아니라 phase 파일이다. 세션은 `--dangerously-skip-permissions`로 뜨고 저장소 전체에 쓸 수 있다. phase 파일의 "하지 말아야 할 것"과 금지 스코프 AC가 유일한 방어선이다.

---

## 0. task id와 이름

- 사용자가 정하지 않았으면 `tasks/index.json`의 마지막 `id + 1`.
- 이름은 kebab-case, 한두 단어로 목적을 드러낸다.
- 디렉터리는 `tasks/{id}-{name}`.

## 1. `tasks/index.json`

```json
{
  "tasks": [
    { "id": 0, "name": "<task-name>", "dir": "0-<task-name>", "status": "pending", "created_at": "2026-09-23T01:20:41+0900" }
  ]
}
```

`created_at`만 생성 때 적는다. `completed_at`, `failed_at`, status 전이는 러너가 적는다.

## 2. `tasks/{id}-{name}/index.json`

```json
{
  "project": "help-babyfood",
  "task": "<task-name>",
  "prompt": "<이 task를 시작할 때 사용자가 친 원문>",
  "totalPhases": 3,
  "created_at": "2026-09-23T01:20:41+0900",
  "phases": [
    { "phase": 0, "name": "docs", "status": "pending" },
    { "phase": 1, "name": "<slug>", "status": "pending", "requiresDocker": true }
  ]
}
```

- `requiresDocker`는 그 phase의 AC에 `pnpm test:int`나 `pnpm test:cov`가 있을 때 넣는다. 러너가 phase 시작 전에 Docker 데몬을 확인하고, 없으면 30분을 버리는 대신 즉시 멈춘다.
- phase-level 타임스탬프는 러너가 적는다. 생성 때 넣지 않는다.

## 3. `tasks/{id}-{name}/docs-diff.md`

phase 0이 끝나면 러너가 `scripts/gen-docs-diff.py`로 만든다. **직접 쓰지 않는다.** 뒤따르는 phase의 "사전 준비"에서 이 파일을 읽게 한다.

## 4. `tasks/{id}-{name}/phase{N}.md`

```markdown
# Phase N: <이름>

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

\`\`\`bash
git status --porcelain
\`\`\`

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고
`tasks/{id}-{name}/index.json`의 phase N status를 `"error"`로, `error_message`에
`dirty working tree`로 적고 멈춘다.

먼저 아래를 읽고 설계 의도를 파악하라.

- docs/product-plan.md (특히 N장)
- docs/adr/NNNN-....md
- tasks/{id}-{name}/docs-diff.md
- <이번 phase가 고칠 파일과 그 주변>

## 작업 내용

<파일 경로, 시그니처, 규칙. 구현체는 세션에 맡기되 설계 의도에서 벗어나면 안 되는 것은 박아 둔다>

## Acceptance Criteria

\`\`\`bash
pnpm typecheck
pnpm lint
pnpm test
git diff --quiet HEAD -- src/domain/
\`\`\`

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 통과하면 `tasks/{id}-{name}/index.json`의 phase N
status를 `"completed"`로 바꿔라. 세 번 고쳐도 실패하면 `"error"`로 바꾸고
`"error_message"`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- <금지 항목. "조심해라" 대신 "X를 하지 마라. 이유: Y">
```

### phase 파일 작성 원칙

1. **phase 0은 문서다.** 기획안, ADR, README를 먼저 고친다. 코드는 건드리지 않는다. 문서가 먼저 바뀌어야 뒤 phase가 읽을 기준이 생긴다.
2. **자기완결.** 필요한 정보는 전부 파일 안에 적는다. 파일 경로는 읽으라고 지목하는 것이고, 지시 자체는 파일 안에 있어야 한다.
3. **계층 하나씩.** 한 phase에서 도메인과 영속화와 어댑터를 동시에 고치지 않는다. 실패했을 때 어디가 틀렸는지 가릴 수 없게 된다.
4. **AC는 실행 가능한 명령.** "정상 동작한다"는 AC가 아니다. 이 저장소에는 `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:int`, `pnpm test:cov`가 있다. grep은 금지 스코프와 리터럴 확인에만 쓴다.
5. **도메인 불변을 기본 AC로.** `git diff --quiet HEAD -- src/domain/`을 모든 phase의 AC에 넣는다. 도메인을 정말 고쳐야 하는 phase에서만 빼고, 왜 빼는지 phase 파일에 적는다.
6. **테스트는 이 저장소 방식으로.** 규칙을 한국어로 서술하는 이름을 쓴다. 통합 테스트는 `test/integration/*.int-spec.ts`이고 Testcontainers가 DB를 띄운다. 마지막에 핵심 로직을 일부러 고장 내 테스트가 잡는지 확인하는 phase를 두면, 통과한 테스트가 진짜인지까지 검증된다.
7. **하지 말아야 할 것을 구체적으로.** 무인 세션은 눈에 띄는 다른 문제를 고치려 든다. 범위 밖 파일을 이름으로 적어 막는다.

## 5. 러너

```bash
python3 scripts/run-phases.py {id}-{name}              # 기본 모델 opus
python3 scripts/run-phases.py {id}-{name} --model sonnet
python3 scripts/run-phases.py {id}-{name} --dry-run    # phase 목록과 status만
```

러너가 하는 일은 다음과 같다.

1. 다음 pending phase를 찾는다.
2. `requiresDocker`면 Docker를 확인하고, 안 되면 시작하지 않고 error로 적는다.
3. phase 파일 내용을 프리앰블과 합쳐 새 세션에 싣는다. 경로가 아니라 내용을 싣는다.
4. stdout과 stderr를 `phase{N}-output.json`에 남긴다.
5. `index.json`을 다시 읽어 status를 본다. `completed`면 다음으로, `error`면 멈춘다. `pending` 그대로면 세션이 AC를 돌리지 않았다는 뜻이므로 error로 적고 멈춘다.
6. phase마다 커밋 두 개를 만든다. 세션이 남긴 코드 변경과 러너가 만든 출력을 나눠서 적는다.

실패하면 `tasks/{id}-{name}/phase{N}-output.json`의 stdout을 본다. phase 파일을 고친 뒤 `index.json`의 status를 `pending`으로 되돌리고 다시 실행한다.
