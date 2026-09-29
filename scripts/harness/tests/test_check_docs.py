from __future__ import annotations

import json
import unittest

from helpers import Repo, git

import check_docs


class GlobTests(unittest.TestCase):
    def test_single_star_does_not_cross_slash(self):
        self.assertTrue(check_docs.glob_to_regex("docs/*.md").match("docs/a.md"))
        self.assertFalse(check_docs.glob_to_regex("docs/*.md").match("docs/sub/a.md"))

    def test_double_star_crosses_slash(self):
        self.assertTrue(check_docs.glob_to_regex("docs/**/*.md").match("docs/a.md"))
        self.assertTrue(check_docs.glob_to_regex("docs/**/*.md").match("docs/x/y/a.md"))

    def test_exact_path(self):
        self.assertTrue(check_docs.glob_to_regex("README.md").match("README.md"))
        self.assertFalse(check_docs.glob_to_regex("README.md").match("docs/README.md"))

    def test_line_count(self):
        self.assertEqual(check_docs.line_count(""), 0)
        self.assertEqual(check_docs.line_count("a\nb\n"), 2)
        self.assertEqual(check_docs.line_count("a\nb"), 2)


class CliTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()

    def tearDown(self):
        self.repo.cleanup()

    def test_ok_fixture_passes(self):
        result = self.repo.run_script("check_docs.py")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_tracked_doc_outside_allowlist_fails(self):
        self.repo.write("notes/stray.md", "x\n")
        self.repo.commit("stray")
        result = self.repo.run_script("check_docs.py")
        self.assertEqual(result.returncode, 1)
        self.assertIn("notes/stray.md", result.stderr)

    def test_line_limit_fails(self):
        self.repo.write("AGENTS.md", "1\n2\n3\n4\n")
        self.repo.commit("agents")
        result = self.repo.run_script("check_docs.py")
        self.assertEqual(result.returncode, 1)
        self.assertIn("AGENTS.md 4줄 (상한 3)", result.stderr)

    def test_staged_new_doc_not_in_head_allowlist_fails(self):
        self.repo.write("notes/new.md", "x\n")
        git("add", "notes/new.md", cwd=self.repo.root)
        result = self.repo.run_script("check_docs.py", "--staged")
        self.assertEqual(result.returncode, 1)
        self.assertIn("HEAD 허용 목록", result.stderr)

    def test_staged_new_doc_matching_glob_passes(self):
        self.repo.write("docs/adr/0001-x.md", "x\n")
        git("add", "docs/adr/0001-x.md", cwd=self.repo.root)
        result = self.repo.run_script("check_docs.py", "--staged")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_widening_allowlist_in_same_commit_still_fails(self):
        cfg = json.loads((self.repo.root / "scripts/doc-paths.json").read_text())
        cfg["allowed"].append("notes/*.md")
        self.repo.write("scripts/doc-paths.json", json.dumps(cfg))
        self.repo.write("notes/new.md", "x\n")
        git("add", "-A", cwd=self.repo.root)
        result = self.repo.run_script("check_docs.py", "--staged")
        self.assertEqual(result.returncode, 1)

    def test_missing_config_exit_2(self):
        (self.repo.root / "scripts/doc-paths.json").unlink()
        result = self.repo.run_script("check_docs.py")
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
