from __future__ import annotations

import json
import unittest

from helpers import BASE_CONFIG, Repo, fake_claude_env, log, status

from task_state import RunnerLock, TaskState
from _utils import HarnessError


def read_state(task_dir):
    return json.loads((task_dir / "state.json").read_text())


class RunPhasesTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()
        self.task = self.repo.add_task("1-demo", [
            {"phase": 0, "name": "docs", "scope": ["docs/", "README.md"]},
            {"phase": 1, "name": "impl", "scope": ["src/app/"], "requires": []},
        ])

    def tearDown(self):
        self.repo.cleanup()

    def run_runner(self, actions, *args):
        return self.repo.run_script("run_phases.py", "1-demo", *args, env=fake_claude_env(actions, self.repo))

    def test_dry_run_lists_phases_and_touches_nothing(self):
        result = self.run_runner({}, "--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("phase 0: docs [pending]", result.stdout)
        self.assertFalse((self.task / "state.json").exists())

    def test_happy_path_commits_each_phase_and_writes_docs_diff(self):
        actions = {"0": {"action": "completed", "write": ["docs/guide.md"], "summary": "update guide"},
                   "1": {"action": "completed", "write": ["src/app/a.txt"]}}
        result = self.run_runner(actions)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        commits = log(self.repo)
        self.assertEqual(commits[0], "feat(demo): phase 1 impl")
        self.assertEqual(commits[1], "docs(demo): phase 0 docs")
        self.assertIn("docs/guide.md", (self.task / "docs-diff.md").read_text())
        state = read_state(self.task)
        self.assertEqual(state["status"], "completed")
        self.assertEqual(state["phases"]["0"]["status"], "completed")
        self.assertAlmostEqual(state["phases"]["1"]["attempts"][0]["cost_usd"], 0.25)
        self.assertEqual(status(self.repo), "")

    def test_session_error_report_marks_phase_error_and_stops(self):
        result = self.run_runner({"0": {"action": "error"}})
        self.assertEqual(result.returncode, 1)
        state = read_state(self.task)
        self.assertEqual(state["phases"]["0"]["status"], "error")
        self.assertIn("1 test failed", state["phases"]["0"]["error_message"])
        self.assertNotIn("phase 1", " ".join(log(self.repo)))

    def test_scope_violation_overrides_completed_report(self):
        result = self.run_runner({"0": {"action": "completed", "write": ["src/app/sneaky.txt"]}})
        self.assertEqual(result.returncode, 1)
        self.assertIn("scope 밖 변경", read_state(self.task)["phases"]["0"]["error_message"])
        self.assertEqual(len(log(self.repo)), 2)

    def test_frozen_path_violation_is_caught_even_inside_scope(self):
        task = self.repo.add_task("2-frozen", [{"phase": 0, "name": "docs", "scope": ["src/"]}])
        env = fake_claude_env({"0": {"action": "completed", "write": ["src/domain/rule.txt"]}}, self.repo)
        result = self.repo.run_script("run_phases.py", "2-frozen", env=env)
        self.assertEqual(result.returncode, 1)
        self.assertIn("동결 경로 변경", read_state(task)["phases"]["0"]["error_message"])

    def test_unfreeze_allows_declared_domain_change(self):
        task = self.repo.add_task("3-unfreeze", [{"phase": 0, "name": "docs", "scope": ["src/"], "unfreeze": ["src/domain/"]}])
        env = fake_claude_env({"0": {"action": "completed", "write": ["src/domain/rule.txt"]}}, self.repo)
        result = self.repo.run_script("run_phases.py", "3-unfreeze", env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(read_state(task)["phases"]["0"]["status"], "completed")

    def test_transport_error_is_retried_then_fails(self):
        result = self.run_runner({"0": {"action": "transport"}})
        self.assertEqual(result.returncode, 1)
        state = read_state(self.task)
        self.assertEqual(len(state["phases"]["0"]["attempts"]), 2)
        self.assertIn("구조화 보고", state["phases"]["0"]["error_message"])

    def test_silent_success_without_report_is_error(self):
        result = self.run_runner({"0": {"action": "silent", "write": ["docs/guide.md"]}})
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len(read_state(self.task)["phases"]["0"]["attempts"]), 1)

    def test_verify_failure_blocks_completion(self):
        config = {**BASE_CONFIG, "verify": {"fast": ["false"]}}
        self.repo.write("harness.json", json.dumps(config))
        self.repo.commit("verify fails")
        result = self.run_runner({"0": {"action": "completed", "write": ["docs/guide.md"]}})
        self.assertEqual(result.returncode, 1)
        self.assertIn("verify fast 실패", read_state(self.task)["phases"]["0"]["error_message"])

    def test_dirty_tree_blocks_start(self):
        self.repo.write("README.md", "# dirty\n")
        result = self.run_runner({})
        self.assertEqual(result.returncode, 1)
        self.assertIn("git-clean", result.stderr)

    def test_resume_after_error_reruns_same_phase(self):
        self.run_runner({"0": {"action": "error"}})
        result = self.run_runner({"0": {"action": "completed", "write": ["docs/guide.md"]}, "1": {"action": "completed", "write": ["src/app/a.txt"]}}, "--resume")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        state = read_state(self.task)
        self.assertEqual(state["phases"]["0"]["status"], "completed")
        self.assertEqual(len(state["phases"]["0"]["attempts"]), 2)

    def test_abort_restores_baseline_and_requires_yes(self):
        self.run_runner({"0": {"action": "completed", "write": ["docs/guide.md", "src/app/sneaky.txt"]}})
        self.assertNotEqual(status(self.repo), "")
        self.assertEqual(self.run_runner({}, "--abort").returncode, 1)
        result = self.run_runner({}, "--abort", "--yes")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(status(self.repo), "")
        self.assertFalse((self.repo.root / "src/app/sneaky.txt").exists())
        self.assertTrue((self.task / "state.json").exists())

    def test_missing_scope_is_rejected_before_running(self):
        self.repo.add_task("4-noscope", [{"phase": 0, "name": "docs"}])
        result = self.repo.run_script("run_phases.py", "4-noscope", "--dry-run")
        self.assertEqual(result.returncode, 1)
        self.assertIn("scope", result.stderr)

    def test_timeout_kills_session(self):
        config = {**BASE_CONFIG, "limits": {"phase_timeout_s": 2, "budget_usd": 1, "retries": 0}}
        self.repo.write("harness.json", json.dumps(config))
        self.repo.commit("short timeout")
        result = self.run_runner({"0": {"action": "hang"}})
        self.assertEqual(result.returncode, 1)
        self.assertIn("타임아웃", read_state(self.task)["phases"]["0"]["error_message"])


class LockTests(unittest.TestCase):
    def test_second_lock_is_refused(self):
        with Repo() as repo, RunnerLock(repo.root):
            with self.assertRaises(HarnessError):
                with RunnerLock(repo.root):
                    pass


class StateTests(unittest.TestCase):
    def test_totals_sum_attempts(self):
        with Repo() as repo:
            task = repo.add_task("9-state", [{"phase": 0, "name": "docs", "scope": ["docs/"]}])
            state = TaskState(task)
            state.add_attempt("0", {"cost_usd": 0.5, "turns": 4})
            state.add_attempt("0", {"cost_usd": 0.25, "turns": 2})
            self.assertEqual(state.totals(), (0.75, 6))


if __name__ == "__main__":
    unittest.main()
