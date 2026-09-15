"""Lock in the schema extension surface.

The JSON Schema description claims that adding a new resource generator
means two coordinated edits:

1. Add a ``$defs/<name>`` entry describing the generator's sub-config.
2. Add a ``properties.resources.properties.<name>`` reference pointing at
   ``#/$defs/<name>``.

This test exercises both halves end-to-end against the bundled schema so
the 10 future generator agents have a documentation-by-example of what a
valid extension looks like, and so the contract cannot drift silently.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMA_PATH = (
    Path(__file__).resolve().parents[2]
    / "schema"
    / "well-known.schema.json"
)


def _load_schema() -> dict:
    with SCHEMA_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def test_bundled_schema_is_metavalid() -> None:
    """Bundled schema itself must satisfy Draft 2020-12."""
    Draft202012Validator.check_schema(_load_schema())


def test_extension_via_defs_and_resources_property_is_accepted() -> None:
    """Adding ``$defs/foo`` + ``properties.resources.properties.foo`` works."""
    schema = _load_schema()
    schema["$defs"]["foo"] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {"x": {"type": "string"}},
    }
    schema["properties"]["resources"]["properties"]["foo"] = {
        "$ref": "#/$defs/foo",
    }

    validator = Draft202012Validator(schema)
    assert validator.is_valid(
        {"version": 1, "resources": {"foo": {"x": "hello"}}}
    )


def test_unknown_resource_still_rejected_after_extension() -> None:
    """``additionalProperties: false`` on ``resources`` must keep biting."""
    schema = _load_schema()
    schema["$defs"]["foo"] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {"x": {"type": "string"}},
    }
    schema["properties"]["resources"]["properties"]["foo"] = {
        "$ref": "#/$defs/foo",
    }

    validator = Draft202012Validator(schema)
    assert not validator.is_valid(
        {"version": 1, "resources": {"bar": {}}}
    )


def test_extension_sub_config_validation_propagates() -> None:
    """A bad sub-config under the extended key MUST fail (not just be ignored)."""
    schema = _load_schema()
    schema["$defs"]["foo"] = {
        "type": "object",
        "required": ["x"],
        "additionalProperties": False,
        "properties": {"x": {"type": "string"}},
    }
    schema["properties"]["resources"]["properties"]["foo"] = {
        "$ref": "#/$defs/foo",
    }

    validator = Draft202012Validator(schema)
    # missing required ``x``
    assert not validator.is_valid(
        {"version": 1, "resources": {"foo": {}}}
    )
    # wrong type for ``x``
    assert not validator.is_valid(
        {"version": 1, "resources": {"foo": {"x": 7}}}
    )


def test_pristine_schema_is_not_mutated_between_tests() -> None:
    """Sanity: deep-copying the schema before edits keeps the file pristine.

    Future contributors: ``copy.deepcopy`` (or per-test ``_load_schema``) is
    REQUIRED — mutating the dict returned by ``json.load`` once would
    leak into other tests because module-level caches do not isolate it.
    """
    a = _load_schema()
    b = _load_schema()
    snapshot = copy.deepcopy(a)
    a["$defs"]["scratch"] = {"type": "string"}
    assert "scratch" not in b["$defs"]
    assert "scratch" not in snapshot["$defs"]
