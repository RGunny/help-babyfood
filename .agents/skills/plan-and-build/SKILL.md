---
name: plan-and-build
description: 요구사항을 받아 문서 확인, 기술 검토, phase 분해, task 파일 생성, 러너 실행 또는 사용자 제출까지 진행한다. 새 기능이나 작업 단계를 phase 단위로 맡길 때 쓴다.
---

$ARGUMENTS

위 요구사항을 아래 순서로 진행한다. 새 브랜치를 만들지 않고 현재 브랜치에서 작업한다. 실행 모드는 `harness.json`의 `mode`를 따른다. `runner`면 6단계에서 러너를 실행하고, `supervised`면 6단계에서 phase 파일을 사용자에게 제출한다.

1. 현재 상태를 파악한다. `AGENTS.md`, `docs/README.md`(문서 지도), 기획 문서, ADR 전부, 요구사항과 관련된 코드를 읽는다. 이미 있는 것을 모르고 계획하면 같은 기능을 두 번 만들게 된다.
2. tech-critic-lead에게 제안을 보낸다. 요구사항, 기획 근거 조항, 구현 개요, 수정할 계층을 함께 보낸다. 거부되면 지적을 반영해 다시 보낸다. 같은 사유로 두 번 거부되면 다른 방안으로 바꾸거나 사용자에게 보고한다. 승인 없이 다음 단계로 가지 않는다.
3. phase 분해 초안을 만든다. `prompts/task-create.md`를 먼저 읽는다. phase 0은 항상 문서 수정이고, 나머지는 계층 하나씩 나누며, phase마다 `scope`(수정 가능한 경로)를 정한다. 초안과 논의할 점을 tech-critic-lead에게 다시 보낸다.
4. 테스트 전략을 정한다. 어떤 규칙을 단위 테스트로, 어떤 것을 통합 테스트로 검증할지, 마지막에 무엇을 일부러 망가뜨려 테스트가 잡아내는지 확인할지 적는다. 이것도 tech-critic-lead에게 보낸다.
5. task 파일을 만든다. `prompts/task-create.md`의 형식대로 `tasks/{id}-{name}/`을 만든다. AC는 `harness.json`의 verify 명령과 실행 가능한 명령으로만 쓴다. 승인 조건은 해당 phase의 AC나 "하지 말아야 할 것"에 옮겨 적는다. `python3 scripts/harness/run_phases.py {id}-{name} --dry-run`으로 스펙을 검증한다.
6. 실행한다.
   - `runner`: `python3 scripts/harness/run_phases.py {id}-{name}`. 실패하면 `tasks/{id}-{name}/state.json`의 `error_message`와 `phase{N}-output.json`으로 원인을 확인하고, phase 파일을 고친 뒤 `--resume`한다.
   - `supervised`: task 디렉터리 경로와 phase 목록, critic 판정문을 사용자에게 제출하고 기다린다. 사용자가 phase를 지정하면 그 phase 파일을 읽고 같은 세션에서 수행한 뒤 AC를 실행해 결과를 보고한다. 커밋은 사용자 승인 뒤에만 한다.

## 규칙

- `runner` 모드에서는 사용자에게 질문하지 않는다. 판단이 필요하면 tech-critic-lead와 결정한다. `supervised` 모드에서는 task 생성까지 질문 없이 진행하고, 실행 전에 한 번 멈춘다.
- 모든 구현은 로컬 CLI로 완료할 수 있어야 한다. 웹 UI에서 해야 하는 일이 있으면 CLI로 대체할 방법을 먼저 찾는다.
- 사람이 직접 해야 하는 일이 남으면 멈추지 않고 `docs/user-intervention.md`에 적고 넘어간다.
- `frozen_paths`에 있는 경로를 수정해야 하면 그 이유를 phase 파일에 적고 `unfreeze`를 선언하며, tech-critic-lead의 승인을 따로 받는다.
