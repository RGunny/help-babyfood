#!/usr/bin/env python3
"""
phase 0이 문서를 어떻게 고쳤는지 diff로 뽑아 둔다.

뒤따르는 구현 phase는 새 세션이라 앞 phase의 대화를 모른다. 문서 전체를 다시 읽는
것과 "이번 task가 문서의 무엇을 바꿨는가"를 아는 것은 다른 일이고, 후자가 이 파일이다.

Usage: python3 scripts/gen-docs-diff.py <task-dir> <baseline-commit>
"""

import sys
from pathlib import Path

from _utils import find_project_root, git

ROOT = find_project_root()

# 이 저장소에서 "문서"는 docs/와 README.md다. README에 계층과 지금 되는 것이 적혀 있어
# 구현 phase가 읽어야 할 변경이 거기에도 생긴다.
DOC_PATHS = ["docs/", "README.md"]


def changed_files(baseline: str) -> list[str]:
    out = git("diff", baseline, "--name-only", "--", *DOC_PATHS).stdout
    return [line for line in out.strip().splitlines() if line]


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: python3 scripts/gen-docs-diff.py <task-dir> <baseline-commit>")
        sys.exit(1)

    task_dir = Path(sys.argv[1])
    baseline = sys.argv[2]
    task_name = task_dir.name.split("-", 1)[1] if "-" in task_dir.name else task_dir.name
    target = task_dir / "docs-diff.md"

    files = changed_files(baseline)
    if not files:
        target.write_text(f"# docs-diff: {task_name}\n\n문서 변경 없음.\n")
        print("  docs-diff.md: 변경 없음")
        return

    lines = [f"# docs-diff: {task_name}\n", f"Baseline: `{baseline[:7]}`\n"]
    for path in files:
        diff = git("diff", baseline, "--", path).stdout
        lines.append(f"## `{path}`\n")
        lines.append(f"```diff\n{diff}```\n")

    target.write_text("\n".join(lines))
    print(f"  docs-diff.md: 파일 {len(files)}개")


if __name__ == "__main__":
    main()
