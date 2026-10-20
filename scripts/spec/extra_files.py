"""Read release-please extra-files targets the way release-please does.

Two questions, for ``version_check.py``:

- ``default_path_value``: the value release-please's composite updater
  rewrites in a plain-string ``*.json`` / ``*.yaml`` / ``*.toml`` /
  ``*.xml`` entry (``$.version``, ``/*/version`` for XML), read as the
  preflight reads it.
- ``selector_lines``: the line(s) holding the value a selector names --
  the only lines release-please rewrites in a typed target (or a plain
  one, at its default path). Every other line keeps its literals.

Paths are the simple ones the preflight evaluates (``$.a.b``, ``['a']``,
``[n]``; for XML ``/a/b``, ``//a/b``, ``*`` and ``*[local-name()="x"]``
steps); ``selector_lines`` returns None for anything else. YAML is read
without PyYAML: block-style mappings, scalars typed by release-please's
js-yaml core schema. TOML values need tomllib (or tomli); their lines are
found by a key scanner. Standard library only otherwise.
"""

from __future__ import annotations

import json
import pathlib
import re
import xml.parsers.expat

# A plain-string entry with one of these suffixes is rewritten at a default
# path first (release-please's CompositeUpdater), then through the annotation.
STRUCTURED_SUFFIXES = {".json": "json", ".yaml": "yaml", ".yml": "yaml",
                       ".toml": "toml", ".xml": "xml"}
DEFAULT_PATHS = {"json": "$.version", "yaml": "$.version", "toml": "$.version",
                 "xml": "/*/version"}
# The preflight's test for a JSON version string (searched, not anchored).
JSON_VERSION_RE = re.compile(r"\d+\.\d+\.\d+(-[\w.]+)?(\+[-\w.]+)?")

Steps = list  # of str (key) and int (index)


def parse_jsonpath(sel: str) -> Steps | None:
    """``$.a.b`` / ``$['a']`` / ``$[0]`` as steps; None beyond those."""
    if not sel.startswith("$"):
        return None
    token = re.compile(r"""\.([A-Za-z_$][\w$-]*)|\[(\d+)\]|\['([^']*)'\]|\["([^"]*)"\]""")
    steps: Steps = []
    rest = sel[1:]
    while rest:
        m = token.match(rest)
        if not m:
            return None
        name, index, single, double = m.groups()
        steps.append(int(index) if index is not None else next(
            g for g in (name, single, double) if g is not None))
        rest = rest[m.end():]
    return steps


# --------------------------------------------------------------------
# YAML (block style, js-yaml core schema)
# --------------------------------------------------------------------

_YAML_KEY = re.compile(r"""^(?P<ind> *)(?P<key>"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"\[\]{},&*!|>%@`-][^#]*?|-[^\s#][^#]*?)\s*:(?:\s+(?P<val>.*?))?\s*$""")
_YAML_NOT_STRING = re.compile(
    r"^(~|null|Null|NULL|true|True|TRUE|false|False|FALSE"
    r"|[-+]?(0|[1-9][0-9_]*)|0b[01_]+|0o[0-7_]+|0x[0-9a-fA-F_]+"
    r"|[-+]?(\.[0-9]+|[0-9][0-9_]*)(\.[0-9_]*)?([eE][-+]?[0-9]+)?"
    r"|[-+]?\.(inf|Inf|INF)|\.(nan|NaN|NAN)"
    r"|\d{4}-\d\d?-\d\d?([Tt ].*)?)$")


def _yaml_key(raw: str) -> str:
    if raw.startswith('"'):
        return json.loads(raw)
    if raw.startswith("'"):
        return raw[1:-1].replace("''", "'")
    return raw


def yaml_scalar(raw: str) -> tuple[bool, str]:
    """(is a string under release-please's js-yaml schema, its text)."""
    raw = re.sub(r"\s+#.*$", "", raw).strip() if not raw[:1] in "'\"" else raw.strip()
    raw = re.sub(r"^&\S+\s+", "", raw)
    if raw.startswith("!!str "):
        return True, raw[6:].strip()
    if raw.startswith('"'):
        try:
            return True, json.loads(raw)
        except ValueError:
            return True, raw.strip('"')
    if raw.startswith("'"):
        return True, raw[1:-1].replace("''", "'")
    if raw[:1] in ("|", ">"):
        return True, raw
    if not raw or raw[:1] in "[{*!" or _YAML_NOT_STRING.match(raw):
        return False, raw
    return True, raw


