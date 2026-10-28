"""Tests for mirror-subtree.yml.

The `Resolve target repo and refuse self-mirror` step's `run:` block is
lifted out of the workflow verbatim and run with bash, `gh` shimmed to
answer `gh api repos/<slug> --jq .full_name` the way GitHub does: the
canonical name (following a rename redirect), or a 404.

The incident this guards: `hop-top/nerv` was a rename redirect to the
source repo `hop-top/poly-nerv`. The string-only self-mirror check let it
through, and the push would have force-replaced the source repo's main.
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
            / ".github" / "workflows" / "mirror-subtree.yml")
RESOLVE = "Resolve target repo and refuse self-mirror"
SOURCE = "hop-top/poly-nerv"

# `gh api repos/<slug> --jq .full_name`: FAKE_GH_REPOS maps lowercase slug
# -> canonical full_name (a redirect maps an old slug to the new name).
# Anything else is a 404, or FAKE_GH_FAIL forces a non-404 error.
GH_SHIM = r"""#!/bin/sh
echo "$*" >> "$FAKE_GH_LOG"
if [ -n "$FAKE_GH_FAIL" ]; then
  echo "gh: Bad credentials (HTTP 401)" >&2
  exit 1
fi
slug=$(printf '%s' "$2" | sed 's#^repos/##' | tr '[:upper:]' '[:lower:]')
for pair in $FAKE_GH_REPOS; do
  if [ "${pair%%=*}" = "$slug" ]; then
    printf '%s\n' "${pair#*=}"
    exit 0
  fi
