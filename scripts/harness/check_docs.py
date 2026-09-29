#!/usr/bin/env python3
"""허용 목록에 없는 .md와 줄 수 상한을 넘긴 문서를 막는다.

설정 파일(harness.json의 docs.allowlist가 가리키는 경로):
  {"allowed": ["README.md", "docs/adr/*.md", "docs/**/*.md"], "lineLimits": {"AGENTS.md": 50}}
  allowed 항목은 정확한 경로 또는 글롭이다. `*`는 `/`를 넘지 않고 `**`는 넘는다.

  (기본)     추적 중인 .md가 모두 작업 트리의 허용 목록에 있어야 한다. 줄 수는 작업 트리 기준이다.
  --staged   이번 커밋에 추가되거나 이름이 바뀐(A, R) .md는 HEAD의 허용 목록에 있어야 한다.
             허용 목록 확장과 새 파일을 같은 커밋에 넣으면 실패한다. 줄 수는 스테이징된 내용 기준이다.

Usage: python3 scripts/harness/check_docs.py [--staged] [--root DIR] [--config PATH]
exit 0 통과, 1 위반, 2 설정 파일 없음·형식 오류
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Callable

from _utils import HarnessError, fail, find_project_root, git, git_lines, load_config


def glob_to_regex(pattern: str) -> re.Pattern:
    out = []
    i = 0
    while i < len(pattern):
        ch = pattern[i]
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
            continue
        if pattern.startswith("**", i):
            out.append(".*")
            i += 2
            continue
        if ch == "*":
            out.append("[^/]*")
        elif ch == "?":
            out.append("[^/]")
        else:
            out.append(re.escape(ch))
        i += 1
    return re.compile("^" + "".join(out) + "$")


class Allowlist:
    def __init__(self, raw: dict, source: str):
        if not isinstance(raw.get("allowed"), list) or not isinstance(raw.get("lineLimits"), dict):
            raise HarnessError(f"{source}에 allowed(list)와 lineLimits(dict)를 넣으세요")
        self.patterns = [glob_to_regex(p) for p in raw["allowed"]]
        self.line_limits: dict[str, int] = raw["lineLimits"]

    def allows(self, rel: str) -> bool:
        return any(p.match(rel) for p in self.patterns)


def line_count(text: str) -> int:
    if text == "":
        return 0
    count = text.count("\n")
    return count if text.endswith("\n") else count + 1


def parse_allowlist(text: str, source: str) -> Allowlist:
    try:
        return Allowlist(json.loads(text), source)
    except json.JSONDecodeError as exc:
        raise HarnessError(f"{source}의 JSON 오류를 고치세요: {exc}") from exc


def read_working(root: Path, rel: str) -> Allowlist:
    path = root / rel
    if not path.exists():
        raise HarnessError(f"허용 목록 파일을 만드세요: {rel}")
    return parse_allowlist(path.read_text(), rel)


def read_head(root: Path, rel: str) -> Allowlist | None:
    result = git("show", f"HEAD:{rel}", cwd=root, check=False)
    if result.returncode != 0:
        return None
    return parse_allowlist(result.stdout, f"HEAD:{rel}")


def staged_new_docs(root: Path) -> list[str]:
    paths = []
    for line in git_lines("diff", "--cached", "--name-status", "--diff-filter=AR", cwd=root):
        parts = line.split("\t")
        rel = parts[2] if parts[0].startswith("R") and len(parts) > 2 else parts[1]
        if rel.endswith(".md"):
            paths.append(rel)
    return paths


def line_limit_errors(allow: Allowlist, read: Callable[[str], str | None]) -> list[str]:
    """lineLimits의 문서마다 read로 본문을 읽어 상한을 넘긴 것을 모은다. read가 None을 주면 건너뛴다."""
    errors = []
    for rel, limit in allow.line_limits.items():
        text = read(rel)
        if text is None:
            continue
        n = line_count(text)
        if n > limit:
            errors.append(f"{rel} {n}줄 (상한 {limit}): 다른 줄을 지워 상한 안으로 줄이세요")
    return errors


def check_default(root: Path, config_rel: str) -> list[str]:
    allow = read_working(root, config_rel)
    errors = []
    deleted = set(git_lines("diff", "--name-only", "--diff-filter=D", "HEAD", "--", "*.md", cwd=root))
    for rel in git_lines("ls-files", "--", "*.md", cwd=root):
        if rel in deleted:
            continue  # 작업 트리에서 지운 파일은 다음 커밋에서 빠진다
        if not allow.allows(rel):
            errors.append(f"허용 목록에 없는 문서 {rel}: 기존 문서에 합치거나, 사용자 승인 뒤 {config_rel}만 먼저 커밋하세요")

    def read_working_tree(rel: str) -> str | None:
        path = root / rel
        return path.read_text() if path.exists() else None

    return errors + line_limit_errors(allow, read_working_tree)


def check_staged(root: Path, config_rel: str) -> list[str]:
    allow = read_head(root, config_rel) or read_working(root, config_rel)
    errors = []
    for rel in staged_new_docs(root):
        if not allow.allows(rel):
            errors.append(f"HEAD 허용 목록에 없는 새 문서 {rel}: 기존 문서에 합치거나, 사용자 승인 뒤 {config_rel}만 먼저 커밋하세요")
    staged = set(git_lines("diff", "--cached", "--name-only", cwd=root))

    def read_index(rel: str) -> str | None:
        if rel not in staged:
            return None
        shown = git("show", f":{rel}", cwd=root, check=False)
        return shown.stdout if shown.returncode == 0 else None

    return errors + line_limit_errors(allow, read_index)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--staged", action="store_true")
    parser.add_argument("--root", type=Path)
    parser.add_argument("--config", help="허용 목록 파일 경로(루트 기준). 기본은 harness.json docs.allowlist")
    args = parser.parse_args()
    try:
        root = (args.root or find_project_root()).resolve()
        config_rel = args.config or load_config(root)["docs"]["allowlist"]
        errors = check_staged(root, config_rel) if args.staged else check_default(root, config_rel)
    except HarnessError as exc:
        fail(str(exc), 2)
        return
    if errors:
        print("\n\n".join(errors), file=sys.stderr)
        sys.exit(1)
    print("check_docs ok" + (" (--staged)" if args.staged else ""))


if __name__ == "__main__":
    main()