def yaml_entries(text: str, steps: Steps) -> list[tuple[int, str]]:
    """``(line, raw value)`` for every block mapping key at ``steps``,
    across documents. Keys under a sequence item never match."""
    out: list[tuple[int, str]] = []
    stack: list[tuple[int, str | None]] = []
    block_indent = None  # inside a block scalar deeper than this
    for n, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        ind = len(line) - len(line.lstrip(" "))
        if block_indent is not None:
            if not stripped or ind > block_indent:
                continue
            block_indent = None
        if not stripped or stripped.startswith("#"):
            continue
        if stripped in ("---", "...") or stripped.startswith("--- "):
            stack = []
            continue
        while stack and stack[-1][0] >= ind:
            stack.pop()
        if stripped == "-" or stripped.startswith("- "):
            stack.append((ind, None))  # a sequence: no key path below it
            continue
        m = _YAML_KEY.match(line)
        if not m:
            continue
        val = m.group("val") or ""
        stack.append((ind, _yaml_key(m.group("key"))))
        if [k for _, k in stack] == steps:
            out.append((n, val))
        if val[:1] in ("|", ">"):
            block_indent = ind
    return out


# --------------------------------------------------------------------
# TOML (key scanner; values come from tomllib)
# --------------------------------------------------------------------

_TOML_KEY = r"""(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')"""
_TOML_DOTTED = rf"{_TOML_KEY}(?:\s*\.\s*{_TOML_KEY})*"
_TOML_TABLE = re.compile(rf"^\s*\[\s*({_TOML_DOTTED})\s*\]\s*(?:#.*)?$")
_TOML_ARRAY_TABLE = re.compile(rf"^\s*\[\[\s*({_TOML_DOTTED})\s*\]\]")
_TOML_PAIR = re.compile(rf"^\s*({_TOML_DOTTED})\s*=\s*(.*)$")


def _toml_keys(dotted: str) -> list[str]:
    keys = []
    for k in re.findall(_TOML_KEY, dotted):
        keys.append(json.loads(k) if k.startswith('"') else k.strip("'"))
    return keys


def toml_lines(text: str, steps: Steps) -> set[int]:
    lines: set[int] = set()
    table: list[str] | None = []
    in_multiline = None
    for n, line in enumerate(text.splitlines(), 1):
        if in_multiline:
            if line.count(in_multiline) % 2:
                in_multiline = None
            continue
        if _TOML_ARRAY_TABLE.match(line):
            table = None  # array of tables: indexed, not a key path
            continue
        m = _TOML_TABLE.match(line)
        if m:
            table = _toml_keys(m.group(1))
            continue
        m = _TOML_PAIR.match(line)
        if not m:
            continue
        value = m.group(2)
        for quote in ('"""', "'''"):
            if value.count(quote) % 2:
                in_multiline = quote
        if table is None:
            continue
        full = table + _toml_keys(m.group(1))
        if full == steps or (value.lstrip().startswith("{") and steps[:len(full)] == full):
            lines.add(n)
    return lines


# --------------------------------------------------------------------
# JSON (offsets of the value at a path)
# --------------------------------------------------------------------


def json_lines(text: str, steps: Steps) -> set[int]:
    decoder = json.JSONDecoder()
    ws = re.compile(r"\s*")

    def skip(i: int) -> int:
        return ws.match(text, i).end()

    try:
        i = skip(0)
        for step in steps:
            opener, closer = ("{", "}") if isinstance(step, str) else ("[", "]")
            if text[i] != opener:
                return set()
            i, found, n = skip(i + 1), None, 0
            while text[i] != closer:
                if isinstance(step, str):
                    key, i = json.decoder.scanstring(text, i + 1)
                    i = skip(skip(i) + 1)  # past ':'
                    hit = key == step  # the last duplicate wins, as in JSON.parse
                else:
                    hit, n = n == step, n + 1
                if hit:
                    found = i
                _, i = decoder.raw_decode(text, i)
                i = skip(i)
                if text[i] == ",":
                    i = skip(i + 1)
            if found is None:
                return set()
            i = found
        _, end = decoder.raw_decode(text, i)
    except (IndexError, ValueError):
        return set()
    first = text.count("\n", 0, i) + 1
    return set(range(first, first + text.count("\n", i, end) + 1))


# --------------------------------------------------------------------
# XML (element lines through expat)
# --------------------------------------------------------------------

_XPATH_STEP = re.compile(r"""^(\*|[\w.-]+(?::[\w.-]+)?|\*\[local-name\(\)\s*=\s*(["'])([\w.-]+)\2\])$""")


