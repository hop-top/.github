"""Tests for ci-gate.yml.

The `Check needed job results` step's `run:` block is lifted out of the
workflow verbatim and run with bash against `toJSON(needs)`-shaped input.

The gate is the one required check: it must fail on any failed or
cancelled job, pass on success and skipped (a job gated off by its own
`if:`), and refuse input that would make it pass vacuously.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_release_please_preflight import step_script

WORKFLOW = (Path(__file__).resolve().parents[2]
            / ".github" / "workflows" / "ci-gate.yml")
STEP = "Check needed job results"


def needs(**results: str) -> str:
    return json.dumps({job: {"result": r, "outputs": {}} for job, r in results.items()})


class GateStepTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="ci-gate-"))
        self.script = self.tmp / "step.sh"
        self.script.write_text(step_script(WORKFLOW, STEP), encoding="utf-8")
        self.summary = self.tmp / "summary"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_step(self, value: str) -> tuple[int, str]:
        self.summary.write_text("", encoding="utf-8")
        env = {"PATH": os.environ["PATH"], "HOME": str(self.tmp), "NEEDS": value,
               "GITHUB_STEP_SUMMARY": str(self.summary)}
        r = subprocess.run(["bash", str(self.script)], cwd=self.tmp, env=env,
                           capture_output=True, text=True)
        return r.returncode, r.stdout + r.stderr

    def test_success_and_skipped_pass(self) -> None:
        code, out = self.run_step(needs(changes="success", lint="success", ios="skipped"))
        self.assertEqual(code, 0, out)
        self.assertIn("all 3 needed jobs succeeded or were skipped", out)

    def test_all_skipped_passes(self) -> None:
        # A release-only PR can gate off everything but the changes job.
        code, out = self.run_step(needs(ios="skipped", android="skipped"))
        self.assertEqual(code, 0, out)

    def test_failure_fails_and_names_the_job(self) -> None:
        code, out = self.run_step(needs(changes="success", go_test="failure", lint="success"))
        self.assertEqual(code, 1, out)
        self.assertIn("::error::job go_test ended failure", out)
        self.assertNotIn("job lint", out)

    def test_cancelled_fails(self) -> None:
        code, out = self.run_step(needs(changes="success", rs="cancelled"))
        self.assertEqual(code, 1, out)
        self.assertIn("::error::job rs ended cancelled", out)

    def test_every_bad_job_is_reported(self) -> None:
        code, out = self.run_step(needs(a="failure", b="success", c="cancelled"))
        self.assertEqual(code, 1, out)
        self.assertIn("job a ended failure", out)
        self.assertIn("job c ended cancelled", out)

    def test_unknown_result_fails_closed(self) -> None:
        code, out = self.run_step(needs(a=""))
        self.assertEqual(code, 1, out)

    def test_empty_needs_fails(self) -> None:
        code, out = self.run_step("{}")
        self.assertEqual(code, 1, out)
        self.assertIn("needs is empty", out)

    def test_non_object_input_fails(self) -> None:
        for value in ("", "null", "[]", "not json", '"success"'):
            code, out = self.run_step(value)
            self.assertEqual(code, 1, f"{value!r}: {out}")
            self.assertIn("not a JSON object", out, value)

    def test_summary_lists_each_job(self) -> None:
        self.run_step(needs(b="skipped", a="success"))
        summary = self.summary.read_text(encoding="utf-8")
        self.assertIn("| a | success |", summary)
        self.assertIn("| b | skipped |", summary)
        self.assertLess(summary.index("| a |"), summary.index("| b |"))


class CallerContractTests(unittest.TestCase):
    def test_template_runs_the_gate_with_always(self) -> None:
        # Without `if: always()` the gate job is skipped when a job it needs
        # fails, and a skipped required check passes.
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("if: always()", text)
        self.assertIn("needs: ${{ toJSON(needs) }}", text)


if __name__ == "__main__":
    unittest.main()
