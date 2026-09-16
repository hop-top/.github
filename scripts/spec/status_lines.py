#!/usr/bin/env python3
"""Patch `**Status:**` lines in spec markdown files from a release-please
PR title's version suffix.

Runs on a release-please pull request from the repository root. The
title names the component and the version; the release-please config
maps the component to its package path. When that path is a spec
package (``<root>/vX.Y``), every ``*.md`` under it and the root's own
``<root>/README.md`` get their status line rewritten, and the change is
committed and pushed to the PR branch. A release PR for any other
component is a no-op (exit 0 with a ``::notice::``): it carries no
status lines.

Mapping:
  -alpha.N → Draft
  -beta.N  → Pre-release
  -rc.N    → Release Candidate
  unsuffixed → General Availability

Inputs:
  --config PATH  release-please config (default
                 .github/release-please-config.json)
  PR_TITLE (env)   e.g. `chore(release): crtx-v0.1 0.1.0-alpha.1`
  PR_BRANCH (env)  head ref to push to (must match BRANCH_RE)

The push uses whatever credential the checkout carries (a credential
helper configured by the caller); nothing here reads a token.

Exit codes: 0 patched, pushed or nothing to do; 2 bad input.
Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_CONFIG = ".github/release-please-config.json"

# A release-please package path that is a spec version directory.
SPEC_PACKAGE_RE = re.compile(r"^(?P<root>[A-Za-z0-9_.-]+)/v(?P<line>\d+\.\d+)$")

# Strict parse of release-please's pull-request-title-pattern
# `chore(release):${component} ${version}` (single space, optional
# whitespace after the colon). The component is any release-please
# component name; its package path is looked up in the config.
# Version shape: 0.1.0, 0.1.0-alpha.0, 0.2.3-rc.4, etc.
TITLE_RE = re.compile(
    r"^chore\(release\):\s*"
    r"(?P<component>[A-Za-z0-9._-]+)\s+"
    r"(?P<version>\d+\.\d+\.\d+(?:-(?P<channel>alpha|beta|rc)\.\d+)?)\s*$",
)

# Git branch names are limited by git's refname rules; we apply a strict
# allow-list rather than relying on git/shell quoting. Additional checks
# reject path-traversal patterns ('..') and leading/trailing punctuation.
BRANCH_RE = re.compile(r"^[A-Za-z0-9._/-]{1,255}$")


def _branch_is_safe(b: str) -> bool:
    if not BRANCH_RE.match(b):
        return False
    if ".." in b:
        return False
    if b.startswith(("/", "-", ".")) or b.endswith(("/", ".lock", ".")):
        return False
    return True


# Match a top-of-file status line. Tolerate trailing whitespace markdown
# uses for hard breaks ("  ").
STATUS_RE = re.compile(r"^\*\*Status:\*\*\s+.+?\s*$", re.MULTILINE)
STATUS_HEAD_LINES = 15  # only patch lines in the head of the file

CHANNEL_LABEL = {
    "alpha": "Draft",
    "beta": "Pre-release",
    "rc": "Release Candidate",
    None: "General Availability",
}


def die(msg: str, code: int = 2) -> None:
    print(f"::error::{msg}", file=sys.stderr)
    sys.exit(code)


def run(argv: list[str]) -> str:
    return subprocess.run(
        argv, check=True, capture_output=True, text=True,
    ).stdout


def parse_title(title: str) -> tuple[str, str, str | None]:
    m = TITLE_RE.match(title)
    if not m:
        die(f"PR_TITLE does not match release-please pattern: {title!r}")
    return m.group("component"), m.group("version"), m.group("channel")


def validate_branch(branch: str) -> str:
    if not _branch_is_safe(branch):
        die(f"PR_BRANCH is not a safe branch name: {branch!r}")
    return branch


def package_path_for(component: str, config: Path) -> Path:
    # release-please's own config is the component → package-path map.
    # Nothing is derived from the component's spelling.
    try:
        packages = json.loads(config.read_text(encoding="utf-8"))["packages"]
    except (OSError, ValueError, KeyError) as exc:
        die(f"cannot read packages from {config}: {exc}")
    paths = [p for p, cfg in packages.items() if cfg.get("component") == component]
    if len(paths) != 1:
        die(
            f"component {component!r} maps to {len(paths)} package path(s) "
            f"in {config}; expected exactly one",
        )
    return Path(paths[0])


def patch_file(path: Path, new_status: str) -> bool:
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    head = "\n".join(lines[:STATUS_HEAD_LINES])
    tail = "\n".join(lines[STATUS_HEAD_LINES:])

    def repl(m: re.Match[str]) -> str:
        return f"**Status:** {new_status}"

    new_head, n = STATUS_RE.subn(repl, head)
    if n == 0:
        return False
    new_text = new_head + ("\n" + tail if tail else "")
    if new_text == text:
        return False
    path.write_text(new_text, encoding="utf-8")
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "--config", type=Path, default=Path(DEFAULT_CONFIG),
        help=f"release-please config (default: {DEFAULT_CONFIG})",
    )
    args = parser.parse_args(argv)

    branch = validate_branch(os.environ.get("PR_BRANCH", ""))
    component, version, channel = parse_title(os.environ.get("PR_TITLE", ""))

    package = package_path_for(component, args.config)
    spec = SPEC_PACKAGE_RE.match(package.as_posix())
    if spec is None:
        print(
            f"::notice::{component} is not a spec component "
            f"(package path {package.as_posix()}); no status lines to patch",
        )
        return 0
    if not package.is_dir():
        die(f"spec directory does not exist: {package}")

    new_status = CHANNEL_LABEL[channel]
    print(f"version={version} channel={channel or 'stable'} → status={new_status!r}")

    md_files = sorted(package.rglob("*.md"))
    # Also patch the spec root's own README if it carries a status line
    # (rare). The repository root README is not a spec document and is
    # deliberately left alone.
    root_readme = Path(spec.group("root")) / "README.md"
    if root_readme.is_file():
        md_files.append(root_readme)

    patched: list[Path] = []
    for f in md_files:
        if patch_file(f, new_status):
            patched.append(f)

    if not patched:
        print("no status lines to update")
        return 0

    print("patched:")
    for f in patched:
        print(f"  {f}")

    # Commit and push. argv-list form, no shell.
    run(["git", "config", "user.name", "release-please-status-bot"])
    run(["git", "config", "user.email",
         "release-please-status-bot@users.noreply.github.com"])
    run(["git", "add", "--", *[str(f) for f in patched]])
    run(["git", "commit", "-m", "chore(release): sync spec status lines"])
    run(["git", "push", "origin", f"HEAD:refs/heads/{branch}"])
    print("pushed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