done
echo "gh: Not Found (HTTP 404)" >&2
exit 1
"""


class ResolveTargetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="mirror-subtree-"))
        shims = self.tmp / "bin"
        shims.mkdir()
        gh = shims / "gh"
        gh.write_text(GH_SHIM, encoding="utf-8")
        gh.chmod(0o755)
        self.path = f"{shims}{os.pathsep}{os.environ['PATH']}"
        self.script = self.tmp / "step.sh"
        self.script.write_text(step_script(WORKFLOW, RESOLVE), encoding="utf-8")
        self.env_file = self.tmp / "env"
        self.output = self.tmp / "output"
        self.log = self.tmp / "gh.log"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_step(self, target: str, repos: dict[str, str], allow: str = "false",
                 fail: bool = False) -> tuple[int, str, str, str]:
        for f in (self.env_file, self.output, self.log):
            f.write_text("", encoding="utf-8")
        env = {
            "PATH": self.path,
            "HOME": str(self.tmp),
            "TARGET": target,
            "GITHUB_REPOSITORY": SOURCE,
            "ALLOW_REDIRECT": allow,
            "GITHUB_ENV": str(self.env_file),
            "GITHUB_OUTPUT": str(self.output),
            "FAKE_GH_REPOS": " ".join(f"{k.lower()}={v}" for k, v in repos.items()),
            "FAKE_GH_LOG": str(self.log),
            "FAKE_GH_FAIL": "1" if fail else "",
        }
        r = subprocess.run(["bash", "-eo", "pipefail", str(self.script)], cwd=self.tmp, env=env,
                           capture_output=True, text=True)
        return (r.returncode, r.stdout + r.stderr,
                self.env_file.read_text(encoding="utf-8"),
                self.output.read_text(encoding="utf-8"))

    def test_plain_mirror_resolves_to_itself(self) -> None:
        code, out, env, outputs = self.run_step("hop-top/nerv-ts", {"hop-top/nerv-ts": "hop-top/nerv-ts"})
        self.assertEqual(code, 0, out)
        self.assertEqual(env, "MIRROR_REPO=hop-top/nerv-ts\n")
        self.assertEqual(outputs, "repo=hop-top/nerv-ts\n")

    def test_case_only_difference_is_not_a_redirect(self) -> None:
        code, out, env, _ = self.run_step("Hop-Top/Nerv-TS", {"hop-top/nerv-ts": "hop-top/nerv-ts"})
        self.assertEqual(code, 0, out)
        self.assertEqual(env, "MIRROR_REPO=hop-top/nerv-ts\n")

    def test_rename_redirect_to_the_source_repo_is_refused(self) -> None:
        # The incident: hop-top/nerv -> hop-top/poly-nerv (this repo).
        for allow in ("false", "true"):
            with self.subTest(allow=allow):
                code, out, env, outputs = self.run_step(
                    "hop-top/nerv", {"hop-top/nerv": SOURCE, SOURCE: SOURCE}, allow=allow)
                self.assertEqual(code, 1, out)
                self.assertIn("::error::Refusing self-mirror", out)
                self.assertIn("redirects to hop-top/poly-nerv", out)
                self.assertEqual(env, "")
                self.assertEqual(outputs, "")

    def test_redirect_to_the_source_repo_in_other_case_is_refused(self) -> None:
        code, out, _, _ = self.run_step("hop-top/nerv", {"hop-top/nerv": "Hop-Top/Poly-Nerv"}, allow="true")
        self.assertEqual(code, 1, out)
        self.assertIn("::error::Refusing self-mirror", out)

    def test_literal_self_mirror_is_refused_before_any_api_call(self) -> None:
        for target in (SOURCE, "HOP-TOP/poly-nerv"):
            with self.subTest(target=target):
                code, out, env, _ = self.run_step(target, {SOURCE: SOURCE})
                self.assertEqual(code, 1, out)
                self.assertIn("::error::Refusing self-mirror", out)
                self.assertEqual(self.log.read_text(encoding="utf-8"), "")
                self.assertEqual(env, "")

    def test_redirect_elsewhere_is_refused_without_opt_in(self) -> None:
        code, out, env, outputs = self.run_step("hop-top/old-name", {"hop-top/old-name": "hop-top/new-name"})
        self.assertEqual(code, 1, out)
        self.assertIn("redirects to hop-top/new-name", out)
        self.assertIn("allow-target-redirect", out)
        self.assertEqual(env, "")
        self.assertEqual(outputs, "")

    def test_redirect_elsewhere_with_opt_in_pushes_to_the_resolved_name(self) -> None:
        code, out, env, outputs = self.run_step(
            "hop-top/old-name", {"hop-top/old-name": "hop-top/new-name"}, allow="true")
        self.assertEqual(code, 0, out)
        self.assertIn("::warning::", out)
        self.assertEqual(env, "MIRROR_REPO=hop-top/new-name\n")
        self.assertEqual(outputs, "repo=hop-top/new-name\n")

    def test_missing_mirror_keeps_the_requested_name_for_creation(self) -> None:
        code, out, env, _ = self.run_step("hop-top/brand-new", {})
        self.assertEqual(code, 0, out)
        self.assertIn("::notice::", out)
        self.assertEqual(env, "MIRROR_REPO=hop-top/brand-new\n")

    def test_other_api_errors_fail_closed(self) -> None:
        code, out, env, _ = self.run_step("hop-top/nerv-ts", {}, fail=True)
        self.assertEqual(code, 1, out)
        self.assertIn("Could not resolve target-repo", out)
        self.assertEqual(env, "")

    def test_the_api_lookup_uses_the_requested_slug(self) -> None:
        self.run_step("hop-top/nerv-ts", {"hop-top/nerv-ts": "hop-top/nerv-ts"})
        self.assertEqual(self.log.read_text(encoding="utf-8").split(),
                         ["api", "repos/hop-top/nerv-ts", "--jq", ".full_name"])


class WorkflowShapeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.text = WORKFLOW.read_text(encoding="utf-8")

    def test_resolve_runs_before_anything_touches_the_target(self) -> None:
        names = re.findall(r"(?m)^      - (?:name|uses): (.+)$", self.text)
        self.assertEqual(names[0], RESOLVE)

    def test_later_steps_only_use_the_resolved_name(self) -> None:
        after = self.text[self.text.index("- name: Ensure mirror repository exists"):]
        self.assertNotRegex(after, r"\$\{?TARGET\b")
        self.assertIn("$MIRROR_REPO", after)

    def test_restore_step_skips_when_the_target_was_refused(self) -> None:
        restore = self.text[self.text.index("- name: Restore mirror read-only"):]
        self.assertRegex(restore, r"(?m)^\s*if: always\(\) && steps\.target\.outputs\.repo != ''$")

    def test_redirect_opt_in_defaults_off(self) -> None:
        block = re.search(r"(?ms)^      allow-target-redirect:\n(.*?)(?=^      \S|^    \S)", self.text)
        self.assertIsNotNone(block)
        self.assertIn("type: boolean", block.group(1))
        self.assertIn("default: false", block.group(1))


if __name__ == "__main__":
    unittest.main()
