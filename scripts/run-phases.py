#!/usr/bin/env python3
"""
phase 러너.

tasks/{task-dir}/index.json에서 다음 pending phase를 찾아 그 phase 파일을 통째로
프롬프트에 실어 Claude Code 세션을 띄운다. 세션이 AC를 스스로 검증하고 index.json의
status를 고치면, 러너는 그것을 읽어 다음 phase로 가거나 멈춘다.

phase마다 세션이 새로 뜬다. 앞 phase의 대화는 남지 않으므로, phase 파일은 그 파일
하나만 보고 작업을 끝낼 수 있어야 한다.

Usage:
  python3 scripts/run-phases.py <task-dir> [--model <name>] [--dry-run]
"""

import itertools
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Optional

from _utils import find_project_root, git, now_iso

ROOT = find_project_root()
TASKS_DIR = ROOT / "tasks"
TOP_INDEX_FILE = TASKS_DIR / "index.json"

# subprocess는 셸 별칭을 풀지 않는다. PATH에서 찾되 CLAUDE_BIN으로 덮어쓸 수 있다.
CLAUDE_BIN = os.environ.get("CLAUDE_BIN") or shutil.which("claude") or "claude"

# 이 저장소의 phase는 재고 원장과 날짜 계산을 건드린다. 그 둘은 틀려도 겉으로 드러나지
# 않고 숫자만 조용히 어긋나므로, 추론을 아끼지 않는 모델을 기본으로 둔다.
DEFAULT_MODEL = "opus"

PHASE_TIMEOUT_SECONDS = 2700

FALLBACK_COMMIT_TEMPLATE = "feat({task_name}): phase {phase_num} {phase_name}"
RUNNER_COMMIT_TEMPLATE = "chore({task_name}): phase {phase_num} output and timestamps"
SPINNER_CHARS = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"


# ---------------------------------------------------------------------------
# index.json
# ---------------------------------------------------------------------------

def load_index(path: Path) -> dict:
    return json.loads(path.read_text())


