# 문서 지도

문서마다 축이 하나다. 같은 내용을 두 문서에 적지 않는다. 새 문서를 만들기 전에 이 표에 자리가 있는지 확인하고, 없으면 `scripts/doc-paths.json` 허용 목록을 사용자가 먼저 연다.

| 문서 | 축 | 담는 것 |
|---|---|---|
| `product-plan.md` | 무엇과 왜 | 도메인 규칙, MCP 도구, 아키텍처, 구현 단계, 미정 사항 |
| `adr/NNNN-slug.md` | 왜 | 되돌리기 어려운 결정. 상태와 결정일 머리, 맥락, 결정, 근거, 검토한 대안, 대가 |
| `user-intervention.md` | 사람 | CLI로 끝나지 않는 일의 체크리스트. 끝난 항목도 지우지 않는다 |
| `backlog.md` | 입력 | 사용자가 적는 요구 한 줄 목록. ADR이나 phase로 옮기면 지운다 |
| `../README.md` | 사람 | 설치, 실행, 서버에 붙기, 배포 |
| `../AGENTS.md` | 규약 | 계층, 금지, 검증, 하네스. 50줄 상한 |
| `../tasks/{id}-{name}/` | 스펙 | phase 파일, docs-diff, break-it 보고서. `state.json`과 세션 출력은 gitignore |
| `../prompts/` | 기록 | 사람이 친 프롬프트 원문과 task 규격(`task-create.md`) |

## 러너 worktree

무인 세션은 `.env`를 읽을 수 있으므로 `.env`가 없는 별도 worktree에서 실행한다. 통합 테스트는 Testcontainers라 `.env`가 필요 없다.

```bash
git worktree add ../help-babyfood-harness -b harness/<task-name>
cd ../help-babyfood-harness
pnpm install --frozen-lockfile && pnpm prisma:generate
python3 scripts/harness/preflight.py
python3 scripts/harness/run_phases.py <id>-<task-name>
```

task가 끝나면 원래 트리에서 `harness/<task-name>` 브랜치를 검토하고 합친 뒤 `git worktree remove ../help-babyfood-harness`로 정리한다.
