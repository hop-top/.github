"""Tests for the `Run preflight checks` step of release-please-preflight.yml.

The step's `run:` block is lifted out of the workflow file verbatim and
run with bash inside a small fixture repository: a config, a manifest,
a release-please workflow stub and whatever files a test needs. The
publish checks are skipped (`SINGLE_LANG=true`) and `gh` / `curl` are
shimmed to fail, so nothing reaches the network. Assertions read the
step summary lines (`[BREAK]`, `[WARN]`, `[OK]`) and the exit code.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

WORKFLOW = (Path(__file__).resolve().parents[2]
            / ".github" / "workflows" / "release-please-preflight.yml")
STEP = "Run preflight checks"
CONFIG = ".github/release-please-config.json"
MANIFEST = ".github/.release-please-manifest.json"


def step_script(workflow: Path, step: str) -> str:
    """The literal `run: |` block of the step named ``step``."""
    lines = workflow.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines)
                 if line.strip() == f"- name: {step}")
    run = next(i for i in range(start + 1, len(lines))
               if lines[i].strip() == "run: |")
    indent = len(lines[run]) - len(lines[run].lstrip())
    body: list[str] = []
    for line in lines[run + 1:]:
        if line.strip() and len(line) - len(line.lstrip()) <= indent:
            break
        body.append(line)
    return textwrap.dedent("\n".join(body)) + "\n"


class PreflightExtraFilesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="preflight-"))
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        shims = self.tmp / "bin"
        shims.mkdir()
        for tool in ("gh", "curl"):
            shim = shims / tool
            shim.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
            shim.chmod(0o755)
        self.path = f"{shims}{os.pathsep}{os.environ['PATH']}"
        self.script = self.tmp / "step.sh"
        self.script.write_text(step_script(WORKFLOW, STEP), encoding="utf-8")
        self.write(".github/workflows/release-please.yml", "name: release-please\n")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, rel: str, content: str) -> None:
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def configure(self, packages: dict[str, dict]) -> None:
        self.write(CONFIG, json.dumps({"packages": packages}))
        self.write(MANIFEST, json.dumps({p: "1.0.0" for p in packages}))

    def run_step(self) -> tuple[int, list[str]]:
        summary = self.tmp / "summary.md"
        summary.write_text("", encoding="utf-8")
        env = {
            "PATH": self.path,
            "HOME": str(self.tmp),
            "FAIL_ON": "breaking",
            "CONFIG_PATH": CONFIG,
            "MANIFEST_PATH": MANIFEST,
            "PUBLISH_PATH": ".github/workflows/publish.yml",
            "RP_PATH": ".github/workflows/release-please.yml",
            "PUBLISH_JSON": "",
            "SINGLE_LANG": "true",
            "GH_TOKEN": "",
            "REPO": "example/example",
            "GITHUB_STEP_SUMMARY": str(summary),
            "GITHUB_OUTPUT": str(self.tmp / "output"),
        }
        r = subprocess.run(["bash", str(self.script)], cwd=self.repo, env=env,
                           capture_output=True, text=True)
        return r.returncode, summary.read_text(encoding="utf-8").splitlines()

    def assertLine(self, lines: list[str], line: str) -> None:
        self.assertIn(line, lines, "\n".join(lines))

    def assertNoLine(self, lines: list[str], prefix: str) -> None:
        hits = [x for x in lines if x.startswith(prefix)]
        self.assertEqual(hits, [], "\n".join(lines))

    # --- check 5d: extra-files targets ---------------------------------------

    def test_package_relative_entry_resolves_under_the_package(self) -> None:
        self.configure({"sdk/ts": {"component": "ts", "extra-files": ["src/version.ts"]}})
        self.write("sdk/ts/src/version.ts", 'export const v = "1.0.0"; // x-release-please-version\n')
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[OK]    package sdk/ts: extra-files entry 'src/version.ts' "
                               "exists (sdk/ts/src/version.ts)")

    def test_leading_slash_string_entry_resolves_from_the_repo_root(self) -> None:
        self.configure({"sdk/ts": {"component": "ts",
                                   "extra-files": ["/templates/cli-ts/package.json.tmpl"]}})
        self.write("templates/cli-ts/package.json.tmpl",
                   '"version": "1.0.0", // x-release-please-version\n')
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[OK]    package sdk/ts: extra-files entry "
                               "'/templates/cli-ts/package.json.tmpl' exists "
                               "(templates/cli-ts/package.json.tmpl)")
        self.assertNoLine(lines, "[BREAK]")
        self.assertNoLine(lines, "[WARN]  extra-files target")

    def test_leading_slash_object_entry_resolves_from_the_repo_root(self) -> None:
        self.configure({"sdk/ts": {"component": "ts", "extra-files": [
            {"type": "json", "path": "/internal/builtins/package.json.tmpl",
             "jsonpath": "$.version"}]}})
        self.write("internal/builtins/package.json.tmpl",
                   '"version": "1.0.0" // x-release-please-version\n')
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[OK]    package sdk/ts: extra-files entry "
                               "'/internal/builtins/package.json.tmpl' exists "
                               "(internal/builtins/package.json.tmpl)")

    def test_leading_slash_entry_missing_at_the_repo_root_fails(self) -> None:
        self.configure({"sdk/ts": {"component": "ts", "extra-files": ["/templates/nope.tmpl"]}})
        # Present under the package only: release-please would not look there.
        self.write("sdk/ts/templates/nope.tmpl", "1.0.0 x-release-please-version\n")
        code, lines = self.run_step()
        self.assertEqual(code, 1, "\n".join(lines))
        self.assertLine(lines, "[BREAK] package sdk/ts lists extra-files entry "
                               "'/templates/nope.tmpl' but templates/nope.tmpl does not exist")

    def test_root_package_entries_resolve_from_the_repo_root(self) -> None:
        self.configure({".": {"component": "root", "extra-files": [
            "VERSION", "/docs/install.md"]}})
        self.write("VERSION", "1.0.0 # x-release-please-version\n")
        self.write("docs/install.md", "pin 1.0.0 <!-- x-release-please-version -->\n")
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[OK]    package .: extra-files entry 'VERSION' exists (VERSION)")
        self.assertLine(lines, "[OK]    package .: extra-files entry '/docs/install.md' "
                               "exists (docs/install.md)")

    def test_root_relative_target_without_annotation_warns(self) -> None:
        self.configure({"sdk/ts": {"component": "ts", "extra-files": ["/templates/plain.tmpl"]}})
        self.write("templates/plain.tmpl", "no annotation\n")
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[WARN]  extra-files target templates/plain.tmpl carries no "
                               "x-release-please-version annotation — release-please "
                               "rewrites nothing in it")

    # --- check 5b: python pyproject.toml override ----------------------------

    def test_python_package_relative_pyproject_entry_fails(self) -> None:
        self.configure({"py": {"component": "py", "release-type": "python",
                               "extra-files": ["pyproject.toml"]}})
        self.write("py/pyproject.toml", '[project]\nversion = "1.0.0"\n')
        code, lines = self.run_step()
        self.assertEqual(code, 1, "\n".join(lines))
        self.assertTrue(any(x.startswith("[BREAK] package py (release-type python) has an "
                                         "extra-files block targeting pyproject.toml")
                            for x in lines), "\n".join(lines))

    def test_python_root_relative_pyproject_entry_fails(self) -> None:
        self.configure({"py": {"component": "py", "release-type": "python", "extra-files": [
            {"type": "toml", "path": "/py/pyproject.toml", "jsonpath": "$.project.version"}]}})
        self.write("py/pyproject.toml", '[project]\nversion = "1.0.0"\n')
        code, lines = self.run_step()
        self.assertEqual(code, 1, "\n".join(lines))
        self.assertTrue(any(x.startswith("[BREAK] package py (release-type python) has an "
                                         "extra-files block targeting pyproject.toml")
                            for x in lines), "\n".join(lines))

    def test_python_root_package_root_relative_pyproject_entry_fails(self) -> None:
        self.configure({".": {"component": "py", "release-type": "python",
                              "extra-files": ["/pyproject.toml"]}})
        self.write("pyproject.toml", '[project]\nversion = "1.0.0"\n')
        code, lines = self.run_step()
        self.assertEqual(code, 1, "\n".join(lines))
        self.assertTrue(any(x.startswith("[BREAK] package . (release-type python) has an "
                                         "extra-files block targeting pyproject.toml")
                            for x in lines), "\n".join(lines))

    def test_python_other_package_pyproject_is_not_the_native_file(self) -> None:
        # A root-relative pyproject.toml of ANOTHER directory is not the
        # file release-type python rewrites for this package.
        self.configure({"py": {"component": "py", "release-type": "python",
                               "extra-files": ["/tools/pyproject.toml"]}})
        self.write("py/pyproject.toml", '[project]\nversion = "1.0.0"\n')
        self.write("tools/pyproject.toml", 'version = "1.0.0" # x-release-please-version\n')
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[OK]    package py: no extra-files override for pyproject.toml "
                               "(release-type python will normalize PEP 440 natively)")


    # --- check 7: release-please workflow token -----------------------------

    CALLER = textwrap.dedent("""\
        name: release-please
        on:
          push:
            branches: [main]
          workflow_dispatch: {}
        permissions:
          contents: read
        jobs:
          release-please:
            uses: hop-top/.github/.github/workflows/release-please-on-push.yml@v0
            secrets:
              RELEASE_BOT_APP_ID: ${{ secrets.RELEASE_BOT_APP_ID }}
              RELEASE_BOT_PRIVATE_KEY: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
        """)

    def test_caller_of_the_reusable_workflow_passes_the_token_check(self) -> None:
        self.configure({".": {"component": "x"}})
        self.write(".github/workflows/release-please.yml", self.CALLER)
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[OK]    release-please.yml calls the release-please-on-push "
                               "reusable workflow (release-bot App token, concurrency guard)")
        self.assertLine(lines, "[OK]    release-please.yml declares workflow_dispatch "
                               "(manual retrigger enabled)")
        self.assertNoLine(lines, "[WARN]  release-please.yml may be using GITHUB_TOKEN")

    def test_hand_rolled_job_on_github_token_still_warns(self) -> None:
        self.configure({".": {"component": "x"}})
        self.write(".github/workflows/release-please.yml", textwrap.dedent("""\
            name: release-please
            on:
              push:
                branches: [main]
            jobs:
              release-please:
                runs-on: ubuntu-latest
                steps:
                  - uses: googleapis/release-please-action@v4
            """))
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[WARN]  release-please.yml may be using GITHUB_TOKEN "
                               "— PRs won't trigger downstream workflows")


if __name__ == "__main__":
    unittest.main()
