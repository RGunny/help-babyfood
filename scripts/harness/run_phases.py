#!/usr/bin/env python3
"""phase 러너.

tasks/<task-dir>/index.json의 phase를 순서대로, phase마다 새 Claude 세션에서 실행한다.
세션의 구조화 보고를 받되 그대로 믿지 않고, scope·동결 경로·verify를 직접 검사한 뒤에만
completed로 기록하고 커밋한다. 상태는 state.json(gitignore)에만 기록한다.

Usage:
  python3 scripts/harness/run_phases.py <task-dir> [--model M] [--dry-run]
  python3 scripts/harness/run_phases.py <task-dir> --resume      # 마지막 error phase를 같은 세션으로 이어서
  python3 scripts/harness/run_phases.py <task-dir> --abort --yes # baseline으로 되돌린다 (reset --hard + clean -fd)
"""

from __future__ import annotations

import argparse
import fnmatch
import sys
from pathlib import Path
from typing import Callable

from _utils import (
    DOCS_DIFF_FILE, INDEX_FILE, STATE_FILE, HarnessError, fail, find_project_root, git, git_lines, load_config, now_iso,
    output_file_name, read_json, require_python,
)
from gen_docs_diff import write_docs_diff
from phase_session import SessionOutcome, build_preamble, run_session
from preflight import run_preflight
from task_state import Phase, RunnerLock, TaskState, load_phases, validate_phase_files
from verify import run_group

RESUME_PROMPT = "이전 세션을 이어서 진행하세요. 남은 작업을 끝내고 AC를 전부 실행한 뒤 요구된 JSON으로 보고하세요."


