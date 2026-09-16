"""Tests for scripts/spec/version_check.py.

Each test builds a small tree in a temporary git repository -- a
manifest, a config and a few tracked files -- and runs the checker on
it through its ``--root`` flag, asserting on exit code and findings.
The literals below are the checker's inputs by construction.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "version_check.py"

MANIFEST = {"go": "1.0.0-alpha.0", "ts": "1.0.0-alpha.0", "py": "1.0.0-alpha.0",
            "spec/v1.0": "1.0.0-alpha.0"}
PACKAGES = {
    "go": {"release-type": "go", "component": "example"},
    "ts": {"release-type": "node", "component": "example-ts"},
    "py": {"release-type": "python", "component": "example-py"},
    "spec/v1.0": {"release-type": "simple", "component": "example-spec"},
}


def _config(extra: dict[str, list[str]] | None = None,
            packages: dict[str, dict] | None = None) -> str:
    packages = {k: dict(v) for k, v in (packages or PACKAGES).items()}
    for pkg, files in (extra or {}).items():
        packages[pkg]["extra-files"] = files
    return json.dumps({"packages": packages})


class VersionCheckTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vc-"))
        subprocess.run(["git", "init", "--quiet", str(self.tmp)], check=True)
        self.write(".github/.release-please-manifest.json", json.dumps(MANIFEST))
        self.write(".github/release-please-config.json", _config())

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, rel: str, content: str) -> None:
        path = self.tmp / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def run_check(self, *args: str) -> subprocess.CompletedProcess:
        subprocess.run(["git", "-C", str(self.tmp), "add", "-A"], check=True)
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.tmp), *args],
            capture_output=True, text=True, env=env,
        )

    # --- ok path ------------------------------------------------------------

    def test_ok(self) -> None:
        self.write(".github/release-please-config.json", _config({"ts": ["src/version.ts"]}))
        self.write("ts/src/version.ts",
                   'export const version = "1.0.0-alpha.0"; // x-release-please-version\n')
        self.write("docs/a.md", "See spec/v1.0/03.md; pin X.Y.Z-alpha.N.\n")
        self.write("ts/CHANGELOG.md", "## 1.0.0-alpha.0\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("version-check: ok (1 annotated,", r.stdout)

    def test_root_defaults_to_the_current_directory(self) -> None:
        self.write("docs/a.md", "pin 1.0.0-alpha.7 here\n")
        subprocess.run(["git", "-C", str(self.tmp), "add", "-A"], check=True)
        r = subprocess.run(
            [sys.executable, str(SCRIPT)], cwd=str(self.tmp),
            capture_output=True, text=True,
        )
        self.assertEqual(r.returncode, 1)
        self.assertIn("docs/a.md:1: literal: 1.0.0-alpha.7", r.stdout)

    # --- rule 1: annotated => current -------------------------------------

    def test_annotated_literal_must_equal_manifest(self) -> None:
        self.write(".github/release-please-config.json", _config({"ts": ["src/version.ts"]}))
        self.write("ts/src/version.ts",
                   'export const version = "1.0.0-alpha.9"; // x-release-please-version\n')
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("ts/src/version.ts:1: annotated: 1.0.0-alpha.9 != manifest[ts] = 1.0.0-alpha.0", r.stdout)

    def test_annotated_line_with_a_second_pep440_token_fails(self) -> None:
        # The updater rewrites the first SemVer match only; a PEP 440
        # spelling elsewhere on the line would go stale unseen.
        self.write(".github/release-please-config.json", _config({"py": ["README.md"]}))
        self.write("py/README.md",
                   "pin `==1.0.0-alpha.0` (pip normalizes it to `1.0.0a0`). "
                   "<!-- x-release-please-version -->\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("py/README.md:1: annotated: expected exactly one version literal "
                      "on the annotated line, found 2", r.stdout)

    def test_annotation_outside_a_package_fails(self) -> None:
        self.write("docs/a.md", "pin 1.0.0-alpha.0 <!-- x-release-please-version -->\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("docs/a.md:1: annotated: annotation outside every release-please package path", r.stdout)

    def test_prose_naming_the_annotation_outside_a_package_is_ignored(self) -> None:
        self.write("docs/a.md", "each carries `x-release-please-version` on the literal's line\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("version-check: ok (0 annotated,", r.stdout)

    # --- rule 2: annotated <=> configured ---------------------------------

    def test_configured_file_without_annotation_fails(self) -> None:
        self.write(".github/release-please-config.json", _config({"py": ["README.md"]}))
        self.write("py/README.md", "no annotation here\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("py/README.md:0: configured: listed in extra-files but carries no x-release-please-version line", r.stdout)

    def test_annotated_file_not_configured_fails(self) -> None:
        self.write("py/README.md", "pin (`==1.0.0-alpha.0`) <!-- x-release-please-version -->\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("py/README.md:0: configured: carries x-release-please-version but is not an extra-files entry", r.stdout)

    # --- rule 3: no stray literals ----------------------------------------

    def test_manifest_value_literal_fails(self) -> None:
        self.write("docs/a.md", "Install 1.0.0-alpha.0 today.\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("docs/a.md:1: literal: 1.0.0-alpha.0 equals a manifest version", r.stdout)

    def test_channel_shape_literal_fails(self) -> None:
        self.write("docs/a.md", "pin 1.0.0-alpha.7 here\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("docs/a.md:1: literal: 1.0.0-alpha.7 is a hard-coded prerelease version", r.stdout)

    def test_pep440_literal_fails(self) -> None:
        self.write("py/tests/test_version.py", "# e.g. 1.0.0a1\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("py/tests/test_version.py:1: literal: 1.0.0a1 is a hard-coded prerelease version (PEP 440)", r.stdout)

    def test_excluded_files_are_not_scanned(self) -> None:
        self.write("ts/CHANGELOG.md", "## 1.0.0-alpha.0\n")
        self.write("ts/package.json", '{"version": "1.0.0-alpha.0"}\n')
        self.write("py/pyproject.toml", 'version = "1.0.0-alpha.0"\n')
        self.write("spec/v1.0/version.txt", "1.0.0-alpha.0\n")
        self.write("py/uv.lock", 'version = "1.0.0-alpha.0"\n')
        r = self.run_check()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    # --- --allow: caller-named files are skipped for rules 3-5 ------------

    def test_allow_glob_skips_the_file(self) -> None:
        self.write("tools/release/x.py", 'TITLE = "chore(release): example 1.0.0-alpha.1"\n')
        self.write("tools/release/test_x.py", "# e.g. 1.0.0a1\n")
        self.write("docs/a.md", "pin 1.0.0-alpha.7 here\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("tools/release/x.py:1: literal", r.stdout)
        self.assertIn("tools/release/test_x.py:1: literal", r.stdout)
        self.assertIn("docs/a.md:1: literal", r.stdout)
        r = self.run_check("--allow", "tools/release/*")
        self.assertEqual(r.returncode, 1)
        self.assertNotIn("tools/release/", r.stdout)
        self.assertIn("docs/a.md:1: literal", r.stdout)
        r = self.run_check("--allow", "tools/release/*", "--allow", "docs/a.md")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        # Only the config itself is left to scan.
        self.assertIn("version-check: ok (0 annotated, 1 files scanned)", r.stdout)

    def test_allow_does_not_exempt_annotated_lines(self) -> None:
        # The allow-list is for rules 3-5; a configured extra-file under
        # an allowed glob still has to carry its annotation.
        self.write(".github/release-please-config.json", _config({"py": ["README.md"]}))
        self.write("py/README.md", "no annotation here\n")
        r = self.run_check("--allow", "py/*")
        self.assertEqual(r.returncode, 1)
        self.assertIn("py/README.md:0: configured:", r.stdout)

    # --- rule 4: spec paths name a manifest version -----------------------

    def test_spec_path_with_unknown_version_fails(self) -> None:
        self.write("docs/a.md", "see spec/v0.8/03.md and `spec/v0.9`\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("docs/a.md:1: spec-path: spec/v0.8 is not a manifest package (known: spec/v1.0)", r.stdout)
        self.assertIn("docs/a.md:1: spec-path: spec/v0.9 is not a manifest package", r.stdout)

    def test_specs_root_is_derived_from_the_config(self) -> None:
        # The spec-repo layout: root `specs`, one package, one manifest
        # key. `spec/vX.Y` is not a configured root and is not a finding.
        self.write(".github/.release-please-manifest.json",
                   json.dumps({"specs/v0.1": "0.1.0-alpha.1"}))
        self.write(".github/release-please-config.json", _config(packages={
            "specs/v0.1": {"release-type": "simple", "component": "crtx-v0.1"},
        }))
        self.write("docs/a.md", "see specs/v0.8/spec.md, specs/v0.1/spec.md and spec/v0.8/x.md\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("docs/a.md:1: spec-path: specs/v0.8 is not a manifest package (known: specs/v0.1)", r.stdout)
        self.assertNotIn("spec/v0.8", r.stdout)
        self.assertNotIn("specs/v0.1 is not", r.stdout)

    def test_two_spec_roots_in_one_config(self) -> None:
        self.write(".github/.release-please-manifest.json",
                   json.dumps({"spec/v1.0": "1.0.0-alpha.0", "specs/v0.1": "0.1.0-alpha.1"}))
        self.write(".github/release-please-config.json", _config(packages={
            "spec/v1.0": {"release-type": "simple", "component": "a"},
            "specs/v0.1": {"release-type": "simple", "component": "b"},
        }))
        self.write("docs/a.md", "spec/v1.0 specs/v0.1 spec/v0.1 specs/v1.0\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("docs/a.md:1: spec-path: spec/v0.1 is not a manifest package (known: spec/v1.0, specs/v0.1)", r.stdout)
        self.assertIn("docs/a.md:1: spec-path: specs/v1.0 is not a manifest package (known: spec/v1.0, specs/v0.1)", r.stdout)
        self.assertEqual(r.stdout.count("spec-path"), 2)

    def test_no_spec_package_makes_rule_4_inert(self) -> None:
        # A repo without a spec adopts the guard for rules 1-3 and 5; no
        # root is derived, so no path shape is checked.
        self.write(".github/.release-please-manifest.json",
                   json.dumps({"go": "1.0.0-alpha.0"}))
        self.write(".github/release-please-config.json", _config(packages={
            "go": {"release-type": "go", "component": "example"},
        }))
        self.write("docs/a.md", 'see spec/v0.8/x.md, specs/v0.9/ and join("v0.9", "conformance")\n')
        r = self.run_check()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("version-check: ok (0 annotated,", r.stdout)

    def test_manifest_key_only_counts_under_a_configured_root(self) -> None:
        # The manifest may carry a spec key whose root the config no
        # longer names; that root is not a spec root.
        self.write(".github/.release-please-manifest.json",
                   json.dumps({"spec/v1.0": "1.0.0-alpha.0", "specs/v0.1": "0.1.0-alpha.1"}))
        self.write("docs/a.md", "specs/v0.9 and spec/v0.9\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("spec/v0.9 is not a manifest package (known: spec/v1.0)", r.stdout)
        self.assertNotIn("specs/v0.9", r.stdout)

    def test_walker_spellings_are_checked(self) -> None:
        self.write("ts/test/fixtures.ts", 'join(here, "spec", "v0.9", "conformance")\n')
        self.write("py/tests/_fixtures.py", 'SPEC_DIR / "v0.9" / "conformance"\n')
        self.write("rs/tests/support/mod.rs", '.join("v0.9").join("conformance")\n')
        self.write("php/tests/Corpus.php", "'v0.9' . DIRECTORY_SEPARATOR . 'conformance'\n")
        self.write("go/x.go", 'filepath.Join(spec, "v1.0", "conformance")\n')
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        for path in ("ts/test/fixtures.ts", "py/tests/_fixtures.py",
                     "rs/tests/support/mod.rs", "php/tests/Corpus.php"):
            self.assertIn(f'{path}:1: spec-path: "v0.9" joined to "conformance" names no '
                          "manifest spec version (known: spec/v1.0)", r.stdout)
        self.assertNotIn("go/x.go", r.stdout)

    # --- rule 5: caller-supplied forbidden patterns -----------------------

    def test_forbid_literal_fires(self) -> None:
        self.write("go/helpers/c.go", 'const defaultProdID = "-//example//example-go v9.9.9//EN"\n')
        self.write("go/ok.go", 'const defaultProdID = "-//example//example//EN"\n')
        r = self.run_check("--forbid-literal", r"example-(go|ts) v\d")
        self.assertEqual(r.returncode, 1)
        self.assertIn(r"go/helpers/c.go:1: forbidden: example-go v9 matches forbidden literal pattern example-(go|ts) v\d", r.stdout)
        self.assertNotIn("go/ok.go", r.stdout)

    def test_forbid_literal_absent_passes(self) -> None:
        self.write("go/helpers/c.go", 'const defaultProdID = "-//example//example-go v9.9.9//EN"\n')
        r = self.run_check()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_forbid_literal_is_repeatable(self) -> None:
        self.write("go/a.go", "first-shape here\n")
        self.write("go/b.go", "second shape here\n")
        r = self.run_check("--forbid-literal", "first-shape", "--forbid-literal", "second shape")
        self.assertEqual(r.returncode, 1)
        self.assertIn("go/a.go:1: forbidden: first-shape matches forbidden literal pattern first-shape", r.stdout)
        self.assertIn("go/b.go:1: forbidden: second shape matches forbidden literal pattern second shape", r.stdout)

    def test_forbid_literal_skips_annotated_lines(self) -> None:
        self.write(".github/release-please-config.json", _config({"ts": ["src/version.ts"]}))
        self.write("ts/src/version.ts",
                   'export const version = "1.0.0-alpha.0"; // x-release-please-version\n')
        r = self.run_check("--forbid-literal", "export const")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("version-check: ok (1 annotated,", r.stdout)

    def test_invalid_forbid_literal_regex_exits_2(self) -> None:
        r = self.run_check("--forbid-literal", "(unclosed")
        self.assertEqual(r.returncode, 2)
        self.assertIn("--forbid-literal '(unclosed'", r.stderr)

    # --- --config / --manifest ----------------------------------------------

    def test_config_and_manifest_flags_select_the_files(self) -> None:
        self.write("release/manifest.json", json.dumps({"specs/v0.1": "0.1.0-alpha.1"}))
        self.write("release/config.json", _config(packages={
            "specs/v0.1": {"release-type": "simple", "component": "crtx-v0.1"},
        }))
        self.write("docs/a.md", "0.1.0-alpha.1 and specs/v0.2\n")
        r = self.run_check("--config", "release/config.json", "--manifest", "release/manifest.json")
        self.assertEqual(r.returncode, 1)
        self.assertIn("docs/a.md:1: literal: 0.1.0-alpha.1 equals a manifest version", r.stdout)
        self.assertIn("docs/a.md:1: spec-path: specs/v0.2 is not a manifest package (known: specs/v0.1)", r.stdout)
        # The selected manifest is excluded from the scan; the default one
        # (a plain tracked file now) is not special.
        self.assertNotIn("release/manifest.json", r.stdout)

    def test_missing_manifest_fails(self) -> None:
        r = self.run_check("--manifest", "nowhere.json")
        self.assertEqual(r.returncode, 1)
        self.assertIn("version-check: missing nowhere.json", r.stderr)


if __name__ == "__main__":
    unittest.main()
