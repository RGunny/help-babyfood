#!/usr/bin/env python3
"""
세션 기록에서 사람이 친 프롬프트만 뽑아 prompts/에 정리한다.

여기 있는 것은 요약이 아니라 원문이다. 무엇을 만들었는지는 docs/가 말하고, 무엇을
시켰는지는 이 파일들이 말한다. 둘은 다르다. 같은 결과를 다시 만들 때 필요한 것은
결정문이 아니라 지시문이기 때문이다.

Usage: python3 scripts/export-prompts.py [--check]
  --check  파일을 쓰지 않고 무엇이 나올지만 보여 준다
"""

import json
import re
import sys
from pathlib import Path

from _utils import find_project_root

ROOT = find_project_root()
PROMPTS_DIR = ROOT / "prompts"
SESSION_MAP_FILE = PROMPTS_DIR / "sessions.json"

TRANSCRIPT_DIR = (
    Path.home() / ".claude" / "projects" / ("-" + str(ROOT).lstrip("/").replace("/", "-"))
)

SYSTEM_REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
LOCAL_COMMAND = re.compile(r"<(command-name|command-message|command-args|local-command-stdout)>.*?</\1>", re.S)
CAVEAT = re.compile(r"<local-command-caveat>.*?</local-command-caveat>", re.S)


def text_of(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for block in content:
        if not isinstance(block, dict):
            continue
        # tool_result는 도구가 돌려준 것이지 사람이 친 것이 아니다.
        if block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "\n".join(parts)


def clean(raw: str) -> str:
    text = SYSTEM_REMINDER.sub("", raw)
    text = CAVEAT.sub("", text)
    text = LOCAL_COMMAND.sub("", text)
    return text.strip()


def user_prompts(path: Path) -> tuple[str, list[str]]:
    """세션 파일에서 (첫 타임스탬프, 사람이 친 메시지 목록)."""
    first_ts = ""
    prompts: list[str] = []
    for line in path.read_text(errors="replace").splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not first_ts and entry.get("timestamp"):
            first_ts = entry["timestamp"]
        if entry.get("type") != "user":
            continue
        # 도구 결과로 되돌아온 user 항목은 사람이 친 것이 아니다.
        if entry.get("toolUseResult") is not None:
            continue
        text = clean(text_of(entry.get("message", {})))
        if text:
            prompts.append(text)
    return first_ts, prompts


def load_session_map() -> dict[str, str]:
    if SESSION_MAP_FILE.exists():
        return json.loads(SESSION_MAP_FILE.read_text())
    return {}


def main() -> None:
    check_only = "--check" in sys.argv

    if not TRANSCRIPT_DIR.is_dir():
        print(f"세션 기록을 찾지 못했습니다: {TRANSCRIPT_DIR}")
        sys.exit(1)

    session_map = load_session_map()
    sessions = []
    for path in TRANSCRIPT_DIR.glob("*.jsonl"):
        first_ts, prompts = user_prompts(path)
        if prompts:
            sessions.append((first_ts, path.stem, prompts))
    sessions.sort()

    for order, (first_ts, session_id, prompts) in enumerate(sessions, start=1):
        slug = session_map.get(session_id, session_id[:8])
        target = PROMPTS_DIR / f"{order}-{slug}.md"
        body = [
            f"# {order}. {slug}",
            "",
            f"- 세션: `{session_id}`",
            f"- 시작: {first_ts}",
            f"- 사람이 친 메시지: {len(prompts)}개",
            "",
            "Claude Code 세션 기록에서 뽑은 원문이다. 손대지 않는다.",
            "",
        ]
        for number, prompt in enumerate(prompts, start=1):
            body.append("---")
            body.append("")
            body.append(f"## {number}")
            body.append("")
            body.append(prompt)
            body.append("")

        print(f"  {target.relative_to(ROOT)}  메시지 {len(prompts)}개")
        if not check_only:
            PROMPTS_DIR.mkdir(exist_ok=True)
            target.write_text("\n".join(body))

    if check_only:
        print("\n--check 였으므로 쓰지 않았습니다.")


if __name__ == "__main__":
    main()
