from __future__ import annotations

import json
import unittest

from helpers import BASE_CONFIG, Repo, head

import install_hooks
import phase_session


class GenDocsDiffTests(unittest.TestCase):
    def test_diff_only_for_doc_paths(self):
        with Repo() as repo:
            task = repo.add_task("5-diff", [{"phase": 0, "name": "docs", "scope": ["docs/"]}])
            baseline = head(repo)
            repo.write("docs/guide.md", "guide v2\n")
            repo.write("src/x.txt", "code\n")
            repo.commit("changes")
            result = repo.run_script("gen_docs_diff.py", "tasks/5-diff", baseline)
            self.assertEqual(result.returncode, 0, result.stderr)
            text = (task / "docs-diff.md").read_text()
            self.assertIn("docs/guide.md", text)
            self.assertNotIn("src/x.txt", text)


class VerifyTests(unittest.TestCase):
    def test_group_stops_at_first_failure(self):
        with Repo({**BASE_CONFIG, "verify": {"fast": ["true", "false", "true"]}}) as repo:
            result = repo.run_script("verify.py", "fast")
            self.assertEqual(result.returncode, 1)
            self.assertEqual(repo.run_script("verify.py", "nope").returncode, 2)


class InstallHooksTests(unittest.TestCase):
    def test_install_and_refuse_foreign_hook(self):
        with Repo() as repo:
            result = repo.run_script("install_hooks.py")
            self.assertEqual(result.returncode, 0, result.stderr)
            hook = install_hooks.hooks_dir(repo.root) / "pre-commit"
            self.assertTrue(hook.exists())
            self.assertTrue(hook.stat().st_mode & 0o111)
            hook.write_text("#!/bin/sh\necho foreign\n")
            self.assertEqual(repo.run_script("install_hooks.py").returncode, 2)
            hook.write_text(f"#!/bin/sh\n{install_hooks.MARKER}\n")
            self.assertEqual(repo.run_script("install_hooks.py", "--uninstall").returncode, 0)
            self.assertFalse(hook.exists())


class RedactionTests(unittest.TestCase):
    def test_tokens_are_redacted(self):
        text = "SLACK_BOT_TOKEN=xoxb-1234567890-abcdefghijkl Authorization: Bearer abcdefghijklmnopqrstuvwxyz api_key: supersecretvalue123"
        out = phase_session.redact(text)
        self.assertNotIn("xoxb-", out)
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz", out)
        self.assertNotIn("supersecretvalue123", out)

    def test_parse_reads_structured_output(self):
        raw = json.dumps({"session_id": "s1", "structured_output": {"status": "completed", "summary": "x"}, "num_turns": 2, "total_cost_usd": 0.1, "subtype": "success", "is_error": False})
        outcome = phase_session._parse(0, raw, "", False, "fallback")
        self.assertEqual(outcome.report["status"], "completed")
        self.assertEqual(outcome.session_id, "s1")
        self.assertEqual(outcome.turns, 2)


if __name__ == "__main__":
    unittest.main()
