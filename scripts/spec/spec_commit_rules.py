#!/usr/bin/env python3
"""Enforce per-spec-version commit isolation and stable-version invariants.

A spec package is a release-please package whose path is a version
directory: ``<root>/vX.Y`` (``spec/v1.0``, ``specs/v0.1``). The roots
come from the release-please config; nothing about them is assumed.

Rules, applied to every commit in ``BASE_SHA..HEAD_SHA``:
  A. A single commit MUST NOT touch files in more than one ``<root>/vX.Y/``
     directory. One shape is exempt: a whole-directory rename. When the
     commit removes ``<root>/vA.B/`` entirely and every path it held
     reappears at the same relative path under one other directory
     ``<root>/vC.D/``, the commit counts as touching vC.D only -- the
     directory changed its name. Files may be edited on the way (a
     squashed rename-and-revise lands as a delete plus an add); what
     matters is that nothing is left behind and nothing moved to a
     different relative path. A partial move or a reshuffle counts both
     versions and fails.
  B. A commit touching ``<root>/vX.Y/`` MUST NOT carry breaking-change
     syntax (Conventional Commits ``!:`` or a ``BREAKING CHANGE:``
     trailer). Breaking changes mean a new spec-version directory
     (``vX.Y+1/`` or ``vX+1.0/``), not a bump within an existing one.

Inputs:
  --config PATH  release-please config (default
                 .github/release-please-config.json); the packages whose
                 path matches ``<root>/vX.Y`` define the spec roots. With
                 no such package the run fails closed (exit 2): a repo
                 without a spec package has nothing for this rule set to
                 guard, and calling it is a wiring error.
  BASE_SHA, HEAD_SHA (env)  the pull request's base and head commits.

Both SHAs are validated as git SHAs before they reach any subprocess.

Exit codes: 0 no violation; 1 violations found; 2 bad input.
Standard library only; runs from the repository root.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

SHA_RE = re.compile(r"^[0-9a-f]{7,40}$")
# A release-please package path that is a spec version directory.
SPEC_PACKAGE_RE = re.compile(r"^(?P<root>[A-Za-z0-9_.-]+)/v(?P<line>\d+\.\d+)$")
# Conventional Commits header: <type>(<scope>)?<!>?: <subject>
# We only need to detect the optional `!` before the colon.
BREAKING_HEADER_RE = re.compile(r"^[a-z]+(?:\([^)]+\))?!:")
BREAKING_TRAILER_RE = re.compile(r"^BREAKING[ -]CHANGE:", re.MULTILINE)

DEFAULT_CONFIG = ".github/release-please-config.json"


def fail(msg: str) -> None:
    print(f"::error::{msg}", file=sys.stderr)


def die(msg: str, code: int = 2) -> None:
    fail(msg)
    sys.exit(code)


def require_sha(name: str, value: str) -> str:
    if not SHA_RE.match(value):
        die(f"env {name} is not a git SHA: {value!r}")
    return value


def git(args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def spec_roots(config_path: str) -> list[str]:
    """The distinct roots of the config's spec packages, sorted."""
    try:
        with open(config_path, encoding="utf-8") as handle:
            packages = json.load(handle).get("packages", {})
    except (OSError, ValueError) as exc:
        die(f"cannot read packages from {config_path}: {exc}")
    roots = {m.group("root") for m in map(SPEC_PACKAGE_RE.match, packages) if m}
    if not roots:
        die(f"no spec package (<root>/vX.Y) in {config_path}")
    return sorted(roots)


