"""Tests for the well-known-publisher composite action's run blocks.

Installs (the action's, and `make test-well-known`'s in this repo's CI)
take only hash-pinned requirement files, so nothing unpinned is fetched.

The action's steps run with the caller's checkout as the working
directory. `python -m <module>` puts that directory first on sys.path,
so a repo-root `venv.py`, `pip/` or `shutil.py` would be imported in
place of the real module (before pip ever checks a hash). `-P` (Python
3.11+) drops that entry, so every Python invocation in the action must
carry it.
"""

from __future__ import annotations

import re
import shlex
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ACTION = ROOT / ".github" / "actions" / "well-known-publisher" / "action.yml"
MAKEFILE = ROOT / "Makefile"

# The interpreter is reached through a variable (setup-python's
# python-path, then the venv's python) or by name.
INTERPRETER = re.compile(r"\$\{\w*(?:py|PYTHON)\w*\}|(?:.*/)?python[0-9.]*(?:\.exe)?")
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def run_blocks(path: Path) -> list[str]:
    """Every literal `run: |` block in the file, dedented."""
    lines = path.read_text(encoding="utf-8").splitlines()
    blocks = []
    for i, line in enumerate(lines):
        if line.strip() != "run: |":
            continue
        indent = len(line) - len(line.lstrip())
        body: list[str] = []
        for nxt in lines[i + 1:]:
            if nxt.strip() and len(nxt) - len(nxt.lstrip()) <= indent:
                break
            body.append(nxt)
        blocks.append(textwrap.dedent("\n".join(body)))
    return blocks


def commands(script: str) -> list[list[str]]:
    """Simple commands of a script: continuations joined, comments dropped,
    split on ; && || | outside quotes, leading VAR=value words removed."""
    out = []
    for line in re.sub(r"\\\n", " ", script).splitlines():
        lex = shlex.shlex(line, posix=True, punctuation_chars=";&|")
        lex.whitespace_split = True
        words: list[str] = []
        for tok in [*lex, ";"]:
            if tok and set(tok) <= set(";&|"):
                while words and ASSIGNMENT.match(words[0]):
                    words.pop(0)
                if words:
                    out.append(words)
                words = []
            else:
                words.append(tok)
    return out


def python_calls(path: Path) -> list[list[str]]:
    return [cmd for block in run_blocks(path) for cmd in commands(block)
            if INTERPRETER.fullmatch(cmd[0])]


def interpreter_flags(cmd: list[str]) -> list[str]:
    """Options before the module/script: everything up to and including -m."""
    flags = []
    for word in cmd[1:]:
        if not word.startswith("-"):
            break
        flags.append(word)
        if word == "-m":
            break
    return flags


class SafePathTests(unittest.TestCase):
    def test_the_python_calls_are_the_known_ones(self) -> None:
        # Guards against the parser silently finding nothing.
        modules = [cmd[cmd.index("-m") + 1] for cmd in python_calls(ACTION) if "-m" in cmd]
        self.assertEqual(modules, ["venv", "pip", "well_known_publisher"])

    def test_every_python_call_carries_dash_p(self) -> None:
        calls = python_calls(ACTION)
        self.assertTrue(calls)
        for cmd in calls:
            with self.subTest(call=" ".join(cmd)):
                self.assertIn("-P", interpreter_flags(cmd))

    def test_the_checker_flags_a_missing_dash_p(self) -> None:
        # The parser itself: a call without -P is found and lacks it.
        script = '"${WKP_PYTHON}" -P -m venv "$v"\nX=1 "${py}" -m pip install \\\n  -r r.txt\n'
        cmds = [c for c in commands(script) if INTERPRETER.fullmatch(c[0])]
        self.assertEqual([("-P" in interpreter_flags(c)) for c in cmds], [True, False])


def make_recipe(path: Path, target: str) -> list[str]:
    """Recipe lines of ``target`` with simple ``$(VAR)`` references expanded."""
    lines = path.read_text(encoding="utf-8").splitlines()
    variables = dict(re.findall(r"^([A-Z_]+) :?= (.*)$", "\n".join(lines), re.M))
    start = next(i for i, line in enumerate(lines) if line.startswith(f"{target}:"))
    recipe = []
    for line in lines[start + 1:]:
        if not line.startswith("\t"):
            break
        for _ in range(3):
            line = re.sub(r"\$\(([A-Z_]+)\)", lambda m: variables.get(m.group(1), m.group(0)), line)
        recipe.append(line.strip().lstrip("@-"))
    return recipe


def pip_installs(cmds: list[list[str]]) -> list[list[str]]:
    return [c for c in cmds if "pip" in c and "install" in c]


class PinnedInstallTests(unittest.TestCase):
    def assert_hash_pinned(self, cmd: list[str]) -> None:
        self.assertIn("--require-hashes", cmd)
        self.assertIn("--only-binary", cmd)
        self.assertNotIn("-e", cmd)
        self.assertNotIn("--editable", cmd)
        # Only -r requirement files: no bare package or path arguments.
        args = cmd[cmd.index("install") + 1:]
        files = [args[i + 1] for i, a in enumerate(args) if a == "-r"]
        self.assertTrue(files)
        bare = [a for i, a in enumerate(args)
                if not a.startswith("-") and (i == 0 or args[i - 1] not in ("-r", "--only-binary"))]
        self.assertEqual(bare, [])

    def test_action_installs_only_hashed_wheels(self) -> None:
        installs = pip_installs([c for b in run_blocks(ACTION) for c in commands(b)])
        self.assertEqual(len(installs), 1)
        self.assert_hash_pinned(installs[0])

    def test_make_target_installs_only_hashed_wheels_without_deps(self) -> None:
        installs = pip_installs([c for line in make_recipe(MAKEFILE, "test-well-known")
                                 for c in commands(line)])
        self.assertTrue(installs)
        for cmd in installs:
            with self.subTest(cmd=" ".join(cmd)):
                self.assert_hash_pinned(cmd)
                self.assertIn("--no-deps", cmd)


if __name__ == "__main__":
    unittest.main()
