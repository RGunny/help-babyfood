#!/usr/bin/env python3
"""러너 테스트용 가짜 claude CLI.

FAKE_CLAUDE_ACTIONS(JSON 파일)의 HARNESS_PHASE 항목대로 파일을 쓰고, 실제 claude -p --output-format json과
같은 형식의 결과를 stdout에 출력한다.

action:
  completed        write에 적힌 파일을 쓰고 completed 보고
  error            structured error 보고
  transport        is_error=true, structured_output 없음, exit 1 (재시도 대상)
  silent           exit 0인데 structured_output 없음
  hang             timeout이 지날 때까지 대기한다
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


def main() -> None:
    args = sys.argv[1:]
    session_id = args[args.index("--session-id") + 1] if "--session-id" in args else (args[args.index("-r") + 1] if "-r" in args else "no-session")
    actions = json.loads(Path(os.environ["FAKE_CLAUDE_ACTIONS"]).read_text())
    spec = actions.get(os.environ.get("HARNESS_PHASE", ""), {"action": "completed"})
    action = spec.get("action", "completed")
    counter = Path(os.environ["FAKE_CLAUDE_ACTIONS"]).with_suffix(".calls")
    counter.write_text(str(int(counter.read_text() or 0) + 1) if counter.exists() else "1")

    if action == "hang":
        time.sleep(30)
    for rel in spec.get("write", []):
        path = Path(rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"written by fake claude for phase {os.environ.get('HARNESS_PHASE')}\n")

    base = {"type": "result", "session_id": session_id, "num_turns": 3, "total_cost_usd": 0.25}
    if action == "transport":
        print(json.dumps({**base, "subtype": "error_during_execution", "is_error": True, "result": "overloaded"}))
        sys.exit(1)
    if action == "silent":
        print(json.dumps({**base, "subtype": "success", "is_error": False, "result": "done"}))
        return
    if action == "error":
        report = {"status": "error", "summary": "could not pass AC", "error_message": "1 test failed"}
    else:
        report = {"status": "completed", "summary": spec.get("summary", "did the thing"), "error_message": None}
    print(json.dumps({**base, "subtype": "success", "is_error": False, "result": json.dumps(report), "structured_output": report}))


if __name__ == "__main__":
    main()