class SpecTree:
    """The spec version directories of one repository, by root."""

    def __init__(self, roots: list[str]) -> None:
        self.roots = roots
        alternation = "|".join(re.escape(r) for r in roots)
        # Group 1 is the version directory (`<root>/vX.Y`), the key every
        # rule works with.
        self.version_re = re.compile(rf"^((?:{alternation})/v\d+\.\d+)/")

    def version_dir(self, path: str) -> str | None:
        m = self.version_re.match(path)
        return m.group(1) if m else None

    @staticmethod
    def relative_to(path: str, version_dir: str) -> str:
        return path[len(version_dir) + 1:]

    @staticmethod
    def directory_exists(sha: str, version_dir: str) -> bool:
        try:
            return bool(git(["ls-tree", "-d", sha, version_dir]).strip())
        except subprocess.CalledProcessError:
            return False  # no such commit (a root commit has no parent)

    def touched_version_dirs(self, sha: str) -> set[str]:
        """Return the spec version directories a commit touches, per rule A.

        Every path an entry names charges its directory. Exact renames
        (`-M100%`) surface as `R100<TAB>old<TAB>new` and charge both ends;
        an edited-and-moved file surfaces as a delete plus an add. Then the
        whole-directory exemption: a directory the commit removes, and whose
        every removed path reappears at the same relative path under
        exactly one other directory, is dropped from the set -- the
        directory was renamed, whatever else the commit did to its files.
        """
        entries = git(
            ["diff-tree", "--no-commit-id", "--name-status", "-r", "-M100%", sha],
        ).splitlines()
        dirs: set[str] = set()
        removed: dict[str, set[str]] = {}  # dir -> relative paths it lost
        present: dict[str, set[str]] = {}  # dir -> relative paths it gained
        for entry in entries:
            fields = entry.split("\t")
            status = fields[0]
            if status.startswith("R") and len(fields) == 3:
                pairs = [("D", fields[1]), ("A", fields[2])]
            else:
                pairs = [(status[:1], path) for path in fields[1:]]
            for kind, path in pairs:
                d = self.version_dir(path)
                if not d:
                    continue
                dirs.add(d)
                if kind == "D":
                    removed.setdefault(d, set()).add(self.relative_to(path, d))
                elif kind == "A":
                    present.setdefault(d, set()).add(self.relative_to(path, d))

        for old, lost in removed.items():
            # The directory must vanish in this commit: present before, gone
            # after. Anything left behind means a partial move.
            if self.directory_exists(sha, old) or not self.directory_exists(f"{sha}^", old):
                continue
            destinations = [
                new for new, gained in present.items()
                if new != old and lost <= gained
            ]
            if len(destinations) == 1:
                dirs.discard(old)
        return dirs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "--config", default=DEFAULT_CONFIG,
        help=f"release-please config (default: {DEFAULT_CONFIG})",
    )
    args = parser.parse_args(argv)

    base = require_sha("BASE_SHA", os.environ.get("BASE_SHA", ""))
    head = require_sha("HEAD_SHA", os.environ.get("HEAD_SHA", ""))
    tree = SpecTree(spec_roots(args.config))
    shape = " | ".join(f"{r}/vX.Y/" for r in tree.roots)

    rev_range = f"{base}..{head}"
    shas = git(["rev-list", rev_range]).split()
    if not shas:
        print("no commits in range; nothing to validate")
        return 0

    violations = 0
    for sha in reversed(shas):  # oldest first
        version_dirs = tree.touched_version_dirs(sha)

        if not version_dirs:
            continue  # commit doesn't touch any spec version; out of scope

        # Rule A -- single commit, multiple spec versions
        if len(version_dirs) > 1:
            joined = ", ".join(sorted(version_dirs))
            fail(
                f"commit {sha[:12]} touches multiple spec versions ({joined}). "
                f"Each commit MUST stay within one {shape} directory."
            )
            violations += 1

        # Rule B -- breaking-change syntax forbidden when touching any spec version
        msg = git(["log", "-1", "--format=%B", sha])
        header = msg.split("\n", 1)[0]
        is_breaking = bool(BREAKING_HEADER_RE.match(header)) or bool(
            BREAKING_TRAILER_RE.search(msg),
        )
        if is_breaking:
            joined = ", ".join(sorted(version_dirs))
            fail(
                f"commit {sha[:12]} declares a breaking change while touching "
                f"{joined}. Breaking changes spawn a new {shape} directory; "
                "they do NOT bump within an existing version."
            )
            violations += 1

    if violations:
        print(f"{violations} commit-rule violation(s)", file=sys.stderr)
        return 1
    print(f"validated {len(shas)} commit(s); no violations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
