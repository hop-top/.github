"""Tests for the well-known-publisher composite action's run blocks.

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

ACTION = (Path(__file__).resolve().parents[2]
          / ".github" / "actions" / "well-known-publisher" / "action.yml")

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
    """Simple commands of a script: continuations joined, split on ; && || |."""
    joined = re.sub(r"\\\n", " ", script)
    out = []
    for line in joined.splitlines():
        line = line.split(" #", 1)[0] if not line.lstrip().startswith("#") else ""
        for part in re.split(r"&&|\|\||;|\|", line):
            words = shlex.split(part, posix=True) if part.strip() else []
            while words and ASSIGNMENT.match(words[0]):
                words.pop(0)
            if words:
                out.append(words)
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


if __name__ == "__main__":
    unittest.main()
