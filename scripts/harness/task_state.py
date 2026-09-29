"""task의 스펙(index.json, 추적)과 상태(state.json, gitignore)를 읽고 쓴다.

index.json은 사람이 작성하는 스펙이고 러너는 수정하지 않는다. state.json은 러너만 기록한다.
세션은 둘 다 수정하지 않고 결과를 구조화 출력으로 보고한다.
"""

from __future__ import annotations

import fcntl
import os
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from _utils import STATE_FILE, HarnessError, git, now_iso, read_json, write_json

PHASE_STATUSES = ("pending", "completed", "error")


def new_phase_entry() -> dict:
    return {"status": "pending", "attempts": []}


@dataclass
class Phase:
    id: str
    name: str
    scope: list[str]
    requires: list[str] = field(default_factory=list)
    model: str | None = None
    unfreeze: list[str] = field(default_factory=list)

    @property
    def file_name(self) -> str:
        return f"phase{self.id}.md"


def load_phases(index: dict, task_dir: Path) -> list[Phase]:
    phases = []
    for raw in index.get("phases", []):
        if "phase" not in raw or "name" not in raw:
            raise HarnessError(f"{task_dir.name}/index.json의 phase 항목에 phase와 name을 넣으세요: {raw}")
        scope = raw.get("scope")
        if not isinstance(scope, list) or not scope:
            raise HarnessError(f"{task_dir.name}/index.json의 phase {raw['phase']}에 scope(경로 목록)를 넣으세요")
        phases.append(
            Phase(
                id=str(raw["phase"]),
                name=str(raw["name"]),
                scope=[str(p) for p in scope],
                requires=[str(r) for r in raw.get("requires", [])],
                model=raw.get("model"),
                unfreeze=[str(p) for p in raw.get("unfreeze", [])],
            )
        )
    if not phases:
        raise HarnessError(f"{task_dir.name}/index.json의 phases에 항목을 넣으세요")
    return phases


def validate_phase_files(task_dir: Path, phases: list[Phase]) -> None:
    missing = [p.file_name for p in phases if not (task_dir / p.file_name).exists()]
    if missing:
        raise HarnessError(f"{task_dir.name}에 phase 파일을 만드세요: {', '.join(missing)}")


class TaskState:
    """state.json 한 파일의 load-modify-save 래퍼."""

    def __init__(self, task_dir: Path):
        self.path = task_dir / STATE_FILE

    def load(self) -> dict:
        if not self.path.exists():
            return {"status": "pending", "phases": {}}
        return read_json(self.path)

    def save(self, data: dict) -> None:
        write_json(self.path, data)

    def phase(self, phase_id: str) -> dict:
        return self.load()["phases"].get(phase_id, new_phase_entry())

    def update_phase(self, phase_id: str, **fields) -> dict:
        with self._edit() as data:
            entry = data["phases"].setdefault(phase_id, new_phase_entry())
            entry.update(fields)
        return entry

    def add_attempt(self, phase_id: str, attempt: dict) -> None:
        with self._edit() as data:
            entry = data["phases"].setdefault(phase_id, new_phase_entry())
            entry.setdefault("attempts", []).append(attempt)

    def update_last_attempt(self, phase_id: str, **fields) -> None:
        with self._edit() as data:
            data["phases"][phase_id]["attempts"][-1].update(fields)

    def set_task(self, **fields) -> None:
        with self._edit() as data:
            data.update(fields)

    def mark_error(self, phase_id: str, message: str, kind: str = "phase") -> None:
        self.update_phase(phase_id, status="error", error_message=message, error_kind=kind, failed_at=now_iso())
        self.set_task(status="error")

    def reset_phase(self, phase_id: str) -> None:
        with self._edit() as data:
            entry = data["phases"].get(phase_id)
            if entry:
                entry["status"] = "pending"
                for key in ("error_message", "error_kind", "failed_at"):
                    entry.pop(key, None)
            data["status"] = "running"

    def next_pending(self, phases: list[Phase]) -> Phase | None:
        return self._first_with_status(phases, "pending")

    def last_error(self, phases: list[Phase]) -> Phase | None:
        return self._first_with_status(phases, "error")

    def _first_with_status(self, phases: list[Phase], status: str) -> Phase | None:
        data = self.load()
        for phase in phases:
            if data["phases"].get(phase.id, {}).get("status", "pending") == status:
                return phase
        return None

    @contextmanager
    def _edit(self):
        """load한 상태를 넘기고 블록이 끝나면 save한다."""
        data = self.load()
        yield data
        self.save(data)

    def totals(self) -> tuple[float, int]:
        cost, turns = 0.0, 0
        for entry in self.load()["phases"].values():
            for attempt in entry.get("attempts", []):
                cost += float(attempt.get("cost_usd") or 0)
                turns += int(attempt.get("turns") or 0)
        return cost, turns


class RunnerLock:
    """같은 작업 트리에서 러너가 둘 돌지 않게 하는 잠금. 잠금 파일은 .git 안에 둔다."""

    def __init__(self, root: Path):
        git_dir = Path(git("rev-parse", "--git-dir", cwd=root).stdout.strip())
        if not git_dir.is_absolute():
            git_dir = root / git_dir
        self.path = git_dir / "harness-runner.lock"
        self._fh = None

    def __enter__(self) -> "RunnerLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(self.path, "a+")
        try:
            fcntl.flock(self._fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self._fh.seek(0)
            holder = self._fh.read().strip() or "알 수 없음"
            self._fh.close()
            raise HarnessError(f"다른 러너(pid {holder})가 끝난 뒤 실행하세요. 잠금 파일: {self.path}") from exc
        self._fh.seek(0)
        self._fh.truncate()
        self._fh.write(str(os.getpid()))
        self._fh.flush()
        return self

    def __exit__(self, *_) -> None:
        if self._fh:
            fcntl.flock(self._fh, fcntl.LOCK_UN)
            self._fh.close()
            try:
                self.path.unlink()
            except FileNotFoundError:
                pass
