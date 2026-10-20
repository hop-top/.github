"""Tests for roll-major-tag.yml.

The `Resolve version tag` step's `run:` block is lifted out of the
workflow verbatim and run with bash; the steps after it (the GitHub API
calls that move the major tag) are checked for the guard that keeps
them from running when the step says the tag does not roll.

Only a stable `vMAJOR.MINOR.PATCH` moves `vMAJOR`: callers pin `@v0` and
would otherwise run a prerelease (`v0.15.0-rc.1`) of every workflow.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_release_please_preflight import step_script

WORKFLOW = (Path(__file__).resolve().parents[2]
            / ".github" / "workflows" / "roll-major-tag.yml")
STEP = "Resolve version tag"


class ResolveStepTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="roll-major-tag-"))
        self.script = self.tmp / "step.sh"
        self.script.write_text(step_script(WORKFLOW, STEP), encoding="utf-8")
        self.output = self.tmp / "output"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_step(self, ref: str = "", version: str = "") -> tuple[int, str, dict]:
        self.output.write_text("", encoding="utf-8")
        env = {"PATH": os.environ["PATH"], "HOME": str(self.tmp), "REF": ref,
               "INPUT_VERSION": version, "GITHUB_OUTPUT": str(self.output)}
        r = subprocess.run(["bash", str(self.script)], cwd=self.tmp, env=env,
                           capture_output=True, text=True)
        outputs = dict(line.split("=", 1)
                       for line in self.output.read_text(encoding="utf-8").splitlines()
                       if "=" in line)
        return r.returncode, r.stdout + r.stderr, outputs

    def test_stable_tag_rolls_its_major(self) -> None:
        # release-please here cuts `vX.Y.Z` (include-component-in-tag: false).
        for tag, major in (("v0.14.1", "v0"), ("v0.15.0", "v0"), ("v1.2.3", "v1"), ("v10.0.0", "v10")):
            code, out, outputs = self.run_step(ref=f"refs/tags/{tag}")
            self.assertEqual(code, 0, out)
            self.assertEqual(outputs, {"roll": "true", "tag": tag, "major": major}, tag)

    def test_prerelease_and_build_metadata_tags_are_skipped_with_a_notice(self) -> None:
        for tag in ("v0.15.0-rc.1", "v0.15.0-alpha.0", "v1.0.0-beta", "v0.15.0+build.1",
                    "v0.15.0-rc.1+sha.abc", "v0.15.0.1"):
            code, out, outputs = self.run_step(ref=f"refs/tags/{tag}")
            self.assertEqual(code, 0, f"{tag}: {out}")
            self.assertEqual(outputs, {"roll": "false"}, tag)
            self.assertIn(f"::notice::tag '{tag}' is not a stable vMAJOR.MINOR.PATCH", out)

    def test_dispatch_input_is_held_to_the_same_rule(self) -> None:
        code, out, outputs = self.run_step(ref="refs/heads/main", version="v0.14.1")
        self.assertEqual(code, 0, out)
        self.assertEqual(outputs, {"roll": "true", "tag": "v0.14.1", "major": "v0"})
        code, out, outputs = self.run_step(ref="refs/heads/main", version="v0.15.0-rc.0")
        self.assertEqual(code, 0, out)
        self.assertEqual(outputs, {"roll": "false"})

    def test_tag_without_a_version_fails(self) -> None:
        for tag in ("release-1", "0.15.0", "v0.15", "vX.Y.Z"):
            code, out, outputs = self.run_step(ref=f"refs/tags/{tag}")
            self.assertEqual(code, 1, f"{tag}: {out}")
            self.assertIn(f"::error::tag '{tag}' does not match vMAJOR.MINOR.PATCH pattern", out)
            self.assertEqual(outputs, {}, tag)


class WorkflowShapeTests(unittest.TestCase):
    def steps(self) -> list[str]:
        text = WORKFLOW.read_text(encoding="utf-8")
        body = text[text.index("    steps:\n"):]
        return ["- " + p for p in re.split(r"(?m)^      - ", body)[1:]]

    def test_tag_moves_only_when_the_resolve_step_says_it_rolls(self) -> None:
        steps = self.steps()
        at = next(i for i, s in enumerate(steps) if f"name: {STEP}" in s)
        self.assertIn("id: ver", steps[at])
        after = steps[at + 1:]
        self.assertEqual(len(after), 2)
        for step in after:
            self.assertRegex(step, r"(?m)^\s*if: steps\.ver\.outputs\.roll == 'true'$", step)
        self.assertIn("gh api -X PATCH", after[-1])


if __name__ == "__main__":
    unittest.main()
