"""하네스 스크립트가 함께 쓰는 것들."""

import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))


def find_project_root() -> Path:
    """.git이 있는 디렉터리를 만날 때까지 위로 올라간다."""
    current = Path(__file__).resolve().parent
    while current != current.parent:
        if (current / ".git").exists():
            return current
        current = current.parent
    raise RuntimeError("프로젝트 루트를 찾지 못했습니다(.git 없음)")


def now_iso() -> str:
    """2026-09-23T01:20:41+0900. 서비스 시간대와 같은 Asia/Seoul로 적는다."""
    return datetime.now(KST).strftime("%Y-%m-%dT%H:%M:%S%z")


def git(*args: str, cwd: Path | None = None) -> subprocess.CompletedProcess:
    root = cwd or find_project_root()
    return subprocess.run(["git", *args], cwd=str(root), capture_output=True, text=True)
