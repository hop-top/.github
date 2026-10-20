"""The rules of ``version_check.py``, one function each.

Each takes the ``Repo`` (``version_check.Repo``: the manifest, the
config, the extra-files index) and the line or file at hand, and returns
its findings. The rules themselves are described in ``version_check.py``.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from version_check import Repo

ANNOTATION = "x-release-please-version"
# The generic updater's own version regex (release-please
# src/updaters/generic.ts): what it would rewrite on an annotated line.
VERSION_RE = re.compile(
    r"(?<![\w.-])(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)"
    r"(-(?P<pre>[\w.]+))?(\+(?P<build>[-\w.]+))?(?![\w-])",
)
# The prerelease channel shape and its PEP 440 spelling.
CHANNEL_RE = re.compile(r"(?<![\w.-])\d+\.\d+\.\d+-(alpha|beta|rc)\.\d+(?![\w-])")
PEP440_RE = re.compile(r"(?<![\w.-])\d+\.\d+\.\d+(a|b|rc)\d+(?![\w-])")
# A corpus walker's spelling: a quoted vX.Y token joined, within a short
# span, to a quoted "conformance" -- covers `"v1.0", "conformance"`,
# `"v1.0" / "conformance"`, `.join("v1.0").join("conformance")` and
# `'v1.0' . DIRECTORY_SEPARATOR . 'conformance'`.
WALKER_RE = re.compile(r"""["']v(\d+\.\d+)["'][^\n"']{0,40}["']conformance["']""")


class Finding:
    __slots__ = ("path", "line", "rule", "detail")

    def __init__(self, path: str, line: int, rule: str, detail: str) -> None:
        self.path, self.line, self.rule, self.detail = path, line, rule, detail

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: {self.rule}: {self.detail}"


# --------------------------------------------------------------------
# Rules
# --------------------------------------------------------------------


def rule_annotated(repo: Repo, path: str, n: int, line: str) -> list[Finding]:
    """Rule 1: an annotated line holds its package's manifest version."""
    pkg = repo.package_of(path)
    if pkg is None:
        return [Finding(path, n, "annotated",
                        "annotation outside every release-please package path; "
                        "release-please cannot rewrite it")]
    # The generic updater rewrites the first SemVer match only, so any
    # other version token on the line -- SemVer or PEP 440 -- would be
    # left behind to go stale unseen.
    literals = [m.group(0) for m in VERSION_RE.finditer(line)]
    literals += [m.group(0) for m in PEP440_RE.finditer(line)]
    if len(literals) != 1:
        return [Finding(path, n, "annotated",
                        f"expected exactly one version literal on the annotated line, "
                        f"found {len(literals)}")]
    want = repo.manifest.get(pkg)
    if literals[0] != want:
        return [Finding(path, n, "annotated",
                        f"{literals[0]} != manifest[{pkg}] = {want}")]
    return []


def rule_unrewritten(repo: Repo, path: str, n: int) -> list[Finding]:
    """Rule 1, cont.: an annotation release-please never rewrites."""
    if path in repo.typed_files and path not in repo.generic_files:
        return [Finding(path, n, "annotated",
                        "a typed extra-files target only: release-please rewrites its "
                        "selector, never this annotation")]
    if repo.structured_files.get(path) == "yaml" and repo.default_state.get(path) == "ok":
        return [Finding(path, n, "annotated",
                        "release-please's YAML updater rewrites $.version and re-dumps the "
                        "file without comments: this annotation is never rewritten")]
    return []


def rule_configured(repo: Repo, annotated: set[str]) -> list[Finding]:
    """Rule 2: annotated files and generic extra-files entries are one set.

    A typed entry's selector is its marker, a plain structured entry's
    default path can be: neither needs an annotation then.
    """
    out: list[Finding] = []
    for path in sorted(repo.unreadable):
        out.append(Finding(path, 0, "configured",
                           "YAML target not checked: PyYAML is not importable (pip install pyyaml)"))
    configured = repo.configured_extra_files()
    for path in sorted(configured - annotated - repo.default_marked - repo.unreadable):
        why = repo.unmarked.get(path)
        out.append(Finding(path, 0, "configured",
                           f"listed in extra-files but carries no {ANNOTATION} line"
                           + (f" and {why}" if why else "")))
    for path in sorted(annotated - configured - repo.typed_files):
        out.append(Finding(path, 0, "configured",
                           f"carries {ANNOTATION} but is not an extra-files entry"))
    return out


def rule_literal(repo: Repo, path: str, n: int, line: str) -> list[Finding]:
    """Rule 3: no stray release-version literal on an un-annotated line."""
    out: list[Finding] = []
    for m in VERSION_RE.finditer(line):
        if m.group(0) in repo.manifest.values():
            out.append(Finding(path, n, "literal",
                               f"{m.group(0)} equals a manifest version and is not "
                               f"annotated with {ANNOTATION}"))
    for m in CHANNEL_RE.finditer(line):
        if m.group(0) not in repo.manifest.values():
            out.append(Finding(path, n, "literal",
                               f"{m.group(0)} is a hard-coded prerelease version"))
    for m in PEP440_RE.finditer(line):
        out.append(Finding(path, n, "literal",
                           f"{m.group(0)} is a hard-coded prerelease version (PEP 440)"))
    return out


def rule_spec_path(
    repo: Repo, path: str, n: int, line: str, known: dict[str, set[str]],
) -> list[Finding]:
    """Rule 4: every <root>/vX.Y path names a manifest spec version."""
    if not known:
        return []  # no spec package: nothing to name
    out: list[Finding] = []
    seen: set[str] = set()
    every = sorted(f"{root}/v{v}" for root, vs in known.items() for v in vs)
    listed = ", ".join(every) or "none"
    for root, pattern in repo.spec_roots.items():
        for m in pattern.finditer(line):
            v = m.group(1)
            key = f"{root}/v{v}"
            if v in known[root] or key in seen:
                continue
            seen.add(key)
            out.append(Finding(path, n, "spec-path",
                               f"{key} is not a manifest package (known: {listed})"))
    any_root = set().union(*known.values())
    for m in WALKER_RE.finditer(line):
        v = m.group(1)
        if v in any_root or v in seen:
            continue
        seen.add(v)
        out.append(Finding(path, n, "spec-path",
                           f'"v{v}" joined to "conformance" names no manifest spec '
                           f"version (known: {listed})"))
    return out


def rule_forbidden(repo: Repo, path: str, n: int, line: str) -> list[Finding]:
    """Rule 5: no line matches a caller-supplied forbidden pattern."""
    out: list[Finding] = []
    for pattern in repo.forbid:
        m = pattern.search(line)
        if m:
            out.append(Finding(path, n, "forbidden",
                               f"{m.group(0)} matches forbidden literal pattern "
                               f"{pattern.pattern}"))
    return out
