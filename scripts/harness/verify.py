#!/usr/bin/env python3
"""harness.json의 verify 명령 묶음을 순서대로 실행한다.

훅(pre-push), 러너, 사람이 같은 명령을 쓰는 진입점이다.

Usage: python3 scripts/harness/verify.py <fast|full|arch|...> [--root DIR]
exit 0 전부 통과, 1 하나라도 실패, 2 설정 오류
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Callable

from _utils import HarnessError, fail, find_project_root, load_config, run_shell


def run_group(group: str, config: dict, root: Path, echo: Callable[[str], None] | None = None) -> list[tuple[str, int, str]]:
    """[(command, returncode, tail)] 를 돌려준다. 첫 실패에서 멈춘다. echo가 있으면 실행할 명령을 먼저 전달한다."""
    commands = config["verify"].get(group)
    if commands is None:
        raise HarnessError(f"harness.json verify에 '{group}' 묶음을 추가하세요")
    results: list[tuple[str, int, str]] = []
    for command in commands:
        if echo:
            echo(f"  $ {command}")
        result = run_shell(command, cwd=root)
        tail = (result.stdout + result.stderr)[-2000:]
        results.append((command, result.returncode, tail))
        if result.returncode != 0:
            break
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("group")
    parser.add_argument("--root", type=Path)
    args = parser.parse_args()
    try:
        root = (args.root or find_project_root()).resolve()
        results = run_group(args.group, load_config(root), root, echo=lambda line: print(line, flush=True))
    except HarnessError as exc:
        fail(str(exc), 2)
        return
    for command, code, tail in results:
        if code != 0:
            print(tail)
            print(f"\nverify {args.group} 실패: `{command}` (exit {code})")
            sys.exit(1)
    print(f"verify {args.group} 통과 ({len(results)}개 명령)")


if __name__ == "__main__":
    main()
