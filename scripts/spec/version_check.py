#!/usr/bin/env python3
"""Guard the release-version literals and the spec version paths.

release-please owns every version in a repository: the manifest, each
package's native version file, and -- through ``extra-files`` with an
``x-release-please-version`` annotation -- the few literals that live
outside those files. A version typed anywhere else is a literal nobody
rewrites, and it drifts on the first release after it is written.

Rules, each with its own message and a non-zero exit on any finding:

1. ``annotated``  -- every line carrying ``x-release-please-version``
   belongs to a release-please package -- the package whose
   ``extra-files`` lists the file, else the one whose path contains it
   -- holds exactly one version literal (SemVer or PEP 440), and that
   literal equals the manifest's version for the package. An
   ``extra-files`` entry resolves as release-please resolves it: a
   leading ``/`` is repo-root-relative, anything else joins the package
   path (nothing, for the root package ``.``). Outside every package a line
   that names the annotation but carries no version literal is prose
   about the mechanism, not an annotation, and is ignored.
2. ``configured`` -- the set of annotated files equals the set of
   generic ``extra-files`` entries across packages (a plain string, or
   an object of ``type`` ``generic``: what release-please rewrites
   through the annotation). A configured file with no annotation, or an
   annotated file missing from the config, is a half-wired mechanism. A
   typed entry (``type`` json, yaml, toml, xml or pom) is rewritten at
   its ``jsonpath`` / ``xpath`` -- the selector is the marker -- and
   needs no annotation. Neither does a plain ``*.json`` / ``*.yaml`` /
   ``*.yml`` / ``*.toml`` / ``*.xml`` entry with a version at
   ``$.version`` (``/*/version`` for XML), which release-please rewrites
   alongside the annotation. That value counts when release-please's
   updater would rewrite it: JSON a string holding a version, YAML a
   string as js-yaml types it, TOML a string (a boolean, which it would
   overwrite, does not count), XML a ``version`` child of the root
   element in no namespace; without a TOML parser it is not evaluated
   and the entry passes (a note on stderr says so). An
   annotation release-please never rewrites fails as ``annotated``: one
   in a typed-only target, or in a plain YAML entry whose ``$.version``
   the YAML updater rewrites (it re-dumps the file without comments).
3. ``literal``    -- outside the manifest, changelogs, lockfiles, the
   natively rewritten files and the ``--allow`` globs, no un-annotated
   line contains a literal equal to a manifest value, or a literal in
   the prerelease channel shape (``X.Y.Z-alpha.N`` or the PEP 440
   ``X.Y.ZaN``). In an ``extra-files`` target only the line(s) holding
   the value a selector (or a marking default path) names are exempt:
   release-please rewrites those and nothing else. A selector this check
   cannot place exempts nothing (a note on stderr says so).
4. ``spec-path``  -- every ``<root>/vX.Y`` path, and every corpus-walker
   spelling of one (a quoted ``vX.Y`` token joined to a quoted
   ``conformance``), names a version whose ``<root>/vX.Y`` key is in
   the manifest. The roots are those of the config's spec packages
   (package paths of the shape ``<root>/vX.Y``); with no spec package
   the rule is inert.
5. ``forbidden``  -- no un-annotated line matches a ``--forbid-literal``
   regex. The caller names the shapes its own code must never spell
   (a version-bearing product identifier, say).

Usage::

    version_check.py [--root DIR] [--config PATH] [--manifest PATH]
                     [--allow GLOB]... [--forbid-literal REGEX]...

``--config`` and ``--manifest`` are relative to ``--root`` (default:
the current directory). ``--allow`` globs are matched against the
tracked path with ``fnmatch`` (``*`` crosses ``/``); a match skips the
file for rules 3-5 only. Only ``git ls-files`` output is scanned.

Output: one ``path:line: <rule>: <detail>`` per finding, then
``version-check: <n> finding(s)`` on stderr and exit 1; or
``version-check: ok (<n> annotated, <m> files scanned)`` and exit 0.
Standard library (``extra_files.py`` and ``version_rules.py`` beside
it) and PyYAML, for YAML targets: without PyYAML each YAML target is a
``configured`` finding instead of passing unread. tomli is used when
importable, for TOML on Python < 3.11.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import pathlib
import re
import subprocess
import sys

from extra_files import (DEFAULT_PATHS, HAVE_YAML, STRUCTURED_SUFFIXES, default_path_value,
                         selector_lines)
from version_rules import (ANNOTATION, VERSION_RE, Finding, rule_annotated, rule_configured,
                           rule_forbidden, rule_literal, rule_spec_path, rule_unrewritten)

DEFAULT_MANIFEST = ".github/.release-please-manifest.json"
DEFAULT_CONFIG = ".github/release-please-config.json"

# A release-please package path that is a spec version directory.
SPEC_PACKAGE_RE = re.compile(r"^(?P<root>[A-Za-z0-9_.-]+)/v(?P<line>\d+\.\d+)$")

# Files release-please rewrites natively, by release type.
NATIVE_FILES = {
    "go": (),
    "node": ("package.json",),
    "python": ("pyproject.toml",),
    "rust": ("Cargo.toml",),
    "php": ("VERSION",),
    "simple": ("version.txt",),
}
LOCKFILES = ("Cargo.lock", "composer.lock", "pnpm-lock.yaml", "uv.lock")
# extra-files types release-please rewrites at a selector (jsonpath /
# xpath; pom's own), not through the annotation (Strategy#extraFileUpdates).
TYPED_EXTRA_FILES = ("json", "yaml", "toml", "xml", "pom")


def package_file(pkg: str, rel: str) -> str:
    """The repo-root path of ``rel`` as package ``pkg`` names it.

    Mirrors release-please's ``Strategy#addPath``: a leading ``/``
    anchors the path at the repository root, the root package ``.``
    joins nothing, any other package joins its own path.
    """
    if pkg in ("", ".") or rel.startswith("/"):
        return rel.lstrip("/")
    return f"{pkg.rstrip('/')}/{rel}"


def spec_path_re(root: str) -> re.Pattern[str]:
    """A spec version directory under ``root``, with or without a trailing slash."""
    return re.compile(rf"(?<![\w/]){re.escape(root)}/v(\d+\.\d+)(?![\w.])")


class Repo:
    """One tree: the manifest, the config, the tracked text files and the
    caller's allow-list and forbidden patterns."""

    def __init__(
        self,
        root: pathlib.Path,
        manifest: str = DEFAULT_MANIFEST,
        config: str = DEFAULT_CONFIG,
        allow: tuple[str, ...] = (),
        forbid: tuple[re.Pattern[str], ...] = (),
    ) -> None:
        self.root = root
        self.manifest_path = pathlib.PurePosixPath(manifest).as_posix()
        self.manifest: dict[str, str] = self._load(manifest)
        self.config: dict = self._load(config)
        self.packages: dict[str, dict] = self.config.get("packages", {})
        self.extra_files: dict[str, str] = {}
        self.typed_files: set[str] = set()
        self.generic_files: set[str] = set()
        # path -> (format, selector) of every typed entry listing it
        self.selectors: dict[str, list[tuple[str, str | None]]] = {}
        # plain-string entries with a structured suffix: path -> format
        self.structured_files: dict[str, str] = {}
        self._index_extra_files()
        # path -> why its default path does not mark it (rule 2's detail)
        self.unmarked: dict[str, str] = {}
        # path -> state of its default path (extra_files.default_path_value)
        self.default_state: dict[str, str] = {}
        self.notes: list[str] = []
        # YAML targets left unread without PyYAML: each is a finding
        self.unreadable: set[str] = set() if HAVE_YAML else {
            path for path, sels in self.selectors.items() if any(k == "yaml" for k, _ in sels)}
        # files marked by their default path, or not evaluable there
        self.default_marked: set[str] = self._default_marked()
        self.allow = allow
        self.forbid = forbid
        # root -> compiled path regex, for every spec package root.
        self.spec_roots: dict[str, re.Pattern[str]] = {
            m.group("root"): spec_path_re(m.group("root"))
            for m in map(SPEC_PACKAGE_RE.match, self.packages) if m
        }
        self.files = self._tracked()

    def _load(self, rel: str):
        path = self.root / rel
        try:
            with path.open(encoding="utf-8") as handle:
                return json.load(handle)
        except FileNotFoundError:
            sys.exit(f"version-check: missing {rel}")
        except json.JSONDecodeError as err:
            sys.exit(f"version-check: {rel} is not valid JSON: {err}")

    def _tracked(self) -> list[str]:
        result = subprocess.run(
            ["git", "-C", str(self.root), "ls-files", "-z"],
            check=True, capture_output=True, text=True,
        )
        return [f for f in result.stdout.split("\0") if f]

    def package_of(self, path: str) -> str | None:
        """The package release-please rewrites ``path`` for.

        An extra-files entry belongs to the package that lists it, even
        outside that package's directory (a root-relative ``/`` entry);
        otherwise the package whose path contains ``path``; the longest wins.
        """
        owner = self.extra_files.get(path)
        if owner is not None:
            return owner
        best = None
        for pkg in self.packages:
            prefix = pkg.rstrip("/") + "/"
            if path.startswith(prefix) and (best is None or len(pkg) > len(best)):
                best = pkg
        return best

    def native_files(self) -> set[str]:
        out: set[str] = set()
        for pkg, cfg in self.packages.items():
            for name in NATIVE_FILES.get(cfg.get("release-type", ""), ()):
                out.add(package_file(pkg, name))
        return out

    def _index_extra_files(self) -> None:
        """Every extra-files entry as a repo-root path: ``extra_files``
        maps it to the package that lists it (the first, if several do);
        ``typed_files`` holds the paths a typed entry rewrites at its
        selector, ``generic_files`` those of every other entry (a string,
        ``generic``, or a type release-please rejects): the annotation is
        their marker. A package with no ``extra-files`` of its own (unset
        or null: release-please's ``??``) takes the top-level list, joined
        with its own path."""
        default = self.config.get("extra-files") or ()
        for pkg, cfg in self.packages.items():
            own = cfg.get("extra-files")
            for entry in own if own is not None else default:
                rel = entry if isinstance(entry, str) else entry.get("path", "")
                if not rel:
                    continue
                path = package_file(pkg, rel)
                self.extra_files.setdefault(path, pkg)
                if isinstance(entry, dict) and entry.get("type") in TYPED_EXTRA_FILES:
                    self.typed_files.add(path)
                    kind = entry["type"]
                    sel = entry.get("xpath" if kind == "xml" else "jsonpath")
                    self.selectors.setdefault(path, []).append((kind, sel))
                else:
                    self.generic_files.add(path)
                if isinstance(entry, str):
                    kind = STRUCTURED_SUFFIXES.get(pathlib.PurePosixPath(rel).suffix)
                    if kind:
                        self.structured_files[path] = kind

    def _default_marked(self) -> set[str]:
        """The plain structured entries their default path marks: a value
        there, or no parser to tell (the preflight lets those pass)."""
        marked: set[str] = set()
        for path, kind in sorted(self.structured_files.items()):
            sel = DEFAULT_PATHS[kind]
            state, value = default_path_value(self.root / path, kind)
            self.default_state[path] = state
            if state == "noyaml":
                self.unreadable.add(path)
            elif state == "ok":
                marked.add(path)
            elif state == "skip":
                marked.add(path)
                self.notes.append(f"{path}: {sel} not evaluated ({value}); "
                                  "the entry passes without an annotation")
            elif state == "parse":
                self.unmarked[path] = f"no version at {sel} (not valid {kind})"
            elif state == "notversion":
                self.unmarked[path] = f"no version at {sel} ({sel} is {value})"
            else:
                self.unmarked[path] = f"no version at {sel}"
        return marked

    def rewritten_lines(self, path: str, text: str) -> set[int]:
        """The lines release-please rewrites at a selector: every typed
        entry's, and the default path of a marked plain structured one.
        An unread YAML target (already a finding) is not checked line by
        line."""
        if path in self.unreadable:
            return set(range(1, text.count("\n") + 2))
        targets = list(self.selectors.get(path, ()))
        if path in self.default_marked:
            kind = self.structured_files[path]
            targets.append((kind, DEFAULT_PATHS[kind]))
        lines: set[int] = set()
        for kind, sel in targets:
            found = selector_lines(text, kind, sel)
            if found is None:
                self.notes.append(f"{path}: {kind} selector {sel} not placed; "
                                  "rule 3 reads every line")
                continue
            lines |= found
        return lines

    def configured_extra_files(self) -> set[str]:
        """The entries that must carry the annotation."""
        return set(self.generic_files)

    def spec_versions(self) -> dict[str, set[str]]:
        """Manifest-known spec versions, by root: ``{"spec": {"1.0"}}``."""
        known: dict[str, set[str]] = {root: set() for root in self.spec_roots}
        for key in self.manifest:
            m = SPEC_PACKAGE_RE.match(key)
            if m and m.group("root") in known:
                known[m.group("root")].add(m.group("line"))
        return known

    def scannable(self, path: str) -> bool:
        """Whether rules 3-5 read this file at all."""
        base = path.rsplit("/", 1)[-1]
        if base == "CHANGELOG.md" or base in LOCKFILES:
            return False
        if path == self.manifest_path or path in self.native_files():
            return False
        return not any(fnmatch.fnmatch(path, pat) for pat in self.allow)

    def lines(self, path: str) -> list[str] | None:
        try:
            return (self.root / path).read_text(encoding="utf-8").splitlines()
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            return None


