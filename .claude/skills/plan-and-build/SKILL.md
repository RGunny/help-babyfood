---
name: plan-and-build
description: 요구사항을 받아 문서 확인, 기술 검토, phase 분해, task 파일 생성, 러너 실행까지 한 번에 진행한다. 새 기능이나 단계를 무인 실행으로 넘길 때 쓴다.
---

$ARGUMENTS

위 요구사항을 아래 순서로 진행한다. 새 브랜치를 만들지 않고 현재 브랜치에서 작업한다.

1. **현재 상태를 읽는다.** `docs/product-plan.md`(특히 9장 구현 단계), `README.md`, `docs/adr/` 전부, 그리고 요구사항이 닿는 코드를 읽는다. 무엇이 이미 있는지 모르고 계획하면 두 번째 사본을 만들게 된다. 4단계의 브리프가 새 도메인 함수 없이 끝난 것이 그 예다.

2. **tech-critic-lead에게 제안을 보낸다.** 요구사항, 기획안 근거 조항, 구현 스케치, 건드릴 계층을 함께 보낸다. 거부가 오면 지적을 반영해 다시 보낸다. 승인 없이 다음으로 넘어가지 않는다.

3. **phase로 쪼갠 초안을 만든다.** `prompts/task-create.md`를 먼저 정확히 읽는다. phase 0은 항상 문서다. 나머지는 계층 하나씩으로 나눈다. 초안과 함께 논의점을 tech-critic-lead에게 다시 보낸다.

4. **테스트 전략을 정한다.** 어떤 규칙을 단위로 고정하고 어떤 것을 통합으로 고정할지, 마지막에 무엇을 일부러 고장 내 잡히는지 확인할지까지 적는다. 이것도 tech-critic-lead에게 보낸다.

5. **task 파일을 만든다.** `prompts/task-create.md`의 형식과 절차대로 `tasks/{id}-{name}/`을 만든다. AC는 실행 가능한 명령으로만 쓴다.

6. **러너를 돌린다.** `python3 scripts/run-phases.py {id}-{name}`. 실패하면 `tasks/{id}-{name}/phase{N}-output.json`의 stdout으로 원인을 가리고, phase 파일을 고친 뒤 status를 pending으로 되돌려 다시 돌린다.

## 규칙

- 사용자에게 묻지 않는다. 판단이 필요하면 tech-critic-lead와 정리한다.
- 모든 구현은 로컬 CLI로 끝나야 한다. 웹에서 해야 하는 일이 있으면 CLI로 대체할 방법을 먼저 찾는다.
- 그래도 사람이 직접 해야 하는 지점이 남으면 `docs/user-intervention.md`에 적어 둔다. 무인 세션이 그 앞에서 멈추지 않고 문서로 넘기게 하기 위해서다.
- `src/domain`을 고쳐야 한다고 판단되면 그 이유를 phase 파일에 적고 tech-critic-lead의 승인을 따로 받는다. 네 단계 동안 한 줄도 바뀌지 않았다.
