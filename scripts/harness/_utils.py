"""하네스 스크립트가 공유하는 설정 읽기, git 호출, 파일 입출력.

프로젝트에는 scripts/harness/ 아래로 복사된다. 표준 라이브러리만 쓴다.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
MIN_PYTHON = (3, 11)
CONFIG_NAME = "harness.json"
INDEX_FILE = "index.json"
STATE_FILE = "state.json"
DOCS_DIFF_FILE = "docs-diff.md"


class HarnessError(Exception):
    """사용자에게 그대로 보여 줄 실패 사유."""


def require_python() -> None:
    if sys.version_info < MIN_PYTHON:
        found = ".".join(str(v) for v in sys.version_info[:3])
        raise HarnessError(f"python3 {MIN_PYTHON[0]}.{MIN_PYTHON[1]} 이상을 쓰세요 (현재 {found}, {sys.executable})")


def find_project_root(start: Path | None = None) -> Path:
    """.git(디렉터리 또는 worktree 파일)이 있는 곳까지 위로 올라간다."""
    current = (start or Path.cwd()).resolve()
    while True:
        if (current / ".git").exists():
            return current
        if current == current.parent:
            raise HarnessError(".git이 있는 디렉터리 안에서 실행하거나 --root를 넘기세요")
        current = current.parent


def load_config(root: Path) -> dict:
    path = root / CONFIG_NAME
    if not path.exists():
        raise HarnessError(f"{CONFIG_NAME}을 프로젝트 루트에 만드세요: {path}")
    try:
        config = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise HarnessError(f"{CONFIG_NAME}의 JSON 오류를 고치세요: {exc}") from exc
    for key in ("project", "verify", "preflight", "docs"):
        if key not in config:
            raise HarnessError(f"{CONFIG_NAME}에 '{key}' 키를 넣으세요")
    config.setdefault("mode", "runner")
    config.setdefault("frozen_paths", [])
    config.setdefault("limits", {})
    config.setdefault("verify_after_phase", "fast")
    config.setdefault("commit", {})
    config["limits"] = {"phase_timeout_s": 2700, "budget_usd": 5.0, "retries": 2, **config["limits"]}
    config["docs"].setdefault("diff_paths", ["docs/", "README.md"])
    config["docs"].setdefault("allowlist", "scripts/doc-paths.json")
    return config


def output_file_name(phase_id: str) -> str:
    """세션 원문을 남기는 파일 이름. 예: phase0-output.json"""
    return f"phase{phase_id}-output.json"


def now_iso() -> str:
    """Asia/Seoul 기준 ISO 8601 문자열. 예: 2026-09-23T01:20:41+0900"""
    return datetime.now(KST).strftime("%Y-%m-%dT%H:%M:%S%z")


def git(*args: str, cwd: Path, check: bool = True) -> subprocess.CompletedProcess:
    """git을 실행한다. check=True면 실패를 HarnessError로 올린다."""
    result = subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True)
    if check and result.returncode != 0:
        raise HarnessError(f"git {' '.join(args)} 실패({result.returncode}): {result.stderr.strip()}")
    return result


def git_lines(*args: str, cwd: Path) -> list[str]:
    out = git(*args, cwd=cwd).stdout
    return [line.rstrip("\n") for line in out.splitlines() if line.strip()]


def run_shell(command: str, cwd: Path, env: dict | None = None) -> subprocess.CompletedProcess:
    """harness.json의 verify 명령처럼 사람이 쓴 한 줄 명령을 실행한다."""
    merged = {**os.environ, **(env or {})}
    return subprocess.run(command, shell=True, cwd=str(cwd), capture_output=True, text=True, env=merged)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text())


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def fail(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    sys.exit(code)