# --------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------


def check(repo: Repo) -> tuple[list[Finding], int, int]:
    known = repo.spec_versions()
    findings: list[Finding] = []
    annotated_files: set[str] = set()
    annotated_lines = 0
    scanned = 0
    for path in repo.files:
        if not repo.scannable(path):
            continue
        lines = repo.lines(path)
        if lines is None:
            continue
        scanned += 1
        in_package = repo.package_of(path) is not None
        # Release-please rewrites these lines at a selector: un-annotated.
        rewritten = repo.rewritten_lines(path, "\n".join(lines))
        for n, line in enumerate(lines, 1):
            if ANNOTATION in line:
                if not in_package and not VERSION_RE.search(line):
                    continue  # prose naming the annotation, nothing to rewrite
                annotated_files.add(path)
                annotated_lines += 1
                findings += rule_unrewritten(repo, path, n) or rule_annotated(repo, path, n, line)
                continue
            if n not in rewritten:
                findings += rule_literal(repo, path, n, line)
            findings += rule_spec_path(repo, path, n, line, known)
            findings += rule_forbidden(repo, path, n, line)
    findings += rule_configured(repo, annotated_files)
    findings.sort(key=lambda f: (f.path, f.line, f.rule))
    return findings, annotated_lines, scanned


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "--root", type=pathlib.Path, default=pathlib.Path.cwd(),
        help="repository root (default: the current directory)",
    )
    parser.add_argument(
        "--config", default=DEFAULT_CONFIG,
        help=f"release-please config, relative to --root (default: {DEFAULT_CONFIG})",
    )
    parser.add_argument(
        "--manifest", default=DEFAULT_MANIFEST,
        help=f"release-please manifest, relative to --root (default: {DEFAULT_MANIFEST})",
    )
    parser.add_argument(
        "--allow", action="append", default=[], metavar="GLOB",
        help="skip matching tracked paths for rules 3-5 (repeatable; fnmatch, "
             "`*` crosses `/`)",
    )
    parser.add_argument(
        "--forbid-literal", action="append", default=[], metavar="REGEX",
        help="fail any un-annotated line matching REGEX (repeatable)",
    )
    args = parser.parse_args(argv)
    forbid: list[re.Pattern[str]] = []
    for pattern in args.forbid_literal:
        try:
            forbid.append(re.compile(pattern))
        except re.error as err:
            parser.error(f"--forbid-literal {pattern!r}: {err}")
    repo = Repo(
        args.root.resolve(), manifest=args.manifest, config=args.config,
        allow=tuple(args.allow), forbid=tuple(forbid),
    )
    findings, annotated, scanned = check(repo)
    for note in repo.notes:
        print(f"version-check: {note}", file=sys.stderr)
    for f in findings:
        print(f)
    if findings:
        print(f"version-check: {len(findings)} finding(s)", file=sys.stderr)
        return 1
    print(f"version-check: ok ({annotated} annotated, {scanned} files scanned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
