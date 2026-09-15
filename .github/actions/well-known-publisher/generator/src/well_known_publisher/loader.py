"""YAML config loader: parse, validate, resolve defaults, interpolate env.

Responsibilities (in order):

1. Read YAML via ``ruamel.yaml`` in round-trip mode (preserves comments,
   ordering, and line numbers via ``CommentedMap.lc``).
2. Validate against the JSON Schema bundled with the action; surface each
   error with the offending source line when available.
3. Resolve defaults (``output_dir``, ``deploy``).
4. Resolve any ISO 8601 duration strings tagged in the schema into absolute
   timestamps (used by the security.txt ``Expires:`` field, among others).
5. Substitute ``${{ env.FOO }}`` placeholders with ``os.environ['FOO']``.

Every schema or env error becomes a GitHub workflow annotation AND is
collected into a ``ConfigError`` raised after the full pass — single
failure is rare so we surface them all in one shot.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Mapping, Sequence

from jsonschema import Draft202012Validator
from ruamel.yaml import YAML

from . import annotations as ann

# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------

DeployMode = Literal["commit", "pages", "worker"]


@dataclass(frozen=True)
class Config:
    """Resolved, validated config returned by :func:`load`."""

    version: int
    output_dir: Path
    deploy: DeployMode | None
    resources: Mapping[str, dict]
    custom: Sequence[dict]
    source_path: Path
    worker_endpoint: str | None = None


class ConfigError(Exception):
    """Raised once after collecting every problem the loader can find."""

    def __init__(self, errors: list[str]):
        self.errors = list(errors)
        super().__init__(
            f"{len(self.errors)} config error(s):\n  - "
            + "\n  - ".join(self.errors)
        )


# ---------------------------------------------------------------------------
# Constants / regexes
# ---------------------------------------------------------------------------

_DEFAULT_OUTPUT_DIR = "dist/.well-known"
_ENV_INTERP_RE = re.compile(r"\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
_ISO8601_DURATION_RE = re.compile(
    r"""
    ^P
    (?!$)
    (?:(?P<days>\d+)D)?
    (?:T
        (?:(?P<hours>\d+)H)?
        (?:(?P<minutes>\d+)M)?
        (?:(?P<seconds>\d+)S)?
    )?
    $
    """,
    re.VERBOSE,
)


# ---------------------------------------------------------------------------
# Schema lookup
# ---------------------------------------------------------------------------

def _schema_path() -> Path:
    """Return the on-disk path to the bundled JSON Schema.

    The schema lives at ``<action>/schema/well-known.schema.json`` — two
    levels up from this package's parent directory. The path is resolved
    lazily so tests can monkeypatch via the ``WKP_SCHEMA_PATH`` env var.
    """
    override = os.environ.get("WKP_SCHEMA_PATH")
    if override:
        return Path(override)
    # src/well_known_publisher/loader.py -> generator/ -> action root
    here = Path(__file__).resolve()
    action_root = here.parents[3]
    return action_root / "schema" / "well-known.schema.json"


def _load_schema() -> dict:
    path = _schema_path()
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError as exc:
        raise ConfigError([f"schema file not found: {path}"]) from exc


# ---------------------------------------------------------------------------
# ISO 8601 duration helper (also used by future security.txt generator)
# ---------------------------------------------------------------------------

def parse_iso8601_duration(value: str) -> timedelta:
    """Parse a (subset of) ISO 8601 duration string into a ``timedelta``.

    Accepts forms like ``P30D``, ``PT12H``, ``P1DT6H30M``. Years and months
    are intentionally rejected because they are calendar-dependent and the
    only documented use case (the ``Expires:`` field in ``security.txt``)
    needs an exact offset.
    """
    if not isinstance(value, str):
        raise ValueError(f"duration must be a string, got {type(value).__name__}")
    if "Y" in value or value.startswith("P") and "M" in value.split("T", 1)[0]:
        # Reject calendar-month / year forms so callers get a clean error.
        raise ValueError(
            f"calendar-month/year ISO 8601 durations are not supported: {value!r}"
        )
    m = _ISO8601_DURATION_RE.match(value)
    if not m:
        raise ValueError(f"invalid ISO 8601 duration: {value!r}")
    parts = {k: int(v) for k, v in m.groupdict().items() if v}
    if not parts:
        raise ValueError(f"empty ISO 8601 duration: {value!r}")
    return timedelta(
        days=parts.get("days", 0),
        hours=parts.get("hours", 0),
        minutes=parts.get("minutes", 0),
        seconds=parts.get("seconds", 0),
    )


def resolve_duration_to_timestamp(
    value: str, *, now: datetime | None = None
) -> str:
    """Convert an ISO 8601 duration into an absolute UTC timestamp string.

    The returned format is ``YYYY-MM-DDTHH:MM:SSZ`` (RFC 3339, no
    fractional seconds) which is what ``security.txt`` and most other
    consumers want.
    """
    base = now or datetime.now(timezone.utc)
    delta = parse_iso8601_duration(value)
    return (base + delta).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Line-number lookup (round-trip YAML preserves these on CommentedMap.lc)
# ---------------------------------------------------------------------------

def _line_for_path(data: Any, path: Sequence[Any]) -> int | None:
    """Walk ``data`` along ``path`` and return the 1-indexed source line.

    Returns the line of the most-specific node we can resolve. Falls back to
    the deepest parent we could enter when an intermediate key is missing.
    """
    node = data
    line: int | None = None
    for key in path:
        lc = getattr(node, "lc", None)
        if lc is not None and getattr(lc, "data", None):
            entry = lc.data.get(key) if isinstance(lc.data, dict) else None
            if entry is not None:
                # ruamel format: (key_line, key_col, value_line, value_col)
                line = entry[0] + 1
        try:
            node = node[key]
        except (KeyError, IndexError, TypeError):
            break
    return line


# ---------------------------------------------------------------------------
# Env interpolation
# ---------------------------------------------------------------------------

def _interpolate(
    node: Any,
    *,
    errors: list[str],
    source_path: Path,
) -> Any:
    """Walk the structure, substituting ${{ env.NAME }} placeholders.

    Missing env vars emit ``::error::`` annotations and append to
    ``errors`` (caller decides whether to raise).
    """
    if isinstance(node, str):
        def _sub(m: re.Match[str]) -> str:
            name = m.group(1)
            try:
                return os.environ[name]
            except KeyError:
                msg = f"missing env var referenced by config: {name}"
                ann.error(msg, file=str(source_path))
                errors.append(msg)
                return m.group(0)

        return _ENV_INTERP_RE.sub(_sub, node)
    if isinstance(node, dict):
        return {k: _interpolate(v, errors=errors, source_path=source_path)
                for k, v in node.items()}
    if isinstance(node, list):
        return [_interpolate(v, errors=errors, source_path=source_path)
                for v in node]
    return node


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def load(config_path: Path) -> Config:
    """Load, validate and resolve the YAML config at ``config_path``."""
    config_path = Path(config_path)
    errors: list[str] = []

    # ---- read YAML ------------------------------------------------------
    if not config_path.exists():
        msg = f"config file not found: {config_path}"
        ann.error(msg, file=str(config_path))
        raise ConfigError([msg])

    # Round-trip mode preserves ``.lc`` metadata (line/column) on every
    # ``CommentedMap`` and ``CommentedSeq`` node — needed for line-numbered
    # workflow annotations.
    yaml = YAML(typ="rt")
    try:
        with config_path.open("r", encoding="utf-8") as fh:
            raw = yaml.load(fh)
    except Exception as exc:  # noqa: BLE001 - any parse error is fatal here
        msg = f"YAML parse error: {exc}"
        ann.error(msg, file=str(config_path))
        raise ConfigError([msg]) from exc

    if raw is None:
        msg = "config file is empty"
        ann.error(msg, file=str(config_path))
        raise ConfigError([msg])

    if not isinstance(raw, dict):
        msg = f"config root must be a mapping, got {type(raw).__name__}"
        ann.error(msg, file=str(config_path))
        raise ConfigError([msg])

    # ---- env interpolation ---------------------------------------------
    # Done BEFORE schema validation so a placeholder like
    # ``deploy: ${{ env.MODE }}`` doesn't trip the enum check.
    interpolated = _interpolate(raw, errors=errors, source_path=config_path)

    # ---- schema validation ---------------------------------------------
    schema = _load_schema()
    validator = Draft202012Validator(schema)
    for verr in sorted(validator.iter_errors(interpolated), key=lambda e: e.path):
        loc = "/".join(str(p) for p in verr.absolute_path) or "<root>"
        line = _line_for_path(raw, list(verr.absolute_path))
        msg = f"schema: {loc}: {verr.message}"
        ann.error(msg, file=str(config_path), line=line)
        errors.append(msg)

    if errors:
        raise ConfigError(errors)

    # ---- defaults + projection -----------------------------------------
    version = int(interpolated["version"])
    output_dir = Path(interpolated.get("output_dir", _DEFAULT_OUTPUT_DIR))
    deploy_raw = interpolated.get("deploy")
    deploy: DeployMode | None = deploy_raw if deploy_raw else None
    resources = dict(interpolated.get("resources") or {})
    custom = list(interpolated.get("custom") or [])
    worker_endpoint = interpolated.get("worker_endpoint")

    return Config(
        version=version,
        output_dir=output_dir,
        deploy=deploy,
        resources=resources,
        custom=custom,
        source_path=config_path,
        worker_endpoint=worker_endpoint,
    )