class Runner:
    def __init__(self, root: Path, config: dict, task_dir: Path, model_override: str | None, report: Callable[[str], None]):
        self.root = root
        self.report = report
        self.config = config
        self.task_dir = task_dir
        self.index = read_json(task_dir / INDEX_FILE)
        self.task_name = self.index.get("task", task_dir.name)
        self.phases = load_phases(self.index, task_dir)
        validate_phase_files(task_dir, self.phases)
        self.state = TaskState(task_dir)
        self.model_override = model_override

    # ----- 준비 -------------------------------------------------------------

    def model_for(self, phase: Phase) -> str:
        model = self.model_override or phase.model or self.config.get("model")
        if not model:
            raise HarnessError("--model, harness.json의 model, phase의 model 중 하나로 모델을 정하세요")
        return model

    def preflight_or_raise(self, items: list[str]) -> None:
        failed = [(item, detail) for item, ok, detail in run_preflight(items, self.root) if not ok]
        if failed:
            raise HarnessError("프리플라이트 실패 항목을 해결하세요: " + "; ".join(f"{i} ({d})" for i, d in failed))

    def baseline(self) -> str:
        data = self.state.load()
        if not data.get("baseline"):
            self.state.set_task(baseline=git("rev-parse", "HEAD", cwd=self.root).stdout.strip(), started_at=now_iso(), status="running")
            data = self.state.load()
        return data["baseline"]

    # ----- 독립 검증 --------------------------------------------------------

    @staticmethod
    def _under(path: str, patterns: list[str]) -> bool:
        for pattern in patterns:
            prefix = pattern.rstrip("/")
            if path == prefix or path.startswith(prefix + "/") or fnmatch.fnmatch(path, pattern):
                return True
        return False

    def changed_paths(self) -> list[str]:
        paths = []
        for line in git("status", "--porcelain", cwd=self.root).stdout.splitlines():
            path = line[3:]
            if " -> " in path:
                path = path.split(" -> ", 1)[1]
            paths.append(path.strip('"'))
        return paths

    def check_scope(self, phase: Phase) -> str | None:
        outside = [p for p in self.changed_paths() if not self._under(p, phase.scope)]
        return f"scope 밖 변경을 되돌리거나 scope에 넣으세요: {', '.join(outside[:10])}" if outside else None

    def check_frozen(self, phase: Phase, baseline: str) -> str | None:
        frozen = [p for p in self.config.get("frozen_paths", []) if p not in phase.unfreeze]
        if not frozen:
            return None
        diff = git("diff", "--name-only", baseline, "--", *frozen, cwd=self.root).stdout.split()
        untracked = git_lines("ls-files", "--others", "--exclude-standard", "--", *frozen, cwd=self.root)
        touched = diff + untracked
        return f"동결 경로 변경을 되돌리거나 unfreeze를 선언하세요: {', '.join(touched[:10])}" if touched else None

    def check_verify(self) -> str | None:
        group = self.config.get("verify_after_phase", "fast")
        if group in (None, "none"):
            return None
        for command, code, tail in run_group(group, self.config, self.root):
            if code != 0:
                return f"verify {group} 실패: `{command}` (exit {code})\n{tail[-800:]}"
        return None

    # ----- 커밋 -------------------------------------------------------------

    def commit(self, phase: Phase, summary: str) -> None:
        if self.config["commit"].get("mode", "auto") == "none":
            return
        add_paths = [p for p in phase.scope if (self.root / p.rstrip("/")).exists() or "*" in p]
        docs_diff = self.task_dir / DOCS_DIFF_FILE
        if docs_diff.exists():
            add_paths.append(str(docs_diff.relative_to(self.root)))
        if add_paths:
            git("add", "--", *add_paths, cwd=self.root)
        if git("diff", "--cached", "--quiet", cwd=self.root, check=False).returncode == 0:
            return
        kind = "docs" if phase.id == "0" else "feat"
        subject = f"{kind}({self.task_name}): phase {phase.id} {phase.name}"
        body = "\n".join(f"- {line.strip('- ').strip()}" for line in summary.splitlines() if line.strip())[:600]
        result = git("commit", "-m", subject, "-m", body, cwd=self.root, check=False)
        if result.returncode != 0:
            raise HarnessError(f"커밋 실패: {result.stderr.strip()[-500:]}")

    # ----- phase 실행 -------------------------------------------------------

    def run_phase(self, phase: Phase, resume: bool) -> None:
        baseline = self.baseline()
        model = self.model_for(phase)
        self.preflight_or_raise(phase.requires)
        outcome = self._run_with_retries(phase, model, baseline, resume)
        problems = self._problems(phase, outcome, baseline)
        if problems:
            self._fail(phase, problems)
        self._finish(phase, outcome, baseline)

    def _run_with_retries(self, phase: Phase, model: str, baseline: str, resume: bool) -> SessionOutcome:
        limits = self.config["limits"]
        prompt = build_preamble(self.config, self.task_dir.name, baseline, phase.id) + (self.task_dir / phase.file_name).read_text()
        env = {"HARNESS_BASELINE": baseline, "HARNESS_TASK": self.task_dir.name, "HARNESS_PHASE": phase.id}
        output_path = self.task_dir / output_file_name(phase.id)
        previous = self.state.phase(phase.id).get("attempts") or []
        resume_session = previous[-1]["session_id"] if resume and previous else None

        for attempt_no in range(1, int(limits["retries"]) + 2):
            self.state.add_attempt(phase.id, {"n": len(previous) + attempt_no, "model": model, "started_at": now_iso(), "session_id": resume_session or ""})
            self.report(f"  세션 시작 phase {phase.id} ({phase.name}) 모델 {model} 시도 {attempt_no}")
            outcome = run_session(
                root=self.root, prompt=RESUME_PROMPT if resume_session else prompt, model=model, env=env,
                budget_usd=float(limits["budget_usd"]), timeout_s=int(limits["phase_timeout_s"]),
                output_path=output_path, resume_session=resume_session,
            )
            self.state.update_last_attempt(
                phase.id, session_id=outcome.session_id, ended_at=now_iso(), exit_code=outcome.exit_code,
                subtype=outcome.subtype, is_error=outcome.is_error, cost_usd=outcome.cost_usd, turns=outcome.turns,
                report=outcome.report,
            )
            if not self._is_transport_failure(outcome):
                return outcome
            self.report(f"  전송 오류({outcome.subtype}), 재시도")
            resume_session = None
        return outcome

    def _is_transport_failure(self, outcome: SessionOutcome) -> bool:
        return outcome.report is None and outcome.is_error and not outcome.timed_out and not self.changed_paths()

    def _problems(self, phase: Phase, outcome: SessionOutcome, baseline: str) -> list[str]:
        problems = []
        if outcome.timed_out:
            problems.append(f"타임아웃 {self.config['limits']['phase_timeout_s']}s: limits.phase_timeout_s를 늘리거나 phase를 나누세요")
        if outcome.report is None:
            problems.append(f"세션이 구조화 보고를 남기지 않았습니다 ({outcome.subtype}): {output_file_name(phase.id)}을 보세요")
        elif outcome.report.get("status") != "completed":
            problems.append(f"세션 보고: error. {outcome.report.get('error_message') or outcome.report.get('summary')}")
        for check in (self.check_scope(phase), self.check_frozen(phase, baseline)):
            if check:
                problems.append(check)
        if not problems:
            verify_problem = self.check_verify()
            if verify_problem:
                problems.append(verify_problem)
        return problems

    def _fail(self, phase: Phase, problems: list[str]) -> None:
        kind = "infra" if self.preflight_failed(phase) else "phase"
        self.state.mark_error(phase.id, "\n".join(problems), kind)
        hint = "phase 파일 수정 없이 --resume 하세요" if kind == "infra" else "phase 파일을 고친 뒤 --resume 하거나 --abort --yes로 되돌리세요"
        raise HarnessError(f"phase {phase.id} 실패 ({kind}):\n" + "\n".join(problems) + f"\n다음: {hint}")

    def _finish(self, phase: Phase, outcome: SessionOutcome, baseline: str) -> None:
        if phase.id == "0":
            write_docs_diff(self.task_dir, baseline, self.root, self.config["docs"]["diff_paths"])
        self.commit(phase, (outcome.report or {}).get("summary", ""))
        self.state.update_phase(phase.id, status="completed", completed_at=now_iso())
        self.report(f"  완료 phase {phase.id}: {phase.name} (${outcome.cost_usd:.2f}, {outcome.turns}턴)")

    def preflight_failed(self, phase: Phase) -> bool:
        items = list(self.config["preflight"]) + phase.requires
        return any(not ok for _, ok, _ in run_preflight(items, self.root))

    # ----- 진입점 -----------------------------------------------------------

    def dry_run(self) -> None:
        data = self.state.load()
        self.report(f"  task {self.task_name} | baseline {data.get('baseline', '(시작 전)')[:10]}")
        for phase in self.phases:
            status = data["phases"].get(phase.id, {}).get("status", "pending")
            model = self.model_override or phase.model or self.config.get("model") or "(미정: --model 필요)"
            self.report(f"  {'>' if status == 'pending' else ' '} phase {phase.id}: {phase.name} [{status}] scope={phase.scope} requires={phase.requires} model={model}")

    def abort(self) -> None:
        baseline = self.state.load().get("baseline")
        if not baseline:
            raise HarnessError(f"--abort는 러너를 한 번 이상 실행한 task에서만 쓰세요 ({STATE_FILE}에 baseline 없음)")
        git("reset", "--hard", baseline, cwd=self.root)
        git("clean", "-fd", cwd=self.root)
        self.state.set_task(status="aborted", aborted_at=now_iso())
        self.report(f"  baseline {baseline[:10]}으로 복원 완료 ({STATE_FILE} 유지)")

    def run(self, resume: bool) -> None:
        with RunnerLock(self.root):
            self.preflight_or_raise(list(self.config["preflight"]) + ([] if resume else ["git-clean"]))
            errored = self.state.last_error(self.phases)
            if errored and not resume:
                raise HarnessError(f"error 상태인 phase {errored.id}({errored.name})를 고친 뒤 --resume 하거나 --abort --yes로 되돌리세요")
            if errored and resume:
                self.state.reset_phase(errored.id)
                self.run_phase(errored, resume=True)
            while (phase := self.state.next_pending(self.phases)) is not None:
                self.run_phase(phase, resume=False)
            self.state.set_task(status="completed", completed_at=now_iso())
            cost, turns = self.state.totals()
            self.report(f"\n  {self.task_dir.name}: phase 전부 완료. 누적 ${cost:.2f}, {turns}턴")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("task_dir")
    parser.add_argument("--model")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--abort", action="store_true")
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("--root", type=Path)
    args = parser.parse_args()
    try:
        require_python()
        root = (args.root or find_project_root()).resolve()
        config = load_config(root)
        task_dir = root / "tasks" / args.task_dir
        if not (task_dir / INDEX_FILE).exists():
            raise HarnessError(f"task 디렉터리 이름을 확인하세요: {task_dir}/{INDEX_FILE} 없음")
        runner = Runner(root, config, task_dir, args.model, report=lambda line: print(line, flush=True))
        if args.dry_run:
            runner.dry_run()
        elif args.abort:
            if not args.yes:
                raise HarnessError("--abort는 작업 트리를 baseline으로 되돌리므로 확인했으면 --yes를 붙이세요")
            runner.abort()
        else:
            runner.run(resume=args.resume)
    except HarnessError as exc:
        fail(f"\n{exc}", 1)
    except KeyboardInterrupt:
        fail("\n중단했습니다. 이어서 하려면 다시 실행하세요", 130)


if __name__ == "__main__":
    main()
