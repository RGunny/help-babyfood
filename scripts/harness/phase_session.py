"""phase 하나를 Claude 세션으로 실행하고 결과를 구조화해 반환한다.

세션은 파일을 수정하고 AC를 실행하지만 git과 state.json은 수정하지 않는다.
마지막 응답은 --json-schema로 강제한 {status, summary, error_message}다. 러너는 이 보고와 별개로
scope, frozen_paths, verify를 검사한다.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path

REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["completed", "error"]},
        "summary": {"type": "string", "description": "What changed, 1-3 lines, English"},
        "error_message": {"type": ["string", "null"], "description": "Actual failing output when status is error"},
    },
    "required": ["status", "summary"],
    "additionalProperties": False,
}

REDACTION_PATTERNS = [
    re.compile(r"xox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{16,}"),
    re.compile(r"(?i)\b(secret|token|password|passwd|api[_-]?key)\s*[=:]\s*['\"]?[^\s'\"]{8,}"),
]


PREAMBLE_TEMPLATE = """당신은 {project} 프로젝트의 개발자입니다. 이 세션은 무인(HARNESS_HEADLESS=1)으로 실행됩니다.
사용자에게 묻지 말고, phase 파일에 적힌 것을 근거로 직접 판단하세요. 판단이 갈리면 phase 파일의 지시가 우선입니다.

## 순서

1. 먼저 저장소 루트의 AGENTS.md를 읽으세요. 이 저장소의 규약은 거기에 있고 여기에 다시 적지 않습니다.
2. phase 파일이 지목한 문서와 코드를 읽으세요. 설계 의도를 모르고 수정하면 같은 규칙이 두 곳에 생깁니다.
3. 작업하고, AC를 직접 실행해 검증하세요.

## 러너가 강제하는 규칙

- phase 파일의 scope 밖 파일을 고치지 마세요. 러너가 세션 뒤에 변경 경로를 검사하며, scope 밖 변경이 있으면 이 phase는 실패 처리됩니다.
- 동결 경로({frozen})는 phase가 명시적으로 허용하지 않는 한 수정하지 마세요. 러너가 baseline 대비 diff로 검사합니다.
- 불변 검사의 기준 커밋은 환경 변수 HARNESS_BASELINE({baseline})입니다. AC의 `git diff --quiet`는 HEAD가 아니라 이 값을 씁니다.
- git commit, push, stash, checkout, reset, clean을 실행하지 마세요. 커밋은 러너가 합니다.
- 환경 변수 값과 .env 파일 내용을 출력하지 마세요.
- 사람이 해야 하는 일을 만나면 멈추지 말고 docs/user-intervention.md에 적고 다음으로 넘어가세요.
- 세 번 고쳐도 AC가 통과하지 않으면 멈추고 status를 error로 보고하세요. 추측하지 말고 실제 출력을 error_message에 넣으세요.

## 보고

마지막 응답은 요구된 JSON 스키마로만 합니다. status는 AC를 전부 실행해 통과했을 때만 completed입니다.
summary는 커밋 본문에 들어가므로 영어로 1~3줄, 무엇이 바뀌었는지만 적습니다. AI 작성 표시를 넣지 않습니다.

task 디렉터리: tasks/{task_dir_name}, phase: {phase_id}

아래는 이번 phase의 상세 내용입니다.

"""


@dataclass
class SessionOutcome:
    exit_code: int
    session_id: str
    report: dict | None
    is_error: bool
    subtype: str
    cost_usd: float
    turns: int
    timed_out: bool
    raw_tail: str


def claude_bin() -> str:
    return os.environ.get("CLAUDE_BIN") or shutil.which("claude") or "claude"


def redact(text: str) -> str:
    for pattern in REDACTION_PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    return text


def build_preamble(config: dict, task_dir_name: str, baseline: str, phase_id: str) -> str:
    frozen = ", ".join(config.get("frozen_paths") or []) or "없음"
    return PREAMBLE_TEMPLATE.format(project=config["project"], frozen=frozen, baseline=baseline[:10], task_dir_name=task_dir_name, phase_id=phase_id)


def _spawn(args: list[str], cwd: Path, env: dict, timeout_s: int) -> tuple[int, str, str, bool]:
    proc = subprocess.Popen(
        args, cwd=str(cwd), env=env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True,
    )
    try:
        out, err = proc.communicate(timeout=timeout_s)
        return proc.returncode, out, err, False
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            out, err = proc.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            out, err = proc.communicate()
        return -1, out, err, True


def _parse(exit_code: int, out: str, err: str, timed_out: bool, session_id: str) -> SessionOutcome:
    try:
        data = json.loads(out) if out.strip().startswith("{") else {}
    except json.JSONDecodeError:
        data = {}
    report = data.get("structured_output") if isinstance(data.get("structured_output"), dict) else None
    return SessionOutcome(
        exit_code=exit_code,
        session_id=str(data.get("session_id") or session_id),
        report=report,
        is_error=bool(data.get("is_error", exit_code != 0)),
        subtype=str(data.get("subtype") or ("timeout" if timed_out else "unknown")),
        cost_usd=float(data.get("total_cost_usd") or 0.0),
        turns=int(data.get("num_turns") or 0),
        timed_out=timed_out,
        raw_tail=redact((out + "\n" + err)[-4000:]),
    )


def run_session(
    *, root: Path, prompt: str, model: str, env: dict, budget_usd: float, timeout_s: int,
    output_path: Path, resume_session: str | None = None,
) -> SessionOutcome:
    session_id = resume_session or str(uuid.uuid4())
    args = [claude_bin(), "-p", "--dangerously-skip-permissions", "--model", model,
            "--output-format", "json", "--json-schema", json.dumps(REPORT_SCHEMA),
            "--max-budget-usd", str(budget_usd)]
    args += ["-r", session_id] if resume_session else ["--session-id", session_id]
    args.append(prompt)
    merged = {**os.environ, **env, "HARNESS_HEADLESS": "1"}
    exit_code, out, err, timed_out = _spawn(args, root, merged, timeout_s)
    outcome = _parse(exit_code, out, err, timed_out, session_id)
    output_path.write_text(json.dumps(
        {"model": model, "session_id": outcome.session_id, "exit_code": exit_code, "timed_out": timed_out,
         "stdout": redact(out), "stderr": redact(err)},
        indent=2, ensure_ascii=False) + "\n")
    return outcome
