#!/usr/bin/env python3
"""phase 0의 문서 변경을 diff 파일로 저장한다.

뒤따르는 phase는 새 세션에서 이 파일로 이번 task의 문서 변경만 읽는다. 대상 경로는 harness.json의 docs.diff_paths다.

Usage: python3 scripts/harness/gen_docs_diff.py <task-dir> <baseline-commit> [--root DIR]
"""

from __future__ import annotations

import argparse
from pathlib import Path

from _utils import DOCS_DIFF_FILE, HarnessError, fail, find_project_root, git, git_lines, load_config


def write_docs_diff(task_dir: Path, baseline: str, root: Path, diff_paths: list[str]) -> int:
    task_name = task_dir.name.split("-", 1)[1] if "-" in task_dir.name else task_dir.name
    target = task_dir / DOCS_DIFF_FILE
    files = git_lines("diff", baseline, "--name-only", "--", *diff_paths, cwd=root)
    if not files:
        target.write_text(f"# docs-diff: {task_name}\n\n문서 변경 없음.\n")
        return 0
    lines = [f"# docs-diff: {task_name}\n", f"Baseline: `{baseline[:7]}`\n"]
    for path in files:
        diff = git("diff", baseline, "--", path, cwd=root).stdout
        lines.append(f"## `{path}`\n")
        lines.append(f"```diff\n{diff}```\n")
    target.write_text("\n".join(lines))
    return len(files)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("task_dir", type=Path)
    parser.add_argument("baseline")
    parser.add_argument("--root", type=Path)
    args = parser.parse_args()
    try:
        root = (args.root or find_project_root()).resolve()
        task_dir = args.task_dir if args.task_dir.is_absolute() else root / args.task_dir
        count = write_docs_diff(task_dir, args.baseline, root, load_config(root)["docs"]["diff_paths"])
    except HarnessError as exc:
        fail(str(exc), 2)
        return
    print(f"  {DOCS_DIFF_FILE}: {'변경 없음' if count == 0 else f'파일 {count}개'}")


if __name__ == "__main__":
    main()