def _xpath_steps(sel: str) -> tuple[bool, list[str | None]] | None:
    """(descendant, steps) for ``/a/b`` or ``//a/b``; None steps are ``*``."""
    descendant = sel.startswith("//")
    body = sel[2:] if descendant else sel[1:] if sel.startswith("/") else None
    if not body:
        return None
    steps: list[str | None] = []
    for part in body.split("/"):
        m = _XPATH_STEP.match(part)
        if not m:
            return None
        if m.group(3):
            steps.append(m.group(3))
        else:
            steps.append(None if part == "*" else part.split(":")[-1])
    return descendant, steps


def xml_elements(text: str) -> list[tuple[tuple[str, ...], int, int]] | None:
    """Every element as (local-name path from the root, first, last line)."""
    parser = xml.parsers.expat.ParserCreate()
    stack: list[tuple[str, int]] = []
    out: list[tuple[tuple[str, ...], int, int]] = []

    def start(name, _attrs):
        stack.append((name.split(":")[-1], parser.CurrentLineNumber))

    def end(_name):
        path = tuple(n for n, _ in stack)
        _, first = stack.pop()
        out.append((path, first, parser.CurrentLineNumber))

    parser.StartElementHandler, parser.EndElementHandler = start, end
    try:
        parser.Parse(text, True)
    except xml.parsers.expat.ExpatError:
        return None
    return out


def xml_lines(text: str, sel: str) -> set[int] | None:
    parsed = _xpath_steps(sel)
    elements = xml_elements(text)
    if parsed is None or elements is None:
        return None
    descendant, steps = parsed
    lines: set[int] = set()
    for path, first, last in elements:
        if len(path) < len(steps) or (not descendant and len(path) != len(steps)):
            continue
        tail = path[len(path) - len(steps):]
        if all(s is None or s == p for s, p in zip(steps, tail)):
            lines.update(range(first, last + 1))
    return lines


# --------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------


def selector_lines(text: str, kind: str, selector: str | None) -> set[int] | None:
    """The lines holding the value ``selector`` names in ``text``.

    ``kind`` is json / yaml / toml / xml / pom (pom: ``project/version``,
    else ``project/parent/version``, as release-please's PomXml). An empty
    set: the path matches nothing. None: a selector this module cannot
    place (a jsonpath beyond simple steps, an xpath beyond plain steps).
    """
    if kind == "pom":
        return xml_lines(text, "/project/version") or xml_lines(text, "/project/parent/version")
    if kind == "xml":
        return xml_lines(text, selector or "")
    steps = parse_jsonpath(selector or "")
    if steps is None:
        return None
    if kind == "json":
        return json_lines(text, steps)
    if any(isinstance(s, int) for s in steps):
        return None
    if kind == "yaml":
        return {n for n, _ in yaml_entries(text, steps)}
    return toml_lines(text, steps)


def default_path_value(file: pathlib.Path, kind: str) -> tuple[str, str]:
    """The value at a plain-string entry's default path, read the way the
    preflight's ``extra_file_probe`` reads it.

    Returns ``("ok", value)``; ``("missing", "")``; ``("notversion",
    value)`` -- not a string (JSON: not a version string); ``("parse",
    error)``; or ``("skip", reason)`` when no TOML parser is importable.
    """
    if not file.is_file():
        return "missing", ""
    try:
        if kind == "yaml":
            entries = yaml_entries(file.read_text(encoding="utf-8"), ["version"])
            if not entries:
                return "missing", ""
            scalars = [yaml_scalar(raw) for _, raw in entries]
            hit = next((text for is_str, text in scalars if is_str), None)
            return ("ok", hit) if hit is not None else ("notversion", scalars[0][1])
        if kind == "json":
            with file.open(encoding="utf-8") as handle:
                docs = [json.load(handle)]
        elif kind == "toml":
            try:
                import tomllib
            except ImportError:
                try:
                    import tomli as tomllib
                except ImportError:
                    return "skip", "no TOML parser"
            with file.open("rb") as handle:
                docs = [tomllib.load(handle)]
        else:
            import xml.etree.ElementTree as ET
            root = ET.parse(file).getroot()
            hit = next((c for c in root if c.tag == "version"), None)
            return ("missing", "") if hit is None else ("ok", (hit.text or "").strip())
    except Exception as err:  # every parser's own error type
        return "parse", str(err) or type(err).__name__
    found = [doc["version"] for doc in docs if isinstance(doc, dict) and "version" in doc]
    if not found:
        return "missing", ""
    for value in found:
        if isinstance(value, str) and (kind != "json" or JSON_VERSION_RE.search(value)):
            return "ok", value
    return "notversion", json.dumps(found[0], default=str)
