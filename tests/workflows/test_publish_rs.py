"""Tests for publish-rs.yml's `Install protoc` step.

The step's `run:` block is lifted out of the workflow verbatim and run
with bash, `curl` shimmed to serve a fixture zip (a fake `bin/protoc`)
instead of the protobuf release. `sha256sum` and `unzip` are the real
tools, so the checksum gate is exercised as on the runner.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

from test_release_please_preflight import step_script

WORKFLOW = (Path(__file__).resolve().parents[2]
            / ".github" / "workflows" / "publish-rs.yml")
STEP = "Install protoc"
# protoc-36.2-linux-x86_64.zip, as published on the protobuf release.
PIN_36_2_LINUX_X64 = "121f6c7afe1d4d0e3ea6aab9432038599250134cbf4474cb1167d2c7decd4278"

# `curl -fsSL --retry 3 -o <dest> <url>`: log the URL, copy the fixture.
CURL_SHIM = r"""#!/bin/sh
out=
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    --retry) shift 2 ;;
    -*) shift ;;
    *) echo "$1" >> "$FAKE_CURL_LOG"; shift ;;
  esac
done
cp "$FAKE_ZIP" "$out"
"""


class InstallProtocTests(unittest.TestCase):
    def setUp(self) -> None:
        for tool in ("sha256sum", "unzip"):
            if shutil.which(tool) is None:  # pragma: no cover
                self.skipTest(f"{tool} not installed")
        self.tmp = Path(tempfile.mkdtemp(prefix="publish-rs-"))
        shims = self.tmp / "bin"
        shims.mkdir()
        curl = shims / "curl"
        curl.write_text(CURL_SHIM, encoding="utf-8")
        curl.chmod(0o755)
        self.path = f"{shims}{os.pathsep}{os.environ['PATH']}"
        self.runner_temp = self.tmp / "runner-temp"
        self.runner_temp.mkdir()
        self.zip = self.tmp / "fixture.zip"
        with zipfile.ZipFile(self.zip, "w") as z:
            info = zipfile.ZipInfo("bin/protoc")
            info.external_attr = 0o755 << 16
            z.writestr(info, "#!/bin/sh\necho 'libprotoc fake'\n")
        self.zip_sha = hashlib.sha256(self.zip.read_bytes()).hexdigest()
        self.script = self.tmp / "step.sh"
        self.script.write_text(step_script(WORKFLOW, STEP), encoding="utf-8")
        self.gh_path = self.tmp / "github_path"
        self.gh_env = self.tmp / "github_env"
        self.curl_log = self.tmp / "curl.log"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_step(self, version: str, sha: str = "", os_: str = "Linux",
                 arch: str = "X64") -> tuple[int, str]:
        for f in (self.gh_path, self.gh_env, self.curl_log):
            f.write_text("", encoding="utf-8")
        env = {
            "PATH": self.path,
            "HOME": str(self.tmp),
            "PROTOC_VERSION": version,
            "PROTOC_SHA256": sha,
            "RUNNER_OS": os_,
            "RUNNER_ARCH": arch,
            "RUNNER_TEMP": str(self.runner_temp),
            "GITHUB_PATH": str(self.gh_path),
            "GITHUB_ENV": str(self.gh_env),
            "FAKE_ZIP": str(self.zip),
            "FAKE_CURL_LOG": str(self.curl_log),
        }
        r = subprocess.run(["bash", "-eo", "pipefail", str(self.script)], cwd=self.tmp,
                           env=env, capture_output=True, text=True)
        return r.returncode, r.stdout + r.stderr

    def downloads(self) -> list[str]:
        return self.curl_log.read_text(encoding="utf-8").split()

    def assert_nothing_installed(self) -> None:
        self.assertEqual(self.gh_path.read_text(encoding="utf-8"), "")
        self.assertEqual(self.gh_env.read_text(encoding="utf-8"), "")
        self.assertFalse(any(self.runner_temp.glob("protoc-*/bin")))

    def test_empty_version_installs_nothing(self) -> None:
        code, out = self.run_step("")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.downloads(), [])
        self.assert_nothing_installed()

    def test_installs_verified_protoc_onto_path(self) -> None:
        code, out = self.run_step("99.1", sha=self.zip_sha.upper())
        self.assertEqual(code, 0, out)
        self.assertEqual(self.downloads(), [
            "https://github.com/protocolbuffers/protobuf/releases/download/"
            "v99.1/protoc-99.1-linux-x86_64.zip"])
        bindir = self.runner_temp / "protoc-99.1" / "bin"
        self.assertEqual(self.gh_path.read_text(encoding="utf-8"), f"{bindir}\n")
        self.assertEqual(self.gh_env.read_text(encoding="utf-8"), f"PROTOC={bindir}/protoc\n")
        self.assertIn("libprotoc fake", out)
        self.assertFalse((self.runner_temp / "protoc-99.1-linux-x86_64.zip").exists())

    def test_bad_checksum_fails_before_unpacking(self) -> None:
        code, out = self.run_step("99.1", sha="0" * 64)
        self.assertEqual(code, 1, out)
        self.assertIn("::error::sha256 mismatch for protoc-99.1-linux-x86_64.zip", out)
        self.assert_nothing_installed()
        self.assertFalse((self.runner_temp / "protoc-99.1-linux-x86_64.zip").exists())

    def test_pinned_version_checks_the_pin(self) -> None:
        # 36.2 is pinned: the fixture is not the real zip, so the pin rejects it.
        code, out = self.run_step("36.2")
        self.assertEqual(code, 1, out)
        self.assertIn(f"want {PIN_36_2_LINUX_X64}", out)
        self.assert_nothing_installed()

    def test_override_must_agree_with_the_pin(self) -> None:
        code, out = self.run_step("36.2", sha=self.zip_sha)
        self.assertEqual(code, 1, out)
        self.assertIn("disagrees with the pinned sha256", out)
        self.assertEqual(self.downloads(), [])

    def test_unpinned_version_without_sha_fails(self) -> None:
        code, out = self.run_step("99.1")
        self.assertEqual(code, 1, out)
        self.assertIn("no pinned sha256 for protoc 99.1 (linux-x86_64)", out)
        self.assertEqual(self.downloads(), [])

    def test_platform_mapping(self) -> None:
        for os_, arch, platform, exe in (("Linux", "ARM64", "linux-aarch_64", "protoc"),
                                         ("macOS", "X64", "osx-x86_64", "protoc"),
                                         ("macOS", "ARM64", "osx-aarch_64", "protoc")):
            with self.subTest(os=os_, arch=arch):
                code, out = self.run_step("99.1", sha=self.zip_sha, os_=os_, arch=arch)
                self.assertEqual(code, 0, out)
                self.assertTrue(self.downloads()[0].endswith(f"/protoc-99.1-{platform}.zip"))
                self.assertTrue(self.gh_env.read_text(encoding="utf-8").endswith(f"/bin/{exe}\n"))
        code, out = self.run_step("99.1", sha=self.zip_sha, os_="Linux", arch="ARM")
        self.assertEqual(code, 1, out)
        self.assertIn("no protoc release for runner Linux/ARM", out)

    def test_malformed_inputs_fail_before_download(self) -> None:
        for version, sha, msg in (("v36.2", "", "protoc-version must be"),
                                  ("36.2/../x", "", "protoc-version must be"),
                                  ("37.0-rc1", "", "protoc-version must be"),
                                  ("99.1", "abc", "protoc-sha256 must be 64 hex")):
            with self.subTest(version=version, sha=sha):
                code, out = self.run_step(version, sha=sha)
                self.assertEqual(code, 1, out)
                self.assertIn(msg, out)
                self.assertEqual(self.downloads(), [])


class WorkflowShapeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.text = WORKFLOW.read_text(encoding="utf-8")

    def test_protoc_inputs_default_to_empty(self) -> None:
        for name in ("protoc-version", "protoc-sha256"):
            with self.subTest(name=name):
                block = self.text[self.text.index(f"      {name}:\n"):]
                block = block[:block.index("default:") + 20]
                self.assertIn('default: ""', block)

    def test_install_runs_before_any_cargo_step(self) -> None:
        steps = re.findall(r"(?m)^      - (?:name|uses): (.+)$", self.text)
        self.assertLess(steps.index(STEP), steps.index("Test"))
        self.assertLess(steps.index(STEP), steps.index("Publish"))

    def test_inputs_reach_the_step_through_env(self) -> None:
        self.assertIn("PROTOC_VERSION: ${{ inputs.protoc-version }}", self.text)
        self.assertIn("PROTOC_SHA256: ${{ inputs.protoc-sha256 }}", self.text)


if __name__ == "__main__":
    unittest.main()
