#!/usr/bin/env python3
"""
phase를 시작해도 되는지 먼저 본다.

무인 세션은 막히면 타임아웃까지 매달린다. Docker가 없는데 통합 테스트를 AC로 가진
phase를 시작하면 30분을 버리므로, 시작 전에 확인하고 이유를 남기며 멈춘다.

Usage: python3 scripts/preflight.py [--require-docker] [--require-clean-tree]
"""

import shutil
import subprocess
import sys

from _utils import find_project_root, git

ROOT = find_project_root()

MIN_NODE_MAJOR = 24


def check(name: str, ok: bool, detail: str) -> bool:
    print(f"  {'OK  ' if ok else 'FAIL'} {name}: {detail}")
    return ok


def node_version() -> tuple[bool, str]:
    if shutil.which("node") is None:
        return False, "node를 찾을 수 없습니다"
    raw = subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip()
    try:
        major = int(raw.lstrip("v").split(".")[0])
    except ValueError:
        return False, f"버전을 읽지 못했습니다: {raw}"
    return major >= MIN_NODE_MAJOR, f"{raw} (필요: {MIN_NODE_MAJOR} 이상)"


def pnpm_present() -> tuple[bool, str]:
    if shutil.which("pnpm") is None:
        return False, "pnpm을 찾을 수 없습니다"
    raw = subprocess.run(["pnpm", "--version"], capture_output=True, text=True).stdout.strip()
    return True, raw


def docker_running() -> tuple[bool, str]:
    if shutil.which("docker") is None:
        return False, "docker를 찾을 수 없습니다"
    result = subprocess.run(
        ["docker", "info", "--format", "{{.ServerVersion}}"], capture_output=True, text=True
    )
    if result.returncode != 0:
        return False, "docker 데몬이 응답하지 않습니다. Docker Desktop을 켜세요"
    return True, f"데몬 {result.stdout.strip()}"


def tree_clean() -> tuple[bool, str]:
    dirty = git("status", "--porcelain").stdout.strip()
    if dirty:
        first = dirty.splitlines()[:3]
        return False, "작업 트리가 더럽습니다: " + ", ".join(line[3:] for line in first)
    return True, "깨끗합니다"


def main() -> None:
    require_docker = "--require-docker" in sys.argv
    require_clean = "--require-clean-tree" in sys.argv

    print("프리플라이트")
    results = [
        check("node", *node_version()),
        check("pnpm", *pnpm_present()),
    ]
    if require_docker:
        results.append(check("docker", *docker_running()))
    if require_clean:
        results.append(check("작업 트리", *tree_clean()))

    if not all(results):
        print("\n통과하지 못했습니다. 위 항목을 고친 뒤 다시 실행하세요.")
        sys.exit(1)
    print("\n통과했습니다.")


if __name__ == "__main__":
    main()
