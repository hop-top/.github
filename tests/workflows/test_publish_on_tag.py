"""Tests for publish-on-tag.yml's ecosystem lookup and mirror wiring.

The `parse` job's `lookup` step is lifted out of the workflow verbatim
and run with bash (its body is a python3 heredoc reading the caller's
`ecosystems` YAML); the mirror job's `with:` block is read out of the
YAML text, so a field the lookup emits but nobody forwards fails here.
"""

from __future__ import annotations

import os
import re
import shutil
import site
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

WORKFLOW = (Path(__file__).resolve().parents[2]
            / ".github" / "workflows" / "publish-on-tag.yml")


def step_script_by_id(workflow: Path, step_id: str) -> str:
    """The literal `run: |` block of the step with ``id: step_id``."""
    lines = workflow.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines)
                 if line.strip() == f"- id: {step_id}")
    run = next(i for i in range(start + 1, len(lines))
               if lines[i].strip() == "run: |")
    indent = len(lines[run]) - len(lines[run].lstrip())
    body: list[str] = []
    for line in lines[run + 1:]:
        if line.strip() and len(line) - len(line.lstrip()) <= indent:
            break
        body.append(line)
    return textwrap.dedent("\n".join(body)) + "\n"


class LookupTests(unittest.TestCase):
    def setUp(self) -> None:
        try:
            import yaml  # noqa: F401  (the step's python3 needs PyYAML)
        except ImportError:  # pragma: no cover
            self.skipTest("PyYAML not installed")
        self.tmp = Path(tempfile.mkdtemp(prefix="publish-on-tag-"))
        # The step's python3 is the interpreter running the tests, user site
        # included (HOME is the temp dir), so PyYAML resolves as it does here.
        shims = self.tmp / "bin"
        shims.mkdir()
        python = shims / "python3"
        python.write_text(f'#!/bin/sh\nPYTHONUSERBASE="{site.getuserbase()}" '
                          f'exec "{sys.executable}" "$@"\n', encoding="utf-8")
        python.chmod(0o755)
        self.path = f"{shims}{os.pathsep}{os.environ['PATH']}"
        self.script = self.tmp / "step.sh"
        self.script.write_text(step_script_by_id(WORKFLOW, "lookup"), encoding="utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def lookup(self, ecosystems: str, component: str) -> dict[str, str]:
        output = self.tmp / "output"
        output.write_text("", encoding="utf-8")
        env = {"PATH": self.path, "HOME": str(self.tmp),
               "ECOSYSTEMS": textwrap.dedent(ecosystems), "COMPONENT": component,
               "GITHUB_OUTPUT": str(output)}
        r = subprocess.run(["bash", "-eo", "pipefail", str(self.script)], cwd=self.tmp,
                           env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return dict(line.split("=", 1)
                    for line in output.read_text(encoding="utf-8").splitlines() if "=" in line)

    def test_allow_mirror_redirect_defaults_to_false(self) -> None:
        out = self.lookup("""
            kit-ts:
              dir: ts
              ecosystem: ts
              mirror: hop-top/kit-ts
            """, "kit-ts")
        self.assertEqual(out["allow_mirror_redirect"], "false")

    def test_allow_mirror_redirect_yaml_bool_is_lowercased(self) -> None:
        for value, want in (("true", "true"), ("True", "true"), ("false", "false"), ("'true'", "true")):
            with self.subTest(value=value):
                out = self.lookup(f"""
                    kit-ts:
                      dir: ts
                      ecosystem: ts
                      mirror: hop-top/kit-ts
                      allow-mirror-redirect: {value}
                    """, "kit-ts")
                self.assertEqual(out["allow_mirror_redirect"], want)

    def test_umbrella_component_emits_empty_fields(self) -> None:
        out = self.lookup("kit-ts: {dir: ts, ecosystem: ts, mirror: hop-top/kit-ts}\n", "poly-kit")
        self.assertEqual(out["ecosystem"], "")
        self.assertEqual(out["allow_mirror_redirect"], "")


class MirrorWiringTests(unittest.TestCase):
    def setUp(self) -> None:
        text = WORKFLOW.read_text(encoding="utf-8")
        start = text.index("\n  mirror:\n")
        end = text.index("\n  publish-php:\n")
        self.mirror_job = text[start:end]
        self.text = text

    def test_redirect_opt_in_is_forwarded_as_a_boolean(self) -> None:
        self.assertIn("allow-target-redirect: ${{ needs.parse.outputs.allow_mirror_redirect == 'true' }}",
                      self.mirror_job)

    def test_every_forwarded_parse_output_is_declared(self) -> None:
        used = set(re.findall(r"needs\.parse\.outputs\.(\w+)", self.mirror_job))
        outputs = self.text[self.text.index("    outputs:\n"):self.text.index("    steps:\n")]
        declared = set(re.findall(r"(?m)^      (\w+): \$\{\{", outputs))
        self.assertLessEqual(used, declared)


if __name__ == "__main__":
    unittest.main()