def save_index(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def find_next_phase(index: dict) -> Optional[dict]:
    return next((p for p in index["phases"] if p["status"] == "pending"), None)


def last_touched_phase(index: dict) -> Optional[dict]:
    return next((p for p in reversed(index["phases"]) if p["status"] != "pending"), None)


def phase_status(index_file: Path, phase_num: int) -> str:
    for phase in load_index(index_file)["phases"]:
        if phase["phase"] == phase_num:
            return phase.get("status", "pending")
    return "pending"


def stamp_phase(index_file: Path, phase_num: int, field: str) -> None:
    index = load_index(index_file)
    for phase in index["phases"]:
        if phase["phase"] == phase_num and field not in phase:
            phase[field] = now_iso()
            save_index(index_file, index)
            return


def update_top_index(task_dir_name: str, status: str) -> None:
    if not TOP_INDEX_FILE.exists():
        return
    top = load_index(TOP_INDEX_FILE)
    for task in top.get("tasks", []):
        if task.get("dir") == task_dir_name:
            task["status"] = status
            if status == "completed":
                task["completed_at"] = now_iso()
            elif status == "error":
                task["failed_at"] = now_iso()
            break
    save_index(TOP_INDEX_FILE, top)


def mark_error(index_file: Path, phase_num: int, message: str) -> None:
    index = load_index(index_file)
    for phase in index["phases"]:
        if phase["phase"] == phase_num:
            phase["status"] = "error"
            phase["error_message"] = message
            phase["failed_at"] = now_iso()
            break
    save_index(index_file, index)


# ---------------------------------------------------------------------------
# 프리플라이트
# ---------------------------------------------------------------------------

def preflight(require_docker: bool) -> Optional[str]:
    """막힐 것이 뻔한 조건을 미리 잡는다. 통과하면 None, 아니면 이유를 돌려준다."""
    args = ["python3", str(ROOT / "scripts" / "preflight.py")]
    if require_docker:
        args.append("--require-docker")
    result = subprocess.run(args, cwd=str(ROOT / "scripts"), capture_output=True, text=True)
    if result.returncode != 0:
        return result.stdout.strip() or "프리플라이트 실패"
    return None


# ---------------------------------------------------------------------------
# git
# ---------------------------------------------------------------------------

def commit_plan_files(task_name: str) -> None:
    """phase를 돌리기 전에 계획 파일부터 커밋해 둔다. 구현 diff와 섞이지 않게."""
    git("add", "tasks/", "docs/", "prompts/")
    if git("diff", "--cached", "--quiet").returncode == 0:
        return
    result = git("commit", "-m", f"docs({task_name}): add the task plan")
    print(f"  {'커밋' if result.returncode == 0 else '커밋 실패'}: 계획 파일")


def commit_phase(task_name: str, task_dir_name: str, phase_num: int, phase_name: str) -> None:
    """
    커밋 두 번.

    앞은 세션이 스스로 커밋하지 않고 남긴 코드 변경이고, 뒤는 러너가 만든 출력과
    타임스탬프다. 둘을 섞으면 "세션이 무엇을 했는가"를 diff로 읽을 수 없게 된다.
    """
    runner_files = [
        f"tasks/{task_dir_name}/phase{phase_num}-output.json",
        f"tasks/{task_dir_name}/index.json",
        # docs-diff.md도 러너가 만든다. 세션의 커밋에 섞이면 "세션이 쓴 것"처럼 보인다.
        f"tasks/{task_dir_name}/docs-diff.md",
        "tasks/index.json",
    ]

    git("add", "-A")
    for path in runner_files:
        git("reset", "HEAD", "--", path)
    if git("diff", "--cached", "--quiet").returncode != 0:
        message = FALLBACK_COMMIT_TEMPLATE.format(
            task_name=task_name, phase_num=phase_num, phase_name=phase_name
        )
        if git("commit", "-m", message).returncode != 0:
            print("  주의: 세션이 남긴 변경을 커밋하지 못했습니다")

    git("add", "-A")
    if git("diff", "--cached", "--quiet").returncode != 0:
        message = RUNNER_COMMIT_TEMPLATE.format(task_name=task_name, phase_num=phase_num)
        if git("commit", "-m", message).returncode != 0:
            print("  주의: 러너 출력을 커밋하지 못했습니다")


# ---------------------------------------------------------------------------
# 진행 표시
# ---------------------------------------------------------------------------

class Spinner:
    """
    돌아가는 동안 뭔가 살아 있다는 것을 보인다.

    터미널이 아닌 곳으로 출력이 가면 돌리지 않는다. 회전자는 같은 줄을 지우고 다시 쓰는
    방식이라, 파일이나 파이프로 가면 프레임이 전부 쌓여 로그가 그것으로만 찬다.
    """

    def __init__(self, message: str):
        self._message = message
        self._enabled = sys.stderr.isatty()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._spin, daemon=True)
        self._start = 0.0

    def _spin(self) -> None:
        chars = itertools.cycle(SPINNER_CHARS)
        while not self._stop.is_set():
            elapsed = int(time.monotonic() - self._start)
            sys.stderr.write(f"\r{next(chars)} {self._message} [{elapsed}s]")
            sys.stderr.flush()
            self._stop.wait(0.1)
        sys.stderr.write("\r" + " " * (len(self._message) + 24) + "\r")
        sys.stderr.flush()

    def __enter__(self) -> "Spinner":
        self._start = time.monotonic()
        if self._enabled:
            self._thread.start()
        else:
            print(f"  시작 {self._message}", flush=True)
        return self

    def __exit__(self, *_) -> None:
        if self._enabled:
            self._stop.set()
            self._thread.join()

    @property
    def elapsed(self) -> float:
        return time.monotonic() - self._start


# ---------------------------------------------------------------------------
# 세션 실행
# ---------------------------------------------------------------------------

