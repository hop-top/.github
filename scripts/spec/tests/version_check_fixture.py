"""Shared harness for the scripts/spec/version_check.py tests.

Each test builds a small tree in a temporary git repository -- a
manifest, a config and a few tracked files -- and runs the checker on
it through its ``--root`` flag, asserting on exit code and findings.
The literals below are the checker's inputs by construction.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "version_check.py"
# The script runs under this interpreter: which optional parsers it can
# import (tomllib / tomli, PyYAML) is known here.
HAS_TOML = any(importlib.util.find_spec(m) for m in ("tomllib", "tomli"))
try:  # importable, not merely present: a stub raising ImportError hides it
    import yaml  # noqa: F401
    HAS_YAML = True
except ImportError:
    HAS_YAML = False
# version-check fails every YAML target without PyYAML: tests reading one skip.
needs_yaml = unittest.skipUnless(HAS_YAML, "PyYAML not importable")

MANIFEST = {"go": "1.0.0-alpha.0", "ts": "1.0.0-alpha.0", "py": "1.0.0-alpha.0",
            "spec/v1.0": "1.0.0-alpha.0"}
PACKAGES = {
    "go": {"release-type": "go", "component": "example"},
    "ts": {"release-type": "node", "component": "example-ts"},
    "py": {"release-type": "python", "component": "example-py"},
    "spec/v1.0": {"release-type": "simple", "component": "example-spec"},
}


def _config(extra: dict[str, list[str | dict]] | None = None,
            packages: dict[str, dict] | None = None) -> str:
    packages = {k: dict(v) for k, v in (packages or PACKAGES).items()}
    for pkg, files in (extra or {}).items():
        packages[pkg]["extra-files"] = files
    return json.dumps({"packages": packages})


class VersionCheckCase(unittest.TestCase):
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

    def run_check(self, *args: str, pythonpath: str = "") -> subprocess.CompletedProcess:
        subprocess.run(["git", "-C", str(self.tmp), "add", "-A"], check=True)
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        if pythonpath:
            env["PYTHONPATH"] = pythonpath
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.tmp), *args],
            capture_output=True, text=True, env=env,
        )

    def hide_modules(self, *mods: str) -> str:
        """A PYTHONPATH entry under which importing ``mods`` fails."""
        hide = Path(tempfile.mkdtemp(prefix="vc-noparser-"))
        self.addCleanup(shutil.rmtree, hide, True)
        for mod in mods:
            (hide / f"{mod}.py").write_text('raise ImportError("hidden")\n', encoding="utf-8")
        return str(hide)
