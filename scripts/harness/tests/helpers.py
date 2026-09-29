"""테스트가 공유하는 임시 git 저장소와 가짜 claude 설정."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

FAKE_CLAUDE = Path(__file__).resolve().parent / "fake_claude.py"

BASE_CONFIG = {
    "project": "fixture",
    "mode": "runner",
    "model": "fake-model",
    "verify": {"fast": ["true"], "full": ["true"], "arch": ["true"]},
    "verify_after_phase": "fast",
    "preflight": ["python3>=3.11"],
    "docs": {"diff_paths": ["docs/", "README.md"], "allowlist": "scripts/doc-paths.json"},
    "frozen_paths": ["src/domain/"],
    "limits": {"phase_timeout_s": 60, "budget_usd": 1, "retries": 1},
    "commit": {"mode": "auto", "language": "en"},
}


def sh(args: list[str], cwd: Path, env: dict | None = None) -> subprocess.CompletedProcess:
    merged = {**os.environ, **(env or {})}
    return subprocess.run(args, cwd=str(cwd), capture_output=True, text=True, env=merged)


def git(*args: str, cwd: Path) -> str:
    result = sh(["git", *args], cwd)
    if result.returncode != 0:
        raise AssertionError(f"git {' '.join(args)}: {result.stderr}")
    return result.stdout


class Repo:
    """harness.json과 첫 커밋이 있는 임시 저장소. with 문으로 쓰면 끝날 때 지운다."""

    def __init__(self, config: dict | None = None):
        self.dir = Path(tempfile.mkdtemp(prefix="harness-test-"))
        self.root = self.dir / "repo"
        self.root.mkdir()
        git("init", "-q", "-b", "main", cwd=self.root)
        git("config", "user.email", "t@example.com", cwd=self.root)
        git("config", "user.name", "tester", cwd=self.root)
        git("config", "commit.gpgsign", "false", cwd=self.root)
        self.write("harness.json", json.dumps(config or BASE_CONFIG, indent=2))
        self.write("README.md", "# fixture\n")
        self.write("docs/guide.md", "guide\n")
        self.write("src/domain/rule.txt", "rule\n")
        self.write("scripts/doc-paths.json", json.dumps({"allowed": ["README.md", "AGENTS.md", "docs/**/*.md", "tasks/*/*.md"], "lineLimits": {"AGENTS.md": 3}}))
        self.write(".gitignore", "tasks/**/state.json\ntasks/**/*-output.json\n")
        self.commit("init")

    def write(self, rel: str, text: str) -> Path:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def commit(self, message: str) -> str:
        git("add", "-A", cwd=self.root)
        git("commit", "-q", "-m", message, cwd=self.root)
        return head(self)

    def add_task(self, name: str, phases: list[dict]) -> Path:
        task_dir = self.root / "tasks" / name
        task_dir.mkdir(parents=True)
        (task_dir / "index.json").write_text(json.dumps({"project": "fixture", "task": name.split("-", 1)[1], "phases": phases}, indent=2))
        for phase in phases:
            (task_dir / f"phase{phase['phase']}.md").write_text(f"# Phase {phase['phase']}\n\ndo {phase['name']}\n")
        self.commit(f"task {name}")
        return task_dir

    def run_script(self, name: str, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
        return sh([sys.executable, str(SCRIPTS_DIR / name), *args, "--root", str(self.root)], self.root, env)

    def cleanup(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    def __enter__(self) -> "Repo":
        return self

    def __exit__(self, *_) -> None:
        self.cleanup()


def head(repo: Repo) -> str:
    return git("rev-parse", "HEAD", cwd=repo.root).strip()


def log(repo: Repo) -> list[str]:
    """커밋 제목 목록. 최신이 먼저."""
    return git("log", "--format=%s", cwd=repo.root).splitlines()


def status(repo: Repo) -> str:
    return git("status", "--porcelain", cwd=repo.root)


def fake_claude_env(actions: dict, repo: Repo) -> dict:
    """HARNESS_PHASE별 가짜 claude 동작을 지정한다. actions: {"0": {"action": "completed", "write": "docs/guide.md"}}"""
    script = repo.dir / "fake-actions.json"
    script.write_text(json.dumps(actions))
    return {"CLAUDE_BIN": str(FAKE_CLAUDE), "FAKE_CLAUDE_ACTIONS": str(script)}
