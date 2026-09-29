#!/usr/bin/env python3
"""phase를 시작하기 전에 실행 환경을 검사한다.

도구, 버전, Docker, 환경 변수를 세션 시작 전에 확인하고, 빠진 항목이 있으면 이유를 남기고 멈춘다.

항목 문법 (harness.json의 "preflight" 배열, phase의 "requires" 배열):
  name            PATH에서 name을 찾을 수 있다              예: pnpm
  name>=X         name --version 의 첫 숫자열이 X 이상   예: node>=24, python3>=3.11
  name=X          첫 숫자열이 X로 시작한다          예: java=21
  docker          docker 데몬이 응답한다
  DOCKER_HOST     환경 변수가 설정돼 있다
  git-clean       커밋되지 않은 변경이 없다

Usage: python3 scripts/harness/preflight.py [--items a,b,c] [--require-clean-tree] [--root DIR]
exit 0 통과, 1 실패, 2 설정 오류
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from _utils import HarnessError, fail, find_project_root, git, load_config

VERSION_RE = re.compile(r"(\d+(?:\.\d+)*)")


def parse_item(item: str) -> tuple[str, str, str]:
    """('name', op, 'X'). op는 '', '>=', '='."""
    for op in (">=", "="):
        if op in item:
            name, _, want = item.partition(op)
            return name.strip(), op, want.strip()
    return item.strip(), "", ""


def version_tuple(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in text.split("."))


def first_version(output: str) -> str | None:
    match = VERSION_RE.search(output)
    return match.group(1) if match else None


def tool_version(name: str) -> str | None:
    if name == "python3":
        return ".".join(str(v) for v in sys.version_info[:3])
    flag = "-version" if name == "java" else "--version"
    result = subprocess.run([name, flag], capture_output=True, text=True)
    return first_version(result.stdout + result.stderr)


def check_tool(name: str, op: str, want: str) -> tuple[bool, str]:
    if name != "python3" and shutil.which(name) is None:
        return False, f"{name}을(를) 찾을 수 없습니다"
    if not op:
        return True, "있음"
    found = tool_version(name)
    if found is None:
        return False, "버전을 읽지 못했습니다"
    if op == ">=":
        ok = version_tuple(found) >= version_tuple(want)
        return ok, f"{found} (필요: {want} 이상)"
    ok = found == want or found.startswith(want + ".")
    return ok, f"{found} (필요: {want})"


def check_docker() -> tuple[bool, str]:
    if shutil.which("docker") is None:
        return False, "docker를 찾을 수 없습니다"
    result = subprocess.run(["docker", "info", "--format", "{{.ServerVersion}}"], capture_output=True, text=True)
    if result.returncode != 0:
        return False, "docker 데몬이 응답하지 않습니다"
    return True, f"데몬 {result.stdout.strip()}"


def check_clean_tree(root: Path) -> tuple[bool, str]:
    dirty = git("status", "--porcelain", cwd=root).stdout.strip()
    if dirty:
        first = [line[3:] for line in dirty.splitlines()[:3]]
        return False, "커밋되지 않은 변경: " + ", ".join(first)
    return True, "변경 없음"


def run_item(item: str, root: Path) -> tuple[str, bool, str]:
    name, op, want = parse_item(item)
    if name == "docker":
        ok, detail = check_docker()
    elif name == "DOCKER_HOST":
        value = os.environ.get("DOCKER_HOST", "")
        ok, detail = (bool(value), value or "설정되지 않았습니다")
    elif name == "git-clean":
        ok, detail = check_clean_tree(root)
    else:
        ok, detail = check_tool(name, op, want)
    return item, ok, detail


def run_preflight(items: list[str], root: Path) -> list[tuple[str, bool, str]]:
    return [run_item(item, root) for item in items]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--items", help="쉼표로 구분한 항목. 없으면 harness.json의 preflight")
    parser.add_argument("--require-clean-tree", action="store_true")
    parser.add_argument("--root", type=Path)
    args = parser.parse_args()

    try:
        root = (args.root or find_project_root()).resolve()
        items = args.items.split(",") if args.items else list(load_config(root)["preflight"])
    except HarnessError as exc:
        fail(str(exc), 2)
        return
    if args.require_clean_tree:
        items.append("git-clean")

    print("프리플라이트")
    results = run_preflight(items, root)
    for item, ok, detail in results:
        print(f"  {'OK  ' if ok else 'FAIL'} {item}: {detail}")
    if not all(ok for _, ok, _ in results):
        print("\nFAIL 항목을 해결한 뒤 다시 실행하세요")
        sys.exit(1)
    print("\n프리플라이트 통과")


if __name__ == "__main__":
    main()