def build_preamble(task_dir_name: str, task_name: str) -> str:
    commit_example = FALLBACK_COMMIT_TEMPLATE.format(
        task_name=task_name, phase_num="N", phase_name="<phase-name>"
    )
    return f"""당신은 help-babyfood 프로젝트의 개발자입니다. 아래 phase의 작업을 수행하세요.

이 세션은 무인으로 돕니다. 사용자에게 묻지 말고, phase 파일에 적힌 것을 근거로 직접 판단하세요.
판단이 갈리는 지점은 phase 파일의 지시가 우선입니다.

## 이 저장소의 규약

1. `src/domain`은 프레임워크, DB, 시스템 시계를 모릅니다. 현재 시각도 인자로 받습니다.
   네 단계 동안 한 줄도 바뀌지 않았고, phase 파일이 명시적으로 허용하지 않으면 건드리지 않습니다.
2. `src/application`은 NestJS를 모릅니다. 서비스는 생성자에 포트를 받는 평범한 클래스이고
   모듈이 `useFactory`로 조립합니다. 서비스에 데코레이터를 달지 않습니다.
3. `src/mcp`와 `src/scheduler`는 어댑터입니다. 재고 규칙을 다시 쓰지 않고 애플리케이션을 부릅니다.
4. 현재 시각은 `ClockPort`로만 들어옵니다. 벽시계는 `now()`와 `today()`, 절대 시각은 `instant()`입니다.
5. 테스트 이름은 규칙을 한국어로 서술합니다. 기존 테스트를 깨뜨리지 않습니다.
6. 문서를 쓸 때는 주장에 근거를 붙이고, 확인하지 않은 것을 단정하지 않습니다.

## 작업 규칙

1. 작업 전에 phase 파일이 지목한 문서와 코드를 반드시 읽으세요. 설계 의도를 모르고 고치면
   같은 규칙의 두 번째 사본이 생깁니다.
2. phase에 명시된 것만 하세요. 눈에 띄는 다른 문제는 고치지 말고 그대로 두세요.
3. AC를 직접 실행해 검증하세요. 통과하면 `tasks/{task_dir_name}/index.json`의 해당 phase
   status를 `"completed"`로 바꾸세요.
4. 세 번 고쳐도 AC가 통과하지 않으면 status를 `"error"`로 바꾸고 같은 phase 객체의
   `"error_message"`에 무엇이 왜 실패했는지 적으세요. 추측하지 말고 실제 출력을 근거로 적으세요.
5. AC 통과와 index.json 갱신을 마쳤으면 변경을 커밋하세요. 형식은 conventional commit이고
   영어로 적습니다. 예: `{commit_example}`
6. 커밋 메시지에 AI 작성 표시나 co-author 줄을 넣지 마세요.

아래는 이번 phase의 상세 내용입니다.

"""


