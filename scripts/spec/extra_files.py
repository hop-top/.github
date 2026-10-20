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
steps, a plain name matching an element in no namespace only, as in
release-please's XPath 1.0); ``selector_lines`` returns None for
anything else. YAML is read
with PyYAML's BaseLoader (no implicit tags) and its plain scalars typed
by YAML 1.2's core schema, as release-please's js-yaml types them;
without PyYAML, ``HAVE_YAML`` is false and YAML is not read. TOML values
need tomllib (or tomli); their lines are found by a key scanner.
Standard library otherwise.
"""

from __future__ import annotations

import json
import pathlib
import re
import xml.parsers.expat

try:
    import yaml
except ImportError:  # the caller reports YAML targets as unchecked
    yaml = None
HAVE_YAML = yaml is not None

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
# YAML (PyYAML nodes, js-yaml's core schema)
# --------------------------------------------------------------------

# Plain scalars js-yaml's default schema (YAML 1.2 core, plus timestamps)
# reads as something other than a string.
_YAML_NOT_STRING = re.compile(
    r"^(~|null|Null|NULL|true|True|TRUE|false|False|FALSE"
    r"|[-+]?(0|[1-9][0-9_]*)|0b[01_]+|0o[0-7_]+|0x[0-9a-fA-F_]+"
    r"|[-+]?(\.[0-9]+|[0-9][0-9_]*)(\.[0-9_]*)?([eE][-+]?[0-9]+)?"
    r"|[-+]?\.(inf|Inf|INF)|\.(nan|NaN|NAN)"
    r"|\d{4}-\d\d?-\d\d?([Tt ].*)?)?$")
_YAML_STR_TAG = "tag:yaml.org,2002:str"


class YamlHit:
    """The scalar at a path in one document: its 1-based line, whether
    js-yaml reads it as a string, its text, and whether that line is the
    value's alone (no flow collection, anchor, alias, tag or block scalar
    on the way to it)."""

    __slots__ = ("line", "is_string", "value", "placeable")

    def __init__(self, line: int, is_string: bool, value: str, placeable: bool) -> None:
        self.line, self.is_string, self.value, self.placeable = line, is_string, value, placeable


def _yaml_is_string(node, text: str) -> bool:
    if node.tag != _YAML_STR_TAG:
        return False  # an explicit !!int, !!bool, ...
    if node.style or text[node.start_mark.index:][:1] == "!":
        return True  # quoted, block, or an explicit !!str
    return not _YAML_NOT_STRING.match(node.value)


def yaml_lookup(text: str, steps: Steps) -> list[YamlHit]:
    """Every scalar at ``steps``, across documents (release-please's YAML
    updater rewrites them all). Raises ``yaml.YAMLError`` on bad YAML."""
    hits: list[YamlHit] = []
    for doc in yaml.compose_all(text, Loader=yaml.BaseLoader):
        node, placeable = doc, True
        for step in steps:
            if node is None:
                break
            placeable = placeable and not getattr(node, "flow_style", False)
            if isinstance(step, str) and isinstance(node, yaml.MappingNode):
                found = [v for k, v in node.value
                         if isinstance(k, yaml.ScalarNode) and k.value == step]
                node = found[-1] if found else None
            elif isinstance(step, int) and isinstance(node, yaml.SequenceNode):
                node = node.value[step] if step < len(node.value) else None
            else:
                node = None
            if node is not None and text[node.start_mark.index:][:1] in ("&", "*", "!"):
                placeable = False  # anchored, aliased or tagged
        if node is None:
            continue
        if not isinstance(node, yaml.ScalarNode):  # a collection: never a string
            source = " ".join(text[node.start_mark.index:node.end_mark.index].split())
            hits.append(YamlHit(node.start_mark.line + 1, False, source, False))
            continue
        placeable = placeable and node.style not in ("|", ">")
        hits.append(YamlHit(node.start_mark.line + 1, _yaml_is_string(node, text),
                            node.value, placeable))
    return hits


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

_XPATH_STEP = re.compile(r"""^(\*|[\w.-]+|\*\[local-name\(\)\s*=\s*(["'])([\w.-]+)\2\])$""")
_NS_SEP = " "  # expat's namespace separator: "<uri> <local>"; a URI holds no space

# An element as (namespace URI or None, local name); a step as
# ("name", local) -- XPath 1.0: no namespace only --, ("local", local) from
# local-name(), or ("any", None) for `*`.
Element = tuple  # (str | None, str)


def _xpath_steps(sel: str) -> tuple[bool, list[tuple[str, str | None]]] | None:
    """(descendant, steps) for ``/a/b`` or ``//a/b``. A prefixed step is
    None: release-please's xpath has no namespace resolver and throws."""
    descendant = sel.startswith("//")
    body = sel[2:] if descendant else sel[1:] if sel.startswith("/") else None
    if not body:
        return None
    steps: list[tuple[str, str | None]] = []
    for part in body.split("/"):
        m = _XPATH_STEP.match(part)
        if not m:
            return None
        if m.group(3):
            steps.append(("local", m.group(3)))
        elif part == "*":
            steps.append(("any", None))
        else:
            steps.append(("name", part))
    return descendant, steps


def _step_matches(step: tuple[str, str | None], element: Element) -> bool:
    how, local = step
    ns, name = element
    if how == "any":
        return True
    return name == local and (how == "local" or ns is None)


def xml_elements(text: str) -> list[tuple[tuple[Element, ...], int, int]] | None:
    """Every element as (its (namespace, local name) path from the root,
    first line, last line)."""
    parser = xml.parsers.expat.ParserCreate(namespace_separator=_NS_SEP)
    stack: list[tuple[Element, int]] = []
    out: list[tuple[tuple[Element, ...], int, int]] = []

    def start(name, _attrs):
        ns, _, local = name.rpartition(_NS_SEP)
        stack.append(((ns or None, local), parser.CurrentLineNumber))

    def end(_name):
        path = tuple(e for e, _ in stack)
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
        if all(_step_matches(s, e) for s, e in zip(steps, tail)):
            lines.update(range(first, last + 1))
    return lines


# --------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------


def selector_lines(text: str, kind: str, selector: str | None) -> set[int] | None:
    """The lines holding the value ``selector`` names in ``text``.

    ``kind`` is json / yaml / toml / xml / pom (pom: ``project/version``,
    else ``project/parent/version``, by local name in any namespace, as
    release-please's PomXml). An empty
    set: the path matches nothing. None: a selector this module cannot
    place (a jsonpath beyond simple steps, an xpath beyond plain steps).
    """
    if kind == "pom":
        project = '/*[local-name()="project"]'
        return (xml_lines(text, f'{project}/*[local-name()="version"]')
                or xml_lines(text, f'{project}/*[local-name()="parent"]/*[local-name()="version"]'))
    if kind == "xml":
        return xml_lines(text, selector or "")
    steps = parse_jsonpath(selector or "")
    if steps is None:
        return None
    if kind == "json":
        return json_lines(text, steps)
    if kind == "yaml":
        try:
            hits = yaml_lookup(text, steps)
        except yaml.YAMLError:
            return set()  # release-please leaves an unparseable file alone
        hits = [hit for hit in hits if hit.is_string]  # the only values it rewrites
        if not all(hit.placeable for hit in hits):
            return None
        return {hit.line for hit in hits}
    if any(isinstance(s, int) for s in steps):
        return None
    return toml_lines(text, steps)


def default_path_value(file: pathlib.Path, kind: str) -> tuple[str, str]:
    """The value at a plain-string entry's default path, read the way the
    preflight's ``extra_file_probe`` reads it.

    Returns ``("ok", value)``; ``("missing", "")``; ``("notversion",
    value)`` -- not a string (JSON: not a version string); ``("parse",
    error)``; ``("skip", reason)`` when no TOML parser is importable; or
    ``("noyaml", reason)`` for YAML without PyYAML.
    """
    if kind == "yaml" and not HAVE_YAML:
        return "noyaml", "PyYAML is not importable"
    if not file.is_file():
        return "missing", ""
    try:
        if kind == "yaml":
            hits = yaml_lookup(file.read_text(encoding="utf-8"), ["version"])
            if not hits:
                return "missing", ""
            hit = next((h for h in hits if h.is_string), None)
            return ("ok", hit.value) if hit else ("notversion", hits[0].value)
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
