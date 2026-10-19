"""Tests for the `Detect single-language adopter` and `Run preflight
checks` steps of release-please-preflight.yml.

Each step's `run:` block is lifted out of the workflow file verbatim and
run with bash inside a small fixture repository: a config, a manifest,
a release-please workflow stub and whatever files a test needs. Unless a
test runs the detect step, the publish checks are skipped
(`SINGLE_LANG=true`). `gh` / `curl` are shimmed to fail, so nothing
reaches the network. Assertions read the step summary lines (`[BREAK]`,
`[WARN]`, `[OK]`), the step outputs and the exit code.
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
DETECT_STEP = "Detect single-language adopter"
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


class PreflightFixture:
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

    def run_step(self, single_lang: str = "true",
                 go_only: str = "false") -> tuple[int, list[str]]:
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
            "SINGLE_LANG": single_lang,
            "GO_ONLY": go_only,
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


class PreflightExtraFilesTests(PreflightFixture, unittest.TestCase):

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


class PreflightTargetVersioningTests(PreflightFixture, unittest.TestCase):
    """Check 4b (`versioning: "target"`) and the target-aware parts of
    checks 4 and 5."""

    CALLER = textwrap.dedent("""\
        name: release-please
        on:
          push:
            branches: [main, next]
          workflow_dispatch: {}
        permissions:
          contents: read
        jobs:
          release-please:
            uses: hop-top/.github/.github/workflows/release-please-on-push.yml@v0
            secrets:
              RELEASE_BOT_APP_ID: ${{ secrets.RELEASE_BOT_APP_ID }}
              RELEASE_BOT_PRIVATE_KEY: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
            with:
              versioning-extension: true
        """)

    TARGET = {"release-type": "go", "prerelease": True, "prerelease-type": "alpha.0",
              "versioning": "target", "bump-minor-pre-major": True}

    def kit(self, **top) -> dict:
        packages = {
            ".": {"component": "kit", "exclude-paths": ["sdk", "incubator"], **self.TARGET},
            "sdk/ts": {"component": "kit-ts", **self.TARGET},
            "incubator/qmochi": {"component": "qmochi", **self.TARGET},
        }
        return {"plugins": [{"type": "target-context"},
                            {"type": "conditional-linked-versions", "groupName": "kit",
                             "components": ["kit", "kit-ts"]}],
                "packages": packages, **top}

    def setup_repo(self, config: dict, seeds: dict | None = None, caller: str | None = None) -> None:
        self.write(CONFIG, json.dumps(config))
        self.write(MANIFEST, json.dumps(seeds or {p: "0.5.0-alpha.3" for p in config["packages"]}))
        self.write(".github/workflows/release-please.yml", self.CALLER if caller is None else caller)

    def breaks(self, lines: list[str]) -> list[str]:
        return [x for x in lines if x.startswith("[BREAK]")]

    def test_kit_shaped_config_passes(self) -> None:
        self.setup_repo(self.kit())
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertEqual(self.breaks(lines), [])
        self.assertLine(lines, "[OK]    package .: prerelease four-piece combo complete")
        self.assertLine(lines, "[OK]    plugins: target-context present, ahead of any conditional-linked-versions")
        self.assertLine(lines, "[OK]    target-context options and 1 conditional-linked-versions group(s) well-formed")
        self.assertLine(lines, "[OK]    package sdk/ts: versioning target, channel alpha.0")
        self.assertLine(lines, "[OK]    release-please.yml runs release-please-on-push with versioning-extension: true")

    def test_stable_seed_is_fine_for_a_target_package(self) -> None:
        # On a stable branch the manifest carries the promoted stable.
        self.setup_repo(self.kit(), seeds={".": "0.6.0", "sdk/ts": "0.6.0", "incubator/qmochi": "0.2.0-alpha.1"})
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[OK]    package .: manifest seed '0.6.0' (versioning target: "
                               "the branch decides stable or prerelease)")

    def test_top_level_versioning_target_counts(self) -> None:
        config = self.kit()
        for pkg in config["packages"].values():
            del pkg["versioning"]
        config["versioning"] = "target"
        self.setup_repo(config)
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[OK]    package incubator/qmochi: versioning target, channel alpha.0")

    def test_missing_target_context_fails(self) -> None:
        config = self.kit()
        config["plugins"] = config["plugins"][1:]
        self.setup_repo(config)
        code, lines = self.run_step()
        self.assertEqual(code, 1)
        self.assertLine(lines, "[BREAK] packages . incubator/qmochi sdk/ts use versioning target "
                               "but plugins has no target-context")

    def test_target_context_after_a_group_fails(self) -> None:
        config = self.kit()
        config["plugins"].reverse()
        self.setup_repo(config)
        code, lines = self.run_step()
        self.assertEqual(code, 1)
        self.assertLine(lines, "[BREAK] plugins lists conditional-linked-versions before target-context")

    def test_bad_groups_fail(self) -> None:
        config = self.kit()
        config["packages"]["sdk/py"] = {"component": "kit-py", "release-type": "python"}
        config["plugins"] += [
            {"type": "conditional-linked-versions", "groupName": "sdk", "components": ["kit-ts", "kit-py", "nope"]},
            {"type": "conditional-linked-versions", "components": ["kit"]},
            {"type": "conditional-linked-versions", "groupName": "empty", "components": []},
            {"type": "linked-versions", "groupName": "old", "components": ["qmochi"]},
        ]
        self.setup_repo(config)
        code, lines = self.run_step()
        self.assertEqual(code, 1)
        for line in ("group sdk: component kit-py (sdk/py) does not use versioning target",
                     "group sdk: component nope is not a configured component",
                     "a conditional-linked-versions entry has no groupName",
                     "group empty: components must be a non-empty array",
                     "component kit-ts is in more than one conditional-linked-versions group",
                     "component qmochi uses versioning target but sits in a linked-versions group"):
            self.assertLine(lines, f"[BREAK] {line}")

    def test_bad_target_context_options_fail(self) -> None:
        config = self.kit()
        config["plugins"][0] = {"type": "target-context", "stableBranches": ["main", "next"],
                                "prereleaseBranches": "next", "maintenanceBranchPattern": 3}
        self.setup_repo(config)
        code, lines = self.run_step()
        self.assertEqual(code, 1)
        self.assertLine(lines, "[BREAK] target-context prereleaseBranches must be an array of branch names")
        self.assertLine(lines, "[BREAK] target-context maintenanceBranchPattern must be a string (a regular expression)")
        config["plugins"][0] = {"type": "target-context", "stableBranches": ["main", "next"]}
        self.setup_repo(config)
        code, lines = self.run_step()
        self.assertEqual(code, 1)
        self.assertLine(lines, "[BREAK] target-context: branch next is in both stableBranches and prereleaseBranches")

    def test_package_constraints(self) -> None:
        config = self.kit()
        config["packages"]["."]["prerelease-type"] = "alpha"
        config["packages"]["sdk/ts"]["release-as"] = "0.6.0-alpha.0"
        config["packages"]["incubator/qmochi"]["bump-patch-for-minor-pre-major"] = True
        self.setup_repo(config)
        code, lines = self.run_step()
        self.assertEqual(code, 1)
        self.assertLine(lines, "[BREAK] package . prerelease-type 'alpha' is not a target channel")
        self.assertLine(lines, "[BREAK] package sdk/ts sets release-as '0.6.0-alpha.0' — target versioning picks the version")
        self.assertLine(lines, "[BREAK] package incubator/qmochi: bump-minor-pre-major false / "
                               "bump-patch-for-minor-pre-major true contradict target versioning "
                               "(pre-1.0 breaking or feat -> minor)")

    def test_caller_without_the_extension_fails(self) -> None:
        for caller in (PreflightExtraFilesTests.CALLER,
                       self.CALLER.replace("versioning-extension: true", "versioning-extension: false"),
                       self.CALLER.replace("      versioning-extension: true", "      # versioning-extension: true")):
            self.setup_repo(self.kit(), caller=caller)
            code, lines = self.run_step()
            self.assertEqual(code, 1, caller)
            self.assertLine(lines, "[BREAK] packages . incubator/qmochi sdk/ts use versioning target, but "
                                   "release-please.yml does not run release-please-on-push with "
                                   "versioning-extension: true (release-please-action has no target versioning)")

    def test_stock_prerelease_config_is_untouched(self) -> None:
        config = self.kit()
        for pkg in config["packages"].values():
            pkg["versioning"] = "prerelease"
        config["plugins"] = []
        self.setup_repo(config, caller=PreflightExtraFilesTests.CALLER)
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertNotIn("### target versioning", lines)
        self.assertNoLine(lines, "[BREAK]")


class PreflightPublishWorkflowTests(PreflightFixture, unittest.TestCase):
    """Whether a missing publish.yml is a misconfiguration.

    The detect step decides; its `single_lang` output feeds the checks
    step exactly as the workflow wires it.
    """

    PUBLISH_MISSING = "[BREAK] publish workflow not found at .github/workflows/publish.yml"
    PUBLISH_ABSENT_OK = ("[INFO]  publish workflow absent (single-language adopter — "
                         "proxy.golang.org / direct registry pull)")

    PRERELEASE = {"initial-version": "0.1.0-alpha.0", "prerelease": True,
                  "prerelease-type": "alpha.0", "versioning": "prerelease",
                  "bump-minor-pre-major": True}

    def setUp(self) -> None:
        super().setUp()
        self.detect = self.tmp / "detect.sh"
        self.detect.write_text(step_script(WORKFLOW, DETECT_STEP), encoding="utf-8")

    def configure_raw(self, config: dict) -> None:
        self.write(CONFIG, json.dumps(config))
        self.write(MANIFEST, json.dumps({p: "0.1.0-alpha.0" for p in config["packages"]}))

    def detect_outputs(self) -> dict[str, str]:
        output = self.tmp / "detect-output"
        output.write_text("", encoding="utf-8")
        env = {
            "PATH": self.path,
            "HOME": str(self.tmp),
            "CONFIG_PATH": CONFIG,
            "PUBLISH_PATH": ".github/workflows/publish.yml",
            "GITHUB_OUTPUT": str(output),
        }
        r = subprocess.run(["bash", str(self.detect)], cwd=self.repo, env=env,
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return dict(line.split("=", 1) for line in
                    output.read_text(encoding="utf-8").splitlines() if "=" in line)

    def detect_single_lang(self) -> str:
        return self.detect_outputs()["single_lang"]

    def run_preflight(self) -> tuple[str, int, list[str]]:
        out = self.detect_outputs()
        code, lines = self.run_step(single_lang=out["single_lang"],
                                    go_only=out["go_only"])
        return out["single_lang"], code, lines

    def go_module_repo(self) -> dict:
        """Root module on bare v* tags plus a submodule on postgres/v* tags."""
        return {
            "include-component-in-tag": False,
            "packages": {
                ".": {"release-type": "go", "component": "app",
                      "exclude-paths": ["postgres"], **self.PRERELEASE},
                "postgres": {"release-type": "go", "component": "postgres",
                             "include-component-in-tag": True, "tag-separator": "/",
                             "include-v-in-tag": True, **self.PRERELEASE},
            },
        }

    def test_multi_module_go_repo_without_publish_workflow_passes(self) -> None:
        self.configure_raw(self.go_module_repo())
        single, code, lines = self.run_preflight()
        self.assertEqual(single, "true")
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, self.PUBLISH_ABSENT_OK)
        self.assertNoLine(lines, "[BREAK]")

    def test_top_level_go_release_type_covers_every_package(self) -> None:
        self.configure_raw({"release-type": "go", "packages": {
            ".": {"component": "app", "exclude-paths": ["postgres"]},
            "postgres": {"component": "postgres"}}})
        single, code, lines = self.run_preflight()
        self.assertEqual(single, "true")
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, self.PUBLISH_ABSENT_OK)

    def test_polyglot_repo_without_publish_workflow_fails(self) -> None:
        config = self.go_module_repo()
        config["packages"]["ts"] = {"release-type": "node", "component": "app-ts"}
        self.configure_raw(config)
        single, code, lines = self.run_preflight()
        self.assertEqual(single, "false")
        self.assertEqual(code, 1, "\n".join(lines))
        self.assertLine(lines, self.PUBLISH_MISSING)

    def test_package_overriding_top_level_go_release_type_fails(self) -> None:
        self.configure_raw({"release-type": "go", "packages": {
            ".": {"component": "app"},
            "py": {"component": "app-py", "release-type": "python"}}})
        single, code, lines = self.run_preflight()
        self.assertEqual(single, "false")
        self.assertEqual(code, 1, "\n".join(lines))
        self.assertLine(lines, self.PUBLISH_MISSING)

    def test_multi_package_without_release_type_fails(self) -> None:
        self.configure_raw({"packages": {
            "a": {"component": "a"}, "b": {"component": "b"}}})
        single, code, lines = self.run_preflight()
        self.assertEqual(single, "false")
        self.assertEqual(code, 1, "\n".join(lines))
        self.assertLine(lines, self.PUBLISH_MISSING)

    def test_single_package_without_publish_workflow_passes(self) -> None:
        self.configure_raw({"packages": {".": {"release-type": "go", "component": "app"}}})
        single, code, lines = self.run_preflight()
        self.assertEqual(single, "true")
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, self.PUBLISH_ABSENT_OK)

    def test_go_repo_with_publish_workflow_runs_publish_checks(self) -> None:
        self.configure_raw(self.go_module_repo())
        self.write(".github/workflows/publish.yml", "name: publish\n")
        self.assertEqual(self.detect_single_lang(), "false")


    # --- check 3: nested (slash) component names -----------------------------

    NESTED_FAIL = ("[BREAK] component 'stores/postgres' contains '/' — tag '*/v*' "
                   "glob does NOT match nested paths")
    NESTED_GO_OK = ("[OK]    component 'stores/postgres' is nested — Go-only repo, "
                    "tag 'stores/postgres/v<version>' is the module-path tag Go "
                    "expects (no publish.yml glob)")

    def nested_go_module_repo(self) -> dict:
        """Root module on bare v* tags plus a submodule two directories deep."""
        config = self.go_module_repo()
        sub = config["packages"].pop("postgres")
        sub["component"] = "stores/postgres"
        config["packages"]["stores/postgres"] = sub
        config["packages"]["."]["exclude-paths"] = ["stores/postgres"]
        return config

    def test_go_only_repo_accepts_nested_component(self) -> None:
        self.configure_raw(self.nested_go_module_repo())
        single, code, lines = self.run_preflight()
        self.assertEqual(single, "true")
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, self.NESTED_GO_OK)
        self.assertNoLine(lines, "[BREAK]")

    def test_nested_component_with_publish_workflow_fails(self) -> None:
        # publish.yml present: its '*/v*' trigger would miss the nested tag.
        self.configure_raw(self.nested_go_module_repo())
        self.write(".github/workflows/publish.yml", "name: publish\n")
        _, code, lines = self.run_preflight()
        self.assertEqual(code, 1, "\n".join(lines))
        self.assertLine(lines, self.NESTED_FAIL)

    def test_non_go_nested_component_fails(self) -> None:
        # A single package passes the publish.yml-absent check, but only a
        # Go-only repo may use a nested component.
        self.configure_raw({"packages": {"stores/postgres": {
            "release-type": "node", "component": "stores/postgres"}}})
        single, code, lines = self.run_preflight()
        self.assertEqual(single, "true")
        self.assertEqual(code, 1, "\n".join(lines))
        self.assertLine(lines, self.NESTED_FAIL)


if __name__ == "__main__":
    unittest.main()
