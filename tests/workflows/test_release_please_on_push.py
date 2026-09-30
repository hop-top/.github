"""Tests for release-please-on-push.yml.

Two layers:

- the `Check release-please config` step's `run:` block, lifted out of
  the workflow verbatim and run with bash inside a fixture repository;
- the workflow's shape: the pieces callers depend on (the job-level
  concurrency guard, the inputs, secrets and pass-through outputs)
  read out of the YAML text, so a refactor that drops one fails here
  rather than in an adopter's release run.
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
            / ".github" / "workflows" / "release-please-on-push.yml")
STEP = "Check release-please config"
CONFIG = ".github/release-please-config.json"
MANIFEST = ".github/.release-please-manifest.json"


class ConfigCheckStepTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="rp-on-push-"))
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        self.script = self.tmp / "step.sh"
        self.script.write_text(step_script(WORKFLOW, STEP), encoding="utf-8")
        self.output = self.tmp / "output"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, rel: str, content: str) -> None:
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def run_step(self, config: str = CONFIG, manifest: str = MANIFEST,
                 target: str = "", ref_name: str = "main") -> tuple[int, str, dict]:
        self.output.write_text("", encoding="utf-8")
        env = {
            "PATH": os.environ["PATH"],
            "HOME": str(self.tmp),
            "CONFIG_FILE": config,
            "MANIFEST_FILE": manifest,
            "TARGET_BRANCH": target,
            "GITHUB_REF_NAME": ref_name,
            "GITHUB_OUTPUT": str(self.output),
        }
        r = subprocess.run(["bash", str(self.script)], cwd=self.repo, env=env,
                           capture_output=True, text=True)
        outputs = dict(line.split("=", 1)
                       for line in self.output.read_text(encoding="utf-8").splitlines()
                       if "=" in line)
        return r.returncode, r.stdout + r.stderr, outputs

    def valid(self) -> None:
        self.write(CONFIG, '{"packages": {".": {"release-type": "go"}}}')
        self.write(MANIFEST, "{}")

    def test_valid_config_resolves_target_branch_from_the_triggering_ref(self) -> None:
        self.valid()
        code, out, outputs = self.run_step(ref_name="next")
        self.assertEqual(code, 0, out)
        self.assertEqual(outputs.get("target-branch"), "next", out)

    def test_explicit_target_branch_wins_over_the_triggering_ref(self) -> None:
        self.valid()
        code, out, outputs = self.run_step(target="release/1.x", ref_name="main")
        self.assertEqual(code, 0, out)
        self.assertEqual(outputs.get("target-branch"), "release/1.x", out)

    def test_custom_paths_are_honoured(self) -> None:
        self.write("release-please-config.json", '{"packages": {".": {}}}')
        self.write(".release-please-manifest.json", '{".": "1.0.0"}')
        code, out, _ = self.run_step(config="release-please-config.json",
                                     manifest=".release-please-manifest.json")
        self.assertEqual(code, 0, out)

    def test_no_config_and_no_manifest_skips_with_a_warning(self) -> None:
        # A repo wired before it adopts release-please (e.g. fresh from
        # `kit init`) stays green until it adds the two files.
        code, out, outputs = self.run_step()
        self.assertEqual(code, 0, out)
        self.assertEqual(outputs.get("skip"), "true", out)
        self.assertIn(f"::warning file={CONFIG}::", out)
        self.assertNotIn("target-branch", outputs)

    def test_valid_config_does_not_skip(self) -> None:
        self.valid()
        code, out, outputs = self.run_step()
        self.assertEqual(code, 0, out)
        self.assertEqual(outputs.get("skip"), "false", out)

    def test_missing_config_fails_naming_the_path(self) -> None:
        self.write(MANIFEST, "{}")
        code, out, outputs = self.run_step()
        self.assertEqual(code, 1, out)
        self.assertIn(f"::error file={CONFIG}::", out)
        self.assertNotIn("target-branch", outputs)

    def test_missing_manifest_fails_naming_the_path(self) -> None:
        self.write(CONFIG, '{"packages": {".": {}}}')
        code, out, _ = self.run_step()
        self.assertEqual(code, 1, out)
        self.assertIn(f"::error file={MANIFEST}::", out)

    def test_invalid_json_fails(self) -> None:
        self.write(CONFIG, '{"packages": ')
        self.write(MANIFEST, "{}")
        code, out, _ = self.run_step()
        self.assertEqual(code, 1, out)
        self.assertIn(f"::error file={CONFIG}::", out)

    def test_config_without_packages_fails(self) -> None:
        self.write(CONFIG, '{"separate-pull-requests": true}')
        self.write(MANIFEST, "{}")
        code, out, _ = self.run_step()
        self.assertEqual(code, 1, out)
        self.assertIn("declares no packages", out)


class WorkflowShapeTests(unittest.TestCase):
    """Shape checks read the YAML as text: the tests stay standard-library
    only (DEVELOPING.md), and actionlint already validates the syntax."""

    def setUp(self) -> None:
        self.text = WORKFLOW.read_text(encoding="utf-8")

    def block(self, *path: str) -> str:
        return yaml_block(self.text, *path)

    def test_only_trigger_is_workflow_call(self) -> None:
        on = self.block("on")
        self.assertEqual([k for k in keys(on)], ["workflow_call"])

    def test_concurrency_guard_is_job_level_and_cancels_the_older_run(self) -> None:
        # Workflow-level `concurrency` in a called workflow is not a
        # supported guard; the job-level one is, and there `github.ref`
        # is the caller's ref. Job level also keeps a caller's chained
        # publish jobs out of the cancel.
        self.assertNotIn("concurrency", list(keys(self.text)))
        conc = self.block("jobs", "release-please", "concurrency")
        self.assertRegex(conc, r"(?m)^\s*cancel-in-progress: true$")
        group = re.search(r"(?m)^\s*group: (.+)$", conc).group(1)
        self.assertIn("${{ github.ref }}", group)
        # Distinct from the `release-please-${{ github.ref }}` group
        # hand-written callers already carry: equal caller and callee
        # groups with cancel-in-progress cancel the running workflow.
        self.assertNotEqual(group, "release-please-${{ github.ref }}")

    def test_inputs_default_to_the_org_layout(self) -> None:
        inputs = self.block("on", "workflow_call", "inputs")
        self.assertIn(f"default: {CONFIG}", self.block_of(inputs, "config-file"))
        self.assertIn(f"default: {MANIFEST}", self.block_of(inputs, "manifest-file"))
        self.assertIn('default: ""', self.block_of(inputs, "target-branch"))

    def test_release_bot_secrets_are_required(self) -> None:
        secrets = self.block("on", "workflow_call", "secrets")
        for name in ("RELEASE_BOT_APP_ID", "RELEASE_BOT_PRIVATE_KEY"):
            self.assertIn("required: true", self.block_of(secrets, name), name)

    def test_outputs_pass_release_please_outputs_through(self) -> None:
        outputs = self.block("on", "workflow_call", "outputs")
        job_outputs = self.block("jobs", "release-please", "outputs")
        for name in ("releases_created", "paths_released", "prs_created", "pr", "prs",
                     "release_created", "tag_name", "version", "major", "minor",
                     "patch", "sha", "upload_url", "html_url"):
            self.assertIn(f"value: ${{{{ jobs.release-please.outputs.{name} }}}}",
                          self.block_of(outputs, name), name)
            self.assertRegex(job_outputs,
                             rf"(?m)^\s*{name}: \$\{{\{{ steps\.release\.outputs\.{name} \}}\}}$")
        self.assertIn("value: ${{ jobs.release-please.outputs.json }}",
                      self.block_of(outputs, "json"))
        self.assertRegex(job_outputs,
                         r"(?m)^\s*json: \$\{\{ toJSON\(steps\.release\.outputs\) \}\}$")

    def test_release_please_runs_with_the_app_token_and_resolved_inputs(self) -> None:
        steps = self.block("jobs", "release-please", "steps")
        self.assertIn("uses: actions/create-github-app-token@", steps)
        rp = steps[steps.index("uses: googleapis/release-please-action@v5"):]
        self.assertIn("id: release", rp)
        self.assertIn("token: ${{ steps.app-token.outputs.token }}", rp)
        self.assertIn("config-file: ${{ inputs.config-file }}", rp)
        self.assertIn("manifest-file: ${{ inputs.manifest-file }}", rp)
        self.assertIn("target-branch: ${{ steps.config.outputs.target-branch }}", rp)
        # Nothing past the config check runs when it reports skip.
        after = steps[steps.index("id: config"):]
        for use in ("uses: actions/create-github-app-token@",
                    "uses: googleapis/release-please-action@v5"):
            tail = after[after.index(use):]
            nxt = tail.find("\n      - ", 1)
            self.assertIn("if: steps.config.outputs.skip != 'true'",
                          tail if nxt < 0 else tail[:nxt], use)

    def test_github_token_stays_read_only(self) -> None:
        # release-please talks to the API with the App token only.
        perms = self.block("jobs", "release-please", "permissions")
        self.assertEqual(list(keys(perms)), ["contents"])
        self.assertRegex(perms, r"(?m)^\s*contents: read$")
        self.assertNotIn("permissions", list(keys(self.text)))
        steps = self.block("jobs", "release-please", "steps")
        self.assertEqual(steps.count("uses: actions/checkout@"),
                         steps.count("persist-credentials: false"))

    @staticmethod
    def block_of(text: str, key: str) -> str:
        return yaml_block(text, key)


def keys(text: str):
    """Top-level mapping keys of a (dedented-or-not) YAML block."""
    lines = [x for x in text.splitlines() if x.strip() and not x.lstrip().startswith("#")]
    if not lines:
        return
    indent = min(len(x) - len(x.lstrip()) for x in lines)
    for line in lines:
        if len(line) - len(line.lstrip()) == indent and ":" in line:
            yield line.strip().split(":", 1)[0].strip("'\"")


def yaml_block(text: str, *path: str) -> str:
    """The indented body under the key path ``path`` (text, not parsed)."""
    lines = text.splitlines()
    start, indent = 0, -1
    for key in path:
        for i in range(start, len(lines)):
            line = lines[i]
            ind = len(line) - len(line.lstrip())
            if ind > indent and re.match(rf"^\s*['\"]?{re.escape(key)}['\"]?:(\s|$)", line):
                start, indent = i + 1, ind
                break
        else:
            raise AssertionError(f"key path {path!r} not found")
    body: list[str] = []
    for line in lines[start:]:
        if line.strip() and len(line) - len(line.lstrip()) <= indent:
            break
        body.append(line)
    return "\n".join(body)


if __name__ == "__main__":
    unittest.main()
