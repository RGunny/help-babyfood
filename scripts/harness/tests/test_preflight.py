from __future__ import annotations

import os
import unittest
from unittest import mock

from helpers import Repo

import preflight


class ParseTests(unittest.TestCase):
    def test_parse_forms(self):
        self.assertEqual(preflight.parse_item("pnpm"), ("pnpm", "", ""))
        self.assertEqual(preflight.parse_item("node>=24"), ("node", ">=", "24"))
        self.assertEqual(preflight.parse_item("java=21"), ("java", "=", "21"))
        self.assertEqual(preflight.parse_item("python3>=3.11"), ("python3", ">=", "3.11"))

    def test_version_compare(self):
        self.assertTrue(preflight.version_tuple("3.14.7") >= preflight.version_tuple("3.11"))
        self.assertFalse(preflight.version_tuple("3.9.6") >= preflight.version_tuple("3.11"))

    def test_first_version_from_java_output(self):
        self.assertEqual(preflight.first_version('openjdk version "21.0.12" 2024-07-16'), "21.0.12")


class ItemTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()

    def tearDown(self):
        self.repo.cleanup()

    def test_python_minimum_passes_on_running_interpreter(self):
        _, ok, _ = preflight.run_item("python3>=3.11", self.repo.root)
        self.assertTrue(ok)

    def test_missing_tool_fails(self):
        _, ok, detail = preflight.run_item("definitely-not-a-tool-xyz", self.repo.root)
        self.assertFalse(ok)
        self.assertIn("찾을 수 없습니다", detail)

    def test_docker_host_env(self):
        with mock.patch.dict(os.environ, {"DOCKER_HOST": ""}):
            self.assertFalse(preflight.run_item("DOCKER_HOST", self.repo.root)[1])
        with mock.patch.dict(os.environ, {"DOCKER_HOST": "unix:///x"}):
            self.assertTrue(preflight.run_item("DOCKER_HOST", self.repo.root)[1])

    def test_git_clean(self):
        self.assertTrue(preflight.run_item("git-clean", self.repo.root)[1])
        self.repo.write("README.md", "# changed\n")
        self.assertFalse(preflight.run_item("git-clean", self.repo.root)[1])

    def test_cli_uses_config_and_exit_codes(self):
        self.assertEqual(self.repo.run_script("preflight.py").returncode, 0)
        result = self.repo.run_script("preflight.py", "--items", "definitely-not-a-tool-xyz")
        self.assertEqual(result.returncode, 1)
        (self.repo.root / "harness.json").unlink()
        self.assertEqual(self.repo.run_script("preflight.py").returncode, 2)


if __name__ == "__main__":
    unittest.main()
