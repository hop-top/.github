"""Tests for scripts/spec/version_check.py: extra-files targets (typed, plain structured, YAML, the selector lines).

The harness (a temporary git repository per test) is in
version_check_fixture.py.
"""

from __future__ import annotations

import json
import unittest

from version_check_fixture import HAS_TOML, VersionCheckCase, _config, needs_yaml


class ExtraFilesTests(VersionCheckCase):
    # --- typed extra-files: the jsonpath / xpath is the marker -------------
    # release-please rewrites a typed entry (json / yaml / toml / xml / pom)
    # at its selector, never through an annotation; a generic or plain
    # string entry is rewritten through its annotation only.

    TYPED = [
        {"type": "json", "path": "meta.json", "jsonpath": "$.kit.version"},
        {"type": "yaml", "path": "chart/Chart.yaml", "jsonpath": "$.appVersion"},
        {"type": "toml", "path": "/engine/Cargo.toml", "jsonpath": "$.package.version"},
        {"type": "xml", "path": "app.xml", "xpath": "//app/version"},
        {"type": "pom", "path": "pom.xml"},
    ]

    def write_typed_targets(self) -> None:
        self.write("ts/meta.json", '{"kit": {"version": "1.0.0-alpha.0"}}\n')
        self.write("ts/chart/Chart.yaml", "appVersion: 1.0.0-alpha.0\n")
        self.write("engine/Cargo.toml", '[package]\nversion = "1.0.0-alpha.0"\n')
        self.write("ts/app.xml", "<app><version>1.0.0-alpha.0</version></app>\n")
        self.write("ts/pom.xml", "<project><version>1.0.0-alpha.0</version></project>\n")

    @needs_yaml
    def test_typed_entries_need_no_annotation(self) -> None:
        self.write(".github/release-please-config.json", _config({"ts": self.TYPED}))
        self.write_typed_targets()
        r = self.run_check()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("version-check: ok (0 annotated,", r.stdout)

    @needs_yaml
    def test_generic_and_string_entries_still_need_their_annotation(self) -> None:
        # So does an object with no type or one release-please rejects
        # (it throws on those; the preflight fails them).
        self.write(".github/release-please-config.json", _config({"ts": [
            {"type": "generic", "path": "install.sh"}, "VERSION.txt",
            {"path": "a.txt"}, {"type": "string", "path": "b.txt"}, *self.TYPED]}))
        self.write_typed_targets()
        self.write("ts/install.sh", "VERSION=1.0.0-alpha.0\n")
        self.write("ts/VERSION.txt", "1.0.0-alpha.0\n")
        self.write("ts/a.txt", "plain\n")
        self.write("ts/b.txt", "plain\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout.splitlines(), [
            "ts/VERSION.txt:0: configured: listed in extra-files but carries no "
            "x-release-please-version line",
            "ts/VERSION.txt:1: literal: 1.0.0-alpha.0 equals a manifest version and is not "
            "annotated with x-release-please-version",
            "ts/a.txt:0: configured: listed in extra-files but carries no "
            "x-release-please-version line",
            "ts/b.txt:0: configured: listed in extra-files but carries no "
            "x-release-please-version line",
            "ts/install.sh:0: configured: listed in extra-files but carries no "
            "x-release-please-version line",
            "ts/install.sh:1: literal: 1.0.0-alpha.0 equals a manifest version and is not "
            "annotated with x-release-please-version"])

    @needs_yaml
    def test_typed_target_still_answers_the_other_rules(self) -> None:
        # Only the annotation requirement (rules 2 and 3) is lifted.
        self.write(".github/release-please-config.json", _config({"ts": self.TYPED}))
        self.write_typed_targets()
        self.write("ts/meta.json", '{"kit": {"version": "1.0.0-alpha.0"}, '
                                   '"spec": "spec/v0.9", "id": "example-ts v1"}\n')
        r = self.run_check("--forbid-literal", r"example-ts v\d")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout.splitlines(), [
            r"ts/meta.json:1: forbidden: example-ts v1 matches forbidden literal pattern "
            r"example-ts v\d",
            "ts/meta.json:1: spec-path: spec/v0.9 is not a manifest package (known: spec/v1.0)"])

    # --- plain *.json / *.yaml / *.toml / *.xml entries ----------------------
    # release-please rewrites `$.version` (`/*/version` for XML) of such an
    # entry, then its annotations: either one is the marker, read the way
    # the preflight reads it.

    STRUCTURED = ["meta.json", "/engine/meta.toml", "chart.yaml", "app.xml"]

    def write_structured_targets(self) -> None:
        self.write("ts/meta.json", '{"name": "x", "version": "1.0.0-alpha.0"}\n')
        self.write("engine/meta.toml", 'version = "1.0.0-alpha.0"\n')
        self.write("ts/chart.yaml", "name: x\nversion: 1.0.0-alpha.0\n")
        self.write("ts/app.xml", "<app><version>1.0.0-alpha.0</version></app>\n")

    @needs_yaml
    def test_structured_string_entry_passes_with_a_version_at_the_default_path(self) -> None:
        entries = ["meta.json", "app.xml"]
        entries += ["/engine/meta.toml"] if HAS_TOML else []
        entries += ["chart.yaml"]
        self.write(".github/release-please-config.json", _config({"ts": entries}))
        self.write_structured_targets()
        r = self.run_check()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("version-check: ok (0 annotated,", r.stdout)

    @needs_yaml
    def test_structured_string_entry_needs_a_version_or_an_annotation(self) -> None:
        self.write(".github/release-please-config.json", _config({"ts": [
            "bare.json", "latest.json", "broken.json", "nover.xml", "annotated.json",
            *(["int.toml"] if HAS_TOML else []), "list.yaml"]}))
        self.write("ts/bare.json", '{"name": "x"}\n')
        self.write("ts/latest.json", '{"version": "latest"}\n')
        self.write("ts/broken.json", '{"version": "1.0.0-alpha.0",}\n')
        self.write("ts/nover.xml", "<app><v>1</v></app>\n")
        self.write("ts/int.toml", "version = 1\n")
        self.write("ts/list.yaml", "version: [1]\n")
        # The annotation alone is enough; rule 3 still reads its other lines.
        self.write("ts/annotated.json", '{"pin": "1.0.0-alpha.0 x-release-please-version",\n'
                                        ' "old": "1.0.0-alpha.0"}\n')
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        want = [
            "ts/annotated.json:2: literal: 1.0.0-alpha.0 equals a manifest version and is not "
            "annotated with x-release-please-version",
            "ts/bare.json:0: configured: listed in extra-files but carries no "
            "x-release-please-version line and no version at $.version",
            "ts/broken.json:0: configured: listed in extra-files but carries no "
            "x-release-please-version line and no version at $.version (not valid json)",
            "ts/broken.json:1: literal: 1.0.0-alpha.0 equals a manifest version and is not "
            "annotated with x-release-please-version",
        ]
        if HAS_TOML:
            want.append("ts/int.toml:0: configured: listed in extra-files but carries no "
                        "x-release-please-version line and no version at $.version "
                        "($.version is 1)")
        want.append("ts/latest.json:0: configured: listed in extra-files but carries no "
                    "x-release-please-version line and no version at $.version "
                    '($.version is "latest")')
        want.append("ts/list.yaml:0: configured: listed in extra-files but carries no "
                    "x-release-please-version line and no version at $.version "
                    "($.version is [1])")
        want.append("ts/nover.xml:0: configured: listed in extra-files but carries no "
                    "x-release-please-version line and no version at /*/version")
        self.assertEqual(r.stdout.splitlines(), want)

    @needs_yaml
    def test_structured_string_entry_without_a_toml_parser_is_not_evaluated(self) -> None:
        # The preflight's rule: no TOML parser, the default path is not
        # evaluated and the entry passes; a note says so.
        hide = self.hide_modules("tomllib", "tomli")
        self.write(".github/release-please-config.json", _config({"ts": self.STRUCTURED}))
        self.write_structured_targets()
        r = self.run_check(pythonpath=hide)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("version-check: ok (0 annotated,", r.stdout)
        self.assertEqual(sorted(x for x in r.stderr.splitlines() if "not evaluated" in x), [
            "version-check: engine/meta.toml: $.version not evaluated (no TOML parser); "
            "the entry passes without an annotation"])

    # --- only the selector's line escapes rule 3 ------------------------------

    @needs_yaml
    def test_plain_yaml_stale_sibling_still_fails(self) -> None:
        # release-please rewrites `$.version` only; appVersion stays stale.
        self.write(".github/release-please-config.json", _config({"ts": ["Chart.yaml"]}))
        self.write("ts/Chart.yaml", 'apiVersion: v2\nname: x\nversion: 1.0.0-alpha.0\n'
                                    'appVersion: "1.0.0-alpha.0"\n')
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout.splitlines(), [
            "ts/Chart.yaml:4: literal: 1.0.0-alpha.0 equals a manifest version and is not "
            "annotated with x-release-please-version"])

    def test_typed_json_sibling_still_fails(self) -> None:
        self.write(".github/release-please-config.json", _config({"ts": [
            {"type": "json", "path": "meta.json", "jsonpath": "$.kit.version"}]}))
        self.write("ts/meta.json", '{\n  "kit": {\n    "version": "1.0.0-alpha.0"\n  },\n'
                                   '  "compat": "1.0.0-alpha.0",\n  "next": "2.0.0-alpha.3"\n}\n')
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout.splitlines(), [
            "ts/meta.json:5: literal: 1.0.0-alpha.0 equals a manifest version and is not "
            "annotated with x-release-please-version",
            "ts/meta.json:6: literal: 2.0.0-alpha.3 is a hard-coded prerelease version"])

    def test_json_value_release_please_skips_is_not_exempt(self) -> None:
        # release-please's JSON updater rewrites a string holding a version
        # only; an object (or a number) at the path is left as it is.
        self.write(".github/release-please-config.json", _config({"ts": [
            {"type": "json", "path": "a.json", "jsonpath": "$.version"},
            {"type": "json", "path": "b.json", "jsonpath": "$.version"}]}))
        self.write("ts/a.json", '{\n  "version": {"current": "1.9.0-alpha.3"}\n}\n')
        self.write("ts/b.json", '{\n  "version": {\n    "current": "1.0.0-alpha.0"\n  }\n}\n')
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout.splitlines(), [
            "ts/a.json:2: literal: 1.9.0-alpha.3 is a hard-coded prerelease version",
            "ts/b.json:3: literal: 1.0.0-alpha.0 equals a manifest version and is not "
            "annotated with x-release-please-version"])

    @needs_yaml
    def test_each_format_exempts_only_its_selector_line(self) -> None:
        self.write(".github/release-please-config.json", _config({"ts": [
            {"type": "toml", "path": "Cargo.toml", "jsonpath": "$.package.version"},
            {"type": "yaml", "path": "chart.yaml", "jsonpath": "$.appVersion"},
            {"type": "xml", "path": "app.xml", "xpath": "//app/version"},
            {"type": "pom", "path": "pom.xml"},
            "plain.xml", "plain.toml", "plain.yaml"]}))
        self.write("ts/Cargo.toml", '[package]\nversion = "1.0.0-alpha.0"\n[dependencies]\n'
                                    'foo = { version = "1.0.0-alpha.0" }\n')
        self.write("ts/chart.yaml", "appVersion: 1.0.0-alpha.0\nversion: 1.0.0-alpha.0\n")
        self.write("ts/app.xml", "<app>\n  <version>1.0.0-alpha.0</version>\n"
                                 "  <compat>1.0.0-alpha.0</compat>\n</app>\n")
        self.write("ts/pom.xml", '<project xmlns="http://maven.apache.org/POM/4.0.0">\n'
                                 "  <version>1.0.0-alpha.0</version>\n  <dependencies>\n"
                                 "    <dependency><version>1.0.0-alpha.0</version></dependency>\n"
                                 "  </dependencies>\n</project>\n")
        self.write("ts/plain.xml", "<app>\n  <version>1.0.0-alpha.0</version>\n"
                                   "  <dep>\n    <version>1.0.0-alpha.0</version>\n  </dep>\n</app>\n")
        self.write("ts/plain.toml", 'version = "1.0.0-alpha.0"\n[tool]\nversion = "1.0.0-alpha.0"\n')
        self.write("ts/plain.yaml", "version: 1.0.0-alpha.0\nnested:\n  version: 1.0.0-alpha.0\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        stale = ("{}: literal: 1.0.0-alpha.0 equals a manifest version and is not annotated "
                 "with x-release-please-version")
        self.assertEqual(r.stdout.splitlines(), [stale.format(x) for x in (
            "ts/Cargo.toml:4", "ts/app.xml:3", "ts/chart.yaml:2", "ts/plain.toml:3",
            "ts/plain.xml:4", "ts/plain.yaml:3", "ts/pom.xml:4")])

    # --- YAML through PyYAML (BaseLoader nodes, js-yaml 4.3.2's typing) -----

    def test_yaml_without_pyyaml_fails_its_yaml_targets_only(self) -> None:
        self.write(".github/release-please-config.json", _config({"ts": [
            {"type": "yaml", "path": "Chart.yaml", "jsonpath": "$.appVersion"},
            "chart.yaml", "meta.json", "app.xml",
            *(["/engine/meta.toml"] if HAS_TOML else [])]}))
        self.write_structured_targets()
        self.write("ts/Chart.yaml", "appVersion: 1.0.0-alpha.0\n")
        r = self.run_check(pythonpath=self.hide_modules("yaml"))
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout.splitlines(), [
            "ts/Chart.yaml:0: configured: YAML target not checked: PyYAML is not "
            "importable (pip install pyyaml)",
            "ts/chart.yaml:0: configured: YAML target not checked: PyYAML is not "
            "importable (pip install pyyaml)"])

    @needs_yaml
    def test_yaml_flow_collection_or_anchor_on_the_path_exempts_nothing(self) -> None:
        # One line holds the value and its siblings (flow), or the value
        # is shared with an alias: no line is release-please's alone.
        self.write(".github/release-please-config.json", _config({"ts": [
            {"type": "yaml", "path": "flow.yaml", "jsonpath": "$.app.version"}, "chart.yaml"]}))
        self.write("ts/flow.yaml", "app: {version: 1.0.0-alpha.0, compat: 1.0.0-alpha.0}\n")
        self.write("ts/chart.yaml", "version: &v 1.0.0-alpha.0\nappVersion: *v\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        stale = ("{}: literal: 1.0.0-alpha.0 equals a manifest version and is not annotated "
                 "with x-release-please-version")
        self.assertEqual(r.stdout.splitlines(), [stale.format(x) for x in (
            "ts/chart.yaml:1", "ts/flow.yaml:1", "ts/flow.yaml:1")])
        self.assertEqual(sorted(x for x in r.stderr.splitlines() if "not placed" in x), [
            "version-check: ts/chart.yaml: yaml selector $.version not placed; "
            "rule 3 reads every line",
            "version-check: ts/flow.yaml: yaml selector $.app.version not placed; "
            "rule 3 reads every line"])

    @needs_yaml
    def test_yaml_quoted_keys_comments_and_documents(self) -> None:
        self.write(".github/release-please-config.json", _config({"ts": [
            "multi.yaml", {"type": "yaml", "path": "quoted.yaml", "jsonpath": "$.appVersion"}]}))
        self.write("ts/multi.yaml", '# header\n---\nname: a\n---\n# the version\n'
                                    '"version": 1.0.0-alpha.0\nappVersion: 1.0.0-alpha.0\n')
        self.write("ts/quoted.yaml", "'appVersion': 1.0.0-alpha.0\nversion: 1.0.0-alpha.0\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        stale = ("{}: literal: 1.0.0-alpha.0 equals a manifest version and is not annotated "
                 "with x-release-please-version")
        self.assertEqual(r.stdout.splitlines(), [stale.format(x) for x in (
            "ts/multi.yaml:7", "ts/quoted.yaml:2")])

    @needs_yaml
    def test_yaml_scalars_are_typed_as_js_yaml_types_them(self) -> None:
        # js-yaml 4.3.2 (release-please 17.11.2's): yes / on are strings,
        # true / 1 / a YYYY-MM-DD date are not; no `_` in numbers, no sign
        # on a leading-dot float, a two-digit month and day in a date.
        cases = {"yes": "yes", "on": "on", "quoted": '"1"', "under": "1_000",
                 "signed": "+.5", "short": "2024-1-1",
                 "true": "true", "int": "1", "date": "2024-01-01"}
        self.write(".github/release-please-config.json", _config({"ts": [
            f"{n}.yaml" for n in cases]}))
        for name, value in cases.items():
            self.write(f"ts/{name}.yaml", f"version: {value}\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        unmarked = ("ts/{}.yaml:0: configured: listed in extra-files but carries no "
                    "x-release-please-version line and no version at $.version ($.version is {})")
        self.assertEqual(r.stdout.splitlines(), [
            unmarked.format("date", "2024-01-01"), unmarked.format("int", "1"),
            unmarked.format("true", "true")])

    def test_namespaced_xml_matches_xpath_names_as_release_please_does(self) -> None:
        # release-please's xpath: a plain name step matches an element in no
        # namespace only; `*` and local-name() match any; a prefix it cannot
        # resolve makes it throw. PomXml uses local-name().
        self.write(".github/release-please-config.json", _config({"ts": [
            {"type": "xml", "path": "app.xml", "xpath": "/project/version"},
            {"type": "xml", "path": "star.xml", "xpath": "/*/version"},
            {"type": "xml", "path": "local.xml",
             "xpath": '/*[local-name()="project"]/*[local-name()="version"]'},
            {"type": "xml", "path": "mixed.xml", "xpath": "/*/meta/version"},
            {"type": "xml", "path": "p.xml", "xpath": "/p:project/p:version"},
            {"type": "pom", "path": "pom.xml"}]}))
        namespaced = '<project xmlns="urn:x">\n  <version>1.0.0-alpha.0</version>\n</project>\n'
        for name in ("app", "star", "local"):
            self.write(f"ts/{name}.xml", namespaced)
        self.write("ts/mixed.xml", '<project xmlns="urn:x">\n  <meta xmlns="">\n'
                                   "    <version>1.0.0-alpha.0</version>\n  </meta>\n</project>\n")
        self.write("ts/p.xml", '<p:project xmlns:p="urn:x">\n'
                               "  <p:version>1.0.0-alpha.0</p:version>\n</p:project>\n")
        self.write("ts/pom.xml", namespaced.replace("urn:x", "http://maven.apache.org/POM/4.0.0"))
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        stale = ("{}: literal: 1.0.0-alpha.0 equals a manifest version and is not annotated "
                 "with x-release-please-version")
        self.assertEqual(r.stdout.splitlines(), [stale.format(x) for x in (
            "ts/app.xml:2", "ts/p.xml:2", "ts/star.xml:2")])
        self.assertIn("version-check: ts/p.xml: xml selector /p:project/p:version not placed; "
                      "rule 3 reads every line", r.stderr)

    # --- annotations release-please never rewrites ---------------------------

    def test_annotation_in_a_typed_only_target_fails(self) -> None:
        self.write(".github/release-please-config.json", _config({"ts": [
            {"type": "toml", "path": "Cargo.toml", "jsonpath": "$.package.version"},
            {"type": "toml", "path": "both.toml", "jsonpath": "$.package.version"},
            "both.toml"]}))
        body = ('[package]\nversion = "1.0.0-alpha.0"\n'
                'foo = "1.0.0-alpha.0" # x-release-please-version\n')
        self.write("ts/Cargo.toml", body)
        # Also a plain entry: the generic updater runs on it.
        self.write("ts/both.toml", body)
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout.splitlines(), [
            "ts/Cargo.toml:3: annotated: a typed extra-files target only: release-please "
            "rewrites its selector, never this annotation"])

    @needs_yaml
    def test_annotation_in_a_yaml_entry_rewritten_at_its_default_path_fails(self) -> None:
        # release-please's YAML updater re-dumps the file once it rewrites
        # $.version, dropping every comment before the annotation step.
        self.write(".github/release-please-config.json", _config({"ts": [
            "chart.yaml", "noversion.yaml", "meta.toml"]}))
        self.write("ts/chart.yaml", 'version: 1.0.0-alpha.0\n'
                                    'appVersion: "1.0.0-alpha.0" # x-release-please-version\n')
        self.write("ts/noversion.yaml", 'appVersion: "1.0.0-alpha.0" # x-release-please-version\n')
        self.write("ts/meta.toml", 'version = "1.0.0-alpha.0"\n'
                                   'pin = "1.0.0-alpha.0" # x-release-please-version\n')
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout.splitlines(), [
            "ts/chart.yaml:2: annotated: release-please's YAML updater rewrites $.version "
            "and re-dumps the file without comments: this annotation is never rewritten"])

    # --- top-level extra-files: every package's default ---------------------

    def test_top_level_extra_files_apply_to_packages_without_their_own(self) -> None:
        # release-please merges a package's options over the top level with
        # `??`: unset or null inherits, an empty list does not.
        self.write(".github/.release-please-manifest.json",
                   json.dumps({"ts": "1.0.0-alpha.0", "py": "1.0.0-alpha.0", "go": "1.0.0-alpha.0"}))
        self.write(".github/release-please-config.json", json.dumps({
            "extra-files": ["VERSION.txt"], "packages": {
                "ts": {"release-type": "node", "component": "a"},
                "py": {"release-type": "python", "component": "b", "extra-files": None},
                "go": {"release-type": "go", "component": "c", "extra-files": []}}}))
        self.write("ts/VERSION.txt", "1.0.0-alpha.0 # x-release-please-version\n")
        self.write("py/VERSION.txt", "plain\n")
        self.write("go/VERSION.txt", "1.0.0-alpha.0 # x-release-please-version\n")
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout.splitlines(), [
            "go/VERSION.txt:0: configured: carries x-release-please-version but is not an "
            "extra-files entry",
            "py/VERSION.txt:0: configured: listed in extra-files but carries no "
            "x-release-please-version line"])

    def test_root_package_native_file_is_not_scanned(self) -> None:
        self.write(".github/.release-please-manifest.json", json.dumps({".": "1.0.0-alpha.0"}))
        self.write(".github/release-please-config.json", _config(
            packages={".": {"release-type": "node", "component": "example"}}))
        self.write("package.json", '{"version": "1.0.0-alpha.0"}\n')
        r = self.run_check()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
