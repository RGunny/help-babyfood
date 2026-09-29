#!/usr/bin/env python3
"""scripts/harness/githooks/* 를 git 훅 디렉터리로 복사한다.

패키지 매니저의 prepare 훅에 기대지 않고 이 스크립트로만 설치한다. core.hooksPath는 바꾸지 않으므로
다른 도구가 넣은 훅이 남는다.

Usage: python3 scripts/harness/install_hooks.py [--root DIR] [--uninstall]
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from _utils import HarnessError, fail, find_project_root, git

HOOK_NAMES = ("pre-commit", "pre-push")
MARKER = "# harness-hook"


def hooks_dir(root: Path) -> Path:
    rel = git("rev-parse", "--git-path", "hooks", cwd=root).stdout.strip()
    path = Path(rel)
    return path if path.is_absolute() else root / path


def install(root: Path) -> list[str]:
    source_dir = Path(__file__).resolve().parent / "githooks"
    target_dir = hooks_dir(root)
    target_dir.mkdir(parents=True, exist_ok=True)
    installed = []
    for name in HOOK_NAMES:
        src = source_dir / name
        if not src.exists():
            continue
        dest = target_dir / name
        if dest.exists() and MARKER not in dest.read_text(errors="ignore"):
            raise HarnessError(f"{dest}의 기존 훅을 합치거나 옮긴 뒤 다시 실행하세요 (하네스가 만든 훅이 아님)")
        shutil.copyfile(src, dest)
        dest.chmod(0o755)
        installed.append(str(dest))
    return installed


def uninstall(root: Path) -> list[str]:
    removed = []
    for name in HOOK_NAMES:
        dest = hooks_dir(root) / name
        if dest.exists() and MARKER in dest.read_text(errors="ignore"):
            dest.unlink()
            removed.append(str(dest))
    return removed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path)
    parser.add_argument("--uninstall", action="store_true")
    args = parser.parse_args()
    try:
        root = (args.root or find_project_root()).resolve()
        paths = uninstall(root) if args.uninstall else install(root)
    except HarnessError as exc:
        fail(str(exc), 2)
        return
    verb = "제거" if args.uninstall else "설치"
    for path in paths:
        print(f"  {verb}: {path}")
    if not paths:
        print(f"  {verb}할 훅이 없습니다")


if __name__ == "__main__":
    main()