def run_phase(task_dir: Path, phase: dict, preamble: str, model: str) -> int:
    phase_num = phase["phase"]
    phase_file = task_dir / f"phase{phase_num}.md"
    if not phase_file.exists():
        print(f"  오류: {phase_file}가 없습니다")
        sys.exit(1)

    # 경로가 아니라 내용을 싣는다. 세션이 파일을 못 찾으면 아무것도 하지 않고 끝난다.
    prompt = preamble + phase_file.read_text()

    result = subprocess.run(
        [
            CLAUDE_BIN,
            "-p",
            "--dangerously-skip-permissions",
            "--model", model,
            "--output-format", "json",
            prompt,
        ],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=PHASE_TIMEOUT_SECONDS,
    )

    (task_dir / f"phase{phase_num}-output.json").write_text(
        json.dumps(
            {
                "phase": phase_num,
                "name": phase["name"],
                "model": model,
                "exitCode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )

    if result.returncode != 0:
        print(f"\n  주의: 세션이 종료 코드 {result.returncode}으로 끝났습니다")
        print(f"  stderr: {result.stderr[:500]}")
    return result.returncode


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def parse_args() -> tuple[Path, str, bool]:
    args = [a for a in sys.argv[1:]]
    if not args:
        print("Usage: python3 scripts/run-phases.py <task-dir> [--model <name>] [--dry-run]")
        sys.exit(1)

    model = DEFAULT_MODEL
    dry_run = False
    positional = []
    index = 0
    while index < len(args):
        if args[index] == "--model" and index + 1 < len(args):
            model = args[index + 1]
            index += 2
            continue
        if args[index] == "--dry-run":
            dry_run = True
            index += 1
            continue
        positional.append(args[index])
        index += 1

    task_dir = TASKS_DIR / positional[0]
    if not task_dir.is_dir():
        print(f"오류: task 디렉터리가 없습니다: {task_dir}")
        sys.exit(1)
    return task_dir, model, dry_run


def main() -> None:
    task_dir, model, dry_run = parse_args()
    task_dir_name = task_dir.name
    index_file = task_dir / "index.json"
    if not index_file.exists():
        print(f"오류: {index_file}가 없습니다")
        sys.exit(1)

    index = load_index(index_file)
    task_name = index.get("task", task_dir_name)
    total = index.get("totalPhases", len(index["phases"]))
    pending = sum(1 for p in index["phases"] if p["status"] == "pending")

    print(f"\n{'=' * 64}")
    print(f"  phase 러너 | {task_name}")
    print(f"  phase {total}개 중 {pending}개 남음 | 모델 {model}")
    print(f"{'=' * 64}")

    failed = last_touched_phase(index)
    if failed and failed["status"] == "error":
        print(f"\n  phase {failed['phase']}({failed['name']})가 실패한 채로 남아 있습니다.")
        print(f"  {failed.get('error_message', '사유 기록 없음')}")
        print(f"  고친 뒤 {index_file}의 status를 pending으로 되돌리고 다시 실행하세요.")
        sys.exit(1)

    if dry_run:
        for phase in index["phases"]:
            marker = "→" if phase["status"] == "pending" else " "
            print(f"  {marker} phase {phase['phase']}: {phase['name']} [{phase['status']}]")
        return

    if "created_at" not in index:
        index["created_at"] = now_iso()
        save_index(index_file, index)

    commit_plan_files(task_name)
    preamble = build_preamble(task_dir_name, task_name)
    baseline = git("rev-parse", "HEAD").stdout.strip()

    while True:
        index = load_index(index_file)
        phase = find_next_phase(index)
        if phase is None:
            print("\n  남은 phase가 없습니다.")
            break

        phase_num = phase["phase"]
        phase_name = phase["name"]
        done = sum(1 for p in index["phases"] if p["status"] == "completed")

        blocked = preflight(phase.get("requiresDocker", False))
        if blocked:
            mark_error(index_file, phase_num, blocked.replace("\n", " "))
            update_top_index(task_dir_name, "error")
            print(f"  중단: phase {phase_num} 시작 전 프리플라이트 실패")
            print(blocked)
            sys.exit(1)

        stamp_phase(index_file, phase_num, "started_at")

        with Spinner(f"phase {phase_num} ({done}/{total} 완료): {phase_name}") as spinner:
            run_phase(task_dir, phase, preamble, model)
            elapsed = int(spinner.elapsed)

        status = phase_status(index_file, phase_num)

        if status == "pending":
            # 세션이 status를 갱신하지 않았다. AC를 돌리지 않았거나 중간에 끊긴 것이다.
            mark_error(index_file, phase_num, "세션이 index.json의 status를 갱신하지 않았습니다")
            update_top_index(task_dir_name, "error")
            print(f"  실패 phase {phase_num}: {phase_name} [{elapsed}s] status 미갱신")
            print(f"  {task_dir}/phase{phase_num}-output.json의 stdout을 보세요.")
            sys.exit(1)

        if status == "error":
            stamp_phase(index_file, phase_num, "failed_at")
            reason = next(
                (p.get("error_message", "") for p in load_index(index_file)["phases"] if p["phase"] == phase_num),
                "",
            )
            update_top_index(task_dir_name, "error")
            print(f"  실패 phase {phase_num}: {phase_name} [{elapsed}s]")
            if reason:
                print(f"  {reason}")
            print(f"  고친 뒤 {index_file}의 status를 pending으로 되돌리고 다시 실행하세요.")
            sys.exit(1)

        stamp_phase(index_file, phase_num, "completed_at")
        if phase_num == 0:
            subprocess.run(
                ["python3", str(ROOT / "scripts" / "gen-docs-diff.py"), str(task_dir), baseline],
                cwd=str(ROOT / "scripts"),
            )
        commit_phase(task_name, task_dir_name, phase_num, phase_name)
        print(f"  완료 phase {phase_num}: {phase_name} [{elapsed}s]")

    index = load_index(index_file)
    already_done = "completed_at" in index
    if not already_done:
        index["completed_at"] = now_iso()
        save_index(index_file, index)
        update_top_index(task_dir_name, "completed")

        # 두 파일만 담는다. `git add -A`로 쓸어 담으면 마침 작업 트리에 있던 남의 변경이
        # "task completed"라는 이름으로 커밋된다. 실제로 한 번 그렇게 됐다.
        git("add", "--", str(index_file.relative_to(ROOT)), "tasks/index.json")
        if git("diff", "--cached", "--quiet").returncode != 0:
            git("commit", "-m", f"chore({task_name}): mark the task completed")

    print(f"\n{'=' * 64}")
    print(f"  {task_dir_name}: phase 전부 완료")
    print(f"{'=' * 64}")


if __name__ == "__main__":
    main()
