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

import importlib.util
import json
import os
import shutil
import site
import subprocess
import sys
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
HAS_TOML = any(importlib.util.find_spec(m) for m in ("tomllib", "tomli"))
HAS_YAML = importlib.util.find_spec("yaml") is not None


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
        # The step's python3 is the interpreter running the tests, user site
        # included (HOME is the temp dir), so which parsers it has (tomllib /
        # tomli, PyYAML) is known here.
        python = shims / "python3"
        python.write_text(f'#!/bin/sh\nPYTHONUSERBASE="{site.getuserbase()}" '
                          f'exec "{sys.executable}" "$@"\n', encoding="utf-8")
        python.chmod(0o755)
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
                 go_only: str = "false", branch: str = "") -> tuple[int, list[str]]:
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
            "BRANCH": branch,
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
        self.write("internal/builtins/package.json.tmpl", '{"version": "1.0.0"}\n')
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

    def test_block_annotation_counts_as_an_annotation(self) -> None:
        self.configure({".": {"component": "x", "extra-files": [
            "README.md", {"type": "generic", "path": "install.sh"}]}})
        self.write("README.md", "<!-- x-release-please-start-version -->\n1.0.0\n"
                                "<!-- x-release-please-end -->\n")
        self.write("install.sh", "MAJOR=1 # x-release-please-major\n")
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertNoLine(lines, "[WARN]  extra-files target")

    # --- check 5d: typed extra-files (json / yaml / toml / xml / pom) --------

    def warns(self, lines: list[str]) -> list[str]:
        return [x for x in lines if x.startswith("[WARN]  extra-files target")]

    def test_kit_json_extra_files_resolve_without_an_annotation(self) -> None:
        # poly-kit's config: release-please rewrites these through the
        # jsonpath, never through an x-release-please-version annotation.
        self.write(CONFIG, json.dumps({"packages": {
            ".": {"component": "kit", "release-type": "go", "extra-files": [
                {"type": "generic", "path": "templates/cli-go/go.mod.tmpl"},
                {"type": "json", "path": "engine/sdk/ts-kit-engine/package.json",
                 "jsonpath": "$.kit.version"}]},
            "sdk/experimental/php": {"component": "kit-php", "release-type": "php",
                                     "extra-files": [{"type": "json", "path": "composer.json",
                                                      "jsonpath": "$.version"}]}}}))
        self.write(MANIFEST, json.dumps({".": "0.5.0-alpha.26",
                                         "sdk/experimental/php": "0.5.0-alpha.2"}))
        self.write("templates/cli-go/go.mod.tmpl",
                   "require hop.top/kit v0.5.0-alpha.26 // x-release-please-version\n")
        self.write("engine/sdk/ts-kit-engine/package.json", json.dumps(
            {"name": "@hop-top/kit-engine", "version": "0.1.0",
             "kit": {"version": "0.5.0-alpha.26"}}, indent=2))
        self.write("sdk/experimental/php/composer.json", json.dumps(
            {"name": "hop-top/kit", "version": "0.5.0-alpha.2"}, indent=2))
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertEqual(self.warns(lines), [])
        self.assertLine(lines, "[OK]    extra-files target engine/sdk/ts-kit-engine/package.json: "
                               "$.kit.version = 0.5.0-alpha.26")
        self.assertLine(lines, "[OK]    extra-files target sdk/experimental/php/composer.json: "
                               "$.version = 0.5.0-alpha.2")

    def test_json_jsonpath_matching_nothing_warns(self) -> None:
        self.configure({"sdk/ts": {"component": "ts", "extra-files": [
            {"type": "json", "path": "package.json", "jsonpath": "$.kit.version"}]}})
        self.write("sdk/ts/package.json", '{"version": "1.0.0"}\n')
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertEqual(self.warns(lines), [
            "[WARN]  extra-files target sdk/ts/package.json: jsonpath $.kit.version matches "
            "nothing — release-please rewrites nothing in it"])

    def test_json_jsonpath_on_a_non_version_warns(self) -> None:
        self.configure({"sdk/ts": {"component": "ts", "extra-files": [
            {"type": "json", "path": "package.json", "jsonpath": "$.version"},
            {"type": "json", "path": "meta.json", "jsonpath": "$['build'].tags[1]"}]}})
        self.write("sdk/ts/package.json", '{"version": 1}\n')
        self.write("sdk/ts/meta.json", '{"build": {"tags": ["x", "latest"]}}\n')
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertEqual(self.warns(lines), [
            "[WARN]  extra-files target sdk/ts/package.json: jsonpath $.version is 1, "
            "not a version string — release-please rewrites nothing in it",
            "[WARN]  extra-files target sdk/ts/meta.json: jsonpath $['build'].tags[1] is "
            "\"latest\", not a version string — release-please rewrites nothing in it"])

    def test_json_target_that_does_not_parse_fails(self) -> None:
        self.configure({"sdk/ts": {"component": "ts", "extra-files": [
            {"type": "json", "path": "package.json.tmpl", "jsonpath": "$.version"},
            "version.json"]}})
        self.write("sdk/ts/package.json.tmpl", '{"name": "{{ .Name }}", "version": "1.0.0",}\n')
        self.write("sdk/ts/version.json", '// x-release-please-version\n{"v": "1.0.0"}\n')
        code, lines = self.run_step()
        self.assertEqual(code, 1, "\n".join(lines))
        for target in ("sdk/ts/package.json.tmpl", "sdk/ts/version.json"):
            self.assertTrue(any(x.startswith(f"[BREAK] extra-files target {target} is not valid "
                                             "JSON (") and x.endswith(") — release-please fails "
                                                                      "parsing it")
                                for x in lines), "\n".join(lines))

    def test_typed_entry_without_its_selector_fails(self) -> None:
        self.configure({"sdk/ts": {"component": "ts", "extra-files": [
            {"type": "json", "path": "package.json"},
            {"type": "xml", "path": "app.xml"}]}})
        self.write("sdk/ts/package.json", '{"version": "1.0.0"}\n')
        self.write("sdk/ts/app.xml", "<app><version>1.0.0</version></app>\n")
        code, lines = self.run_step()
        self.assertEqual(code, 1, "\n".join(lines))
        self.assertLine(lines, "[BREAK] package sdk/ts extra-files entry 'package.json' (type json) "
                               "has no jsonpath — release-please fails on it")
        self.assertLine(lines, "[BREAK] package sdk/ts extra-files entry 'app.xml' (type xml) "
                               "has no xpath — release-please fails on it")

    def test_unsupported_or_missing_type_fails(self) -> None:
        self.configure({"sdk/ts": {"component": "ts", "extra-files": [
            {"type": "jsn", "path": "package.json", "jsonpath": "$.version"},
            {"path": "VERSION"}]}})
        self.write("sdk/ts/package.json", '{"version": "1.0.0"}\n')
        self.write("sdk/ts/VERSION", "1.0.0 x-release-please-version\n")
        code, lines = self.run_step()
        self.assertEqual(code, 1, "\n".join(lines))
        self.assertLine(lines, "[BREAK] package sdk/ts extra-files entry 'package.json' has type "
                               "'jsn' — release-please supports generic, json, yaml, toml, xml, pom")
        self.assertLine(lines, "[BREAK] package sdk/ts extra-files entry 'VERSION' has no type "
                               "— release-please supports generic, json, yaml, toml, xml, pom")

    @unittest.skipUnless(HAS_TOML, "no TOML parser: the step reports a toml jsonpath as not evaluated")
    def test_toml_jsonpath_resolves_or_warns(self) -> None:
        # A go root bumping an embedded Python SDK's pyproject: check 5b is
        # about release-type python packages only.
        self.configure({".": {"component": "kit", "release-type": "go", "extra-files": [
            {"type": "toml", "path": "engine/py/pyproject.toml", "jsonpath": "$.project.version"},
            {"type": "toml", "path": "engine/rs/Cargo.toml", "jsonpath": "$.package.version"}]}})
        self.write("engine/py/pyproject.toml", '[project]\nname = "x"\nversion = "1.0.0"\n')
        self.write("engine/rs/Cargo.toml", '[workspace.package]\nversion = "1.0.0"\n')
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[OK]    extra-files target engine/py/pyproject.toml: "
                               "$.project.version = 1.0.0")
        self.assertEqual(self.warns(lines), [
            "[WARN]  extra-files target engine/rs/Cargo.toml: jsonpath $.package.version "
            "matches nothing — release-please rewrites nothing in it"])

    @unittest.skipUnless(HAS_TOML, "no TOML parser: the step reports a toml jsonpath as not evaluated")
    def test_toml_target_that_does_not_parse_warns(self) -> None:
        self.configure({".": {"component": "kit", "extra-files": [
            {"type": "toml", "path": "tool.toml", "jsonpath": "$.version"}]}})
        self.write("tool.toml", 'version = "1.0.0\n')
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertTrue(any(x.startswith("[WARN]  extra-files target tool.toml is not valid "
                                         "toml (") for x in lines), "\n".join(lines))

    @unittest.skipUnless(HAS_YAML, "no PyYAML: the step reports a yaml jsonpath as not evaluated")
    def test_yaml_jsonpath_resolves_or_warns(self) -> None:
        self.configure({".": {"component": "kit", "extra-files": [
            {"type": "yaml", "path": "chart/Chart.yaml", "jsonpath": "$.appVersion"},
            {"type": "yaml", "path": "kit-template.yaml", "jsonpath": "$.kit.version"}]}})
        self.write("chart/Chart.yaml", "apiVersion: v2\nappVersion: 1.0.0\n")
        self.write("kit-template.yaml", "kit:\n  name: x\n")
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[OK]    extra-files target chart/Chart.yaml: $.appVersion = 1.0.0")
        self.assertEqual(self.warns(lines), [
            "[WARN]  extra-files target kit-template.yaml: jsonpath $.kit.version matches "
            "nothing — release-please rewrites nothing in it"])

    def test_complex_jsonpath_is_reported_not_evaluated(self) -> None:
        self.configure({".": {"component": "kit", "extra-files": [
            {"type": "json", "path": "deps.json", "jsonpath": "$..version"}]}})
        self.write("deps.json", '{"a": {"version": "1.0.0"}}\n')
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertEqual(self.warns(lines), [])
        self.assertLine(lines, "[INFO]  extra-files target deps.json: jsonpath $..version not "
                               "evaluated by the preflight (beyond $.a.b / [n] paths)")

    def test_xml_and_pom_entries_need_no_annotation(self) -> None:
        self.configure({"java": {"component": "java", "extra-files": [
            {"type": "xml", "path": "app.xml", "xpath": "//app/version"},
            {"type": "pom", "path": "pom.xml"}]}})
        self.write("java/app.xml", "<app><version>1.0.0</version></app>\n")
        self.write("java/pom.xml", "<project><version>1.0.0</version></project>\n")
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertEqual(self.warns(lines), [])
        self.assertNoLine(lines, "[BREAK]")

    def test_string_entries_with_a_structured_extension_use_the_version_key(self) -> None:
        # release-please updates `$.version` (`/*/version` for XML) of a plain
        # *.json / *.yaml / *.toml / *.xml entry, then its annotations.
        self.configure({"sdk/ts": {"component": "ts", "extra-files": [
            "package.json", "meta.toml", "app.xml", "annotated.json", "bare.json"]}})
        self.write("sdk/ts/package.json", '{"name": "x", "version": "1.0.0"}\n')
        self.write("sdk/ts/meta.toml", 'version = "1.0.0"\n')
        self.write("sdk/ts/app.xml", "<app><version>1.0.0</version></app>\n")
        self.write("sdk/ts/annotated.json", '{"pin": "1.0.0 x-release-please-version"}\n')
        self.write("sdk/ts/bare.json", '{"name": "x"}\n')
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[OK]    extra-files target sdk/ts/package.json: $.version = 1.0.0")
        if HAS_TOML:
            self.assertLine(lines, "[OK]    extra-files target sdk/ts/meta.toml: $.version = 1.0.0")
        self.assertLine(lines, "[OK]    extra-files target sdk/ts/app.xml: /*/version = 1.0.0")
        self.assertEqual(self.warns(lines), [
            "[WARN]  extra-files target sdk/ts/bare.json carries no x-release-please-version "
            "annotation and no version at $.version — release-please rewrites nothing in it"])

    def test_glob_entry_is_not_checked_as_a_file(self) -> None:
        self.configure({".": {"component": "kit", "extra-files": [
            {"type": "json", "path": "sdk/*/package.json", "jsonpath": "$.version", "glob": True}]}})
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[INFO]  package .: extra-files entry 'sdk/*/package.json' is a glob "
                               "— its matches are not checked by the preflight")

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
        self.assertLine(lines, "[OK]    package sdk/ts: versioning target")
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
        self.assertLine(lines, "[OK]    package incubator/qmochi: versioning target")

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
        self.assertLine(lines, "[BREAK] package . prerelease-type 'alpha': every target line starts on alpha.0")
        self.assertLine(lines, "[BREAK] package sdk/ts sets release-as '0.6.0-alpha.0' — target versioning picks the version")
        self.assertLine(lines, "[BREAK] package incubator/qmochi: bump-minor-pre-major false / "
                               "bump-patch-for-minor-pre-major true contradict target versioning "
                               "(pre-1.0 breaking or feat -> minor)")

    # --- x-channel / x-open-line records ----------------------------------------

    def test_kit_mixed_promotion_passes(self) -> None:
        # kit and qmochi promoted to beta on their current lines; kit-ts stays alpha.
        config = self.kit()
        config["packages"]["."]["x-channel"] = {"line": "0.5.0", "channel": "beta"}
        config["packages"]["incubator/qmochi"]["x-channel"] = {"line": "0.2.0", "channel": "beta"}
        self.setup_repo(config, seeds={".": "0.5.0-alpha.26", "sdk/ts": "0.5.0-alpha.3",
                                       "incubator/qmochi": "0.2.0-alpha.1"})
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[OK]    package .: versioning target, beta promotion for 0.5.0")
        self.assertLine(lines, "[OK]    package incubator/qmochi: versioning target, beta promotion for 0.2.0")
        self.assertLine(lines, "[OK]    package sdk/ts: versioning target")

    def test_applied_and_next_step_promotions_pass(self) -> None:
        config = self.kit()
        config["packages"]["."]["x-channel"] = {"line": "0.5.0", "channel": "beta"}
        config["packages"]["sdk/ts"]["x-channel"] = {"line": "0.5.0", "channel": "rc"}
        config["packages"]["incubator/qmochi"]["x-open-line"] = "1.0.0"
        self.setup_repo(config, seeds={".": "0.5.0-beta.2", "sdk/ts": "0.5.0-beta.4",
                                       "incubator/qmochi": "0.9.0-alpha.3"})
        code, lines = self.run_step()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertLine(lines, "[OK]    package sdk/ts: versioning target, rc promotion for 0.5.0")
        self.assertLine(lines, "[OK]    package incubator/qmochi: versioning target, opens 1.0.0")

    def test_bad_records_fail(self) -> None:
        cases = [
            ({"x-channel": {"line": "0.4.0", "channel": "beta"}}, "0.5.0-alpha.3",
             "package . x-channel is for line 0.4.0, but its current target is 0.5.0 (manifest 0.5.0-alpha.3)"),
            ({"x-channel": {"line": "0.5.0", "channel": "beta"}}, "0.5.0",
             "package . x-channel is for line 0.5.0, but the manifest has stable '0.5.0': no open line to promote"),
            ({"x-channel": {"line": "0.5.0", "channel": "rc"}}, "0.5.0-alpha.3",
             "package . x-channel rc skips a channel from 0.5.0-alpha.3: channels move alpha -> beta -> rc"),
            ({"x-channel": {"line": "0.5.0", "channel": "beta"}}, "0.5.0-rc.1",
             "package . x-channel beta is behind its current 0.5.0-rc.1: channels never move backwards"),
            ({"x-channel": {"line": "0.5.0", "channel": "alpha"}}, "0.5.0-alpha.3",
             'package . x-channel {"line":"0.5.0","channel":"alpha"}: expected {"line": "x.y.z", "channel": "beta" | "rc"}'),
            ({"x-channel": "beta"}, "0.5.0-alpha.3",
             'package . x-channel "beta": expected {"line": "x.y.z", "channel": "beta" | "rc"}'),
            ({"x-open-line": "1.0.0"}, "1.0.0-alpha.2", "package . x-open-line 1.0.0 is already reached (manifest 1.0.0-alpha.2)"),
            ({"x-open-line": "1.0"}, "0.9.0-alpha.2", 'package . x-open-line "1.0": expected "x.y.z"'),
            ({"prerelease-type": "beta.0"}, "0.5.0-alpha.3", "package . prerelease-type 'beta.0': every target line starts on alpha.0"),
        ]
        for extra, seed, line in cases:
            config = self.kit()
            config["packages"]["."].update(extra)
            self.setup_repo(config, seeds={".": seed, "sdk/ts": "0.5.0-alpha.3", "incubator/qmochi": "0.2.0-alpha.1"})
            code, lines = self.run_step()
            self.assertEqual(code, 1, line)
            self.assertLine(lines, f"[BREAK] {line}")

    def test_records_are_checked_on_the_prerelease_branch_only(self) -> None:
        # main carries next's config as merged: a promotion for the line it
        # just cut, an open line it reached; inert there.
        config = self.kit()
        config["packages"]["."]["x-channel"] = {"line": "0.6.0", "channel": "rc"}
        config["packages"]["incubator/qmochi"]["x-open-line"] = "0.2.0"
        seeds = {".": "0.6.0", "sdk/ts": "0.6.0", "incubator/qmochi": "0.2.0"}
        self.setup_repo(config, seeds=seeds)
        for branch in ("main", "release/0.6"):
            code, lines = self.run_step(branch=branch)
            self.assertEqual(code, 0, "\n".join(lines))
            self.assertLine(lines, f"[INFO]  branch {branch} is not a prerelease branch (next): x-channel / x-open-line "
                                   "records are inert here and not checked against the manifest")
        for branch in ("next", ""):
            code, lines = self.run_step(branch=branch)
            self.assertEqual(code, 1, branch)
            self.assertLine(lines, "[BREAK] package . x-channel is for line 0.6.0, but the manifest has stable "
                                   "'0.6.0': no open line to promote")
            self.assertLine(lines, "[BREAK] package incubator/qmochi x-open-line 0.2.0 is already reached (manifest 0.2.0)")
        # target-context names the prerelease branches
        config["plugins"][0] = {"type": "target-context", "prereleaseBranches": ["develop"]}
        self.setup_repo(config, seeds=seeds)
        self.assertEqual(self.run_step(branch="next")[0], 0)
        self.assertEqual(self.run_step(branch="develop")[0], 1)

    def test_record_shapes_are_checked_on_every_branch(self) -> None:
        config = self.kit()
        config["packages"]["."]["x-channel"] = {"line": "0.6", "channel": "rc"}
        self.setup_repo(config, seeds={".": "0.6.0", "sdk/ts": "0.6.0", "incubator/qmochi": "0.2.0"})
        code, lines = self.run_step(branch="main")
        self.assertEqual(code, 1)
        self.assertLine(lines, '[BREAK] package . x-channel {"line":"0.6","channel":"rc"}: '
                               'expected {"line": "x.y.z", "channel": "beta" | "rc"}')

    def test_records_on_a_non_target_package_fail(self) -> None:
        config = self.kit()
        config["packages"]["tools"] = {"component": "tools", "release-type": "simple",
                                       "x-channel": {"line": "1.0.0", "channel": "beta"}}
        self.setup_repo(config, seeds={".": "0.5.0-alpha.3", "sdk/ts": "0.5.0-alpha.3",
                                       "incubator/qmochi": "0.2.0-alpha.1", "tools": "1.0.0"})
        code, lines = self.run_step()
        self.assertEqual(code, 1)
        self.assertLine(lines, "[BREAK] package tools has x-channel but does not use versioning target")

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
