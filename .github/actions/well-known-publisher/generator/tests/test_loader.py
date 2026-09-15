"""Loader unit tests."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from well_known_publisher.loader import (
    Config,
    ConfigError,
    load,
    parse_iso8601_duration,
    resolve_duration_to_timestamp,
)

FIXTURES = Path(__file__).parent / "fixtures"


def test_config_has_no_extras_field() -> None:
    """Schema's ``additionalProperties: false`` makes ``extras`` dead — drop it."""
    assert "extras" not in Config.__dataclass_fields__


def test_valid_minimal_loads_with_defaults() -> None:
    cfg = load(FIXTURES / "valid_minimal.yaml")
    assert isinstance(cfg, Config)
    assert cfg.version == 1
    assert cfg.output_dir == Path("dist/.well-known")
    assert cfg.deploy is None
    assert cfg.resources == {}
    assert list(cfg.custom) == []
    assert cfg.source_path == FIXTURES / "valid_minimal.yaml"


def test_env_interpolation_substitutes_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OUT", "build/wk")
    monkeypatch.setenv("WHO", "world")
    cfg = load(FIXTURES / "valid_with_env_interp.yaml")
    assert cfg.output_dir == Path("build/wk")
    assert len(cfg.custom) == 1
    entry = cfg.custom[0]
    assert "hello world" in entry["body"]
    assert entry["path"] == ".well-known/hello.txt"


def test_env_interpolation_missing_var_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OUT", raising=False)
    monkeypatch.delenv("WHO", raising=False)
    with pytest.raises(ConfigError) as excinfo:
        load(FIXTURES / "valid_with_env_interp.yaml")
    # Both placeholders missing → two distinct errors collected.
    assert any("OUT" in e for e in excinfo.value.errors)
    assert any("WHO" in e for e in excinfo.value.errors)


def test_missing_version_collects_single_schema_error() -> None:
    with pytest.raises(ConfigError) as excinfo:
        load(FIXTURES / "invalid_missing_version.yaml")
    assert len(excinfo.value.errors) == 1
    assert "version" in excinfo.value.errors[0]


def test_unknown_resource_key_rejected() -> None:
    with pytest.raises(ConfigError) as excinfo:
        load(FIXTURES / "invalid_bad_resource_key.yaml")
    # additionalProperties: false on `resources` rejects the `foo` key.
    joined = " | ".join(excinfo.value.errors)
    assert "foo" in joined or "additional" in joined.lower()


def test_missing_config_file_raises(tmp_path: Path) -> None:
    with pytest.raises(ConfigError) as excinfo:
        load(tmp_path / "nope.yaml")
    assert "not found" in excinfo.value.errors[0]


def test_iso8601_duration_basic_days() -> None:
    td = parse_iso8601_duration("P30D")
    assert td.days == 30


def test_iso8601_duration_compound() -> None:
    td = parse_iso8601_duration("P1DT6H30M")
    assert td.days == 1
    assert td.seconds == 6 * 3600 + 30 * 60


def test_iso8601_duration_rejects_year_month() -> None:
    with pytest.raises(ValueError):
        parse_iso8601_duration("P1Y")
    with pytest.raises(ValueError):
        parse_iso8601_duration("P2M")


def test_iso8601_duration_rejects_garbage() -> None:
    with pytest.raises(ValueError):
        parse_iso8601_duration("not-a-duration")
    with pytest.raises(ValueError):
        parse_iso8601_duration("P")


def test_resolve_duration_to_timestamp_format() -> None:
    base = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    out = resolve_duration_to_timestamp("P30D", now=base)
    assert out == "2026-01-31T00:00:00Z"


def test_schema_error_annotation_includes_line_number(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Round-trip YAML parse + ``_line_for_path`` should surface ``line=N``.

    ``invalid_bad_deploy_enum.yaml`` puts ``deploy: nope`` on line 2 — the
    enum violation MUST emit an annotation whose payload contains
    ``line=2``.
    """
    with pytest.raises(ConfigError):
        load(FIXTURES / "invalid_bad_deploy_enum.yaml")
    out = capsys.readouterr().out
    assert "line=2" in out, f"expected 'line=2' in annotations, got: {out!r}"
    assert "deploy" in out


def test_env_interp_substitutes_inside_custom_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Lock in: env interp DOES rewrite ``${{ env.X }}`` inside custom bodies.

    There is no literal-escape mechanism today (see README WARNING). This
    test pins that behaviour so a future change is forced to update the
    docs alongside the code.
    """
    monkeypatch.setenv("GITHUB_SHA", "abc123")
    cfg = load(FIXTURES / "valid_env_interp_in_custom_body.yaml")
    assert len(cfg.custom) == 1
    body = cfg.custom[0]["body"]
    assert "abc123" in body
    assert "${{ env.GITHUB_SHA }}" not in body


def test_output_dir_from_config_when_cli_omits(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """When ``--output-dir`` is omitted, the config's ``output_dir`` MUST win."""
    cfg_file = tmp_path / "wk.yaml"
    cfg_file.write_text(
        "version: 1\n"
        "output_dir: from-config/out\n"
        "resources: {}\n",
        encoding="utf-8",
    )
    cfg = load(cfg_file)
    assert cfg.output_dir == Path("from-config/out")


def test_version_two_rejected_by_schema() -> None:
    """``version`` is a ``const: 1`` — anything else MUST fail validation."""
    with pytest.raises(ConfigError) as excinfo:
        load(FIXTURES / "invalid_version_two.yaml")
    joined = " | ".join(excinfo.value.errors)
    assert "version" in joined
    # ``const`` violations from jsonschema mention either "const" or the
    # expected value (1).
    assert "1" in joined or "const" in joined.lower()
