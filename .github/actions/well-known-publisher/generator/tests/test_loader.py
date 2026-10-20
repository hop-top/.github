"""Loader unit tests."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from well_known_publisher.loader import (
    Config,
    ConfigError,
    load,
    parse_env_allowlist,
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
    cfg = load(FIXTURES / "valid_with_env_interp.yaml", env_allowlist={"OUT", "WHO"})
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
        load(FIXTURES / "valid_with_env_interp.yaml", env_allowlist={"OUT", "WHO"})
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
    """Unescaped ``${{ env.X }}`` inside a custom body IS substituted."""
    monkeypatch.setenv("GITHUB_SHA", "abc123")
    cfg = load(
        FIXTURES / "valid_env_interp_in_custom_body.yaml",
        env_allowlist={"GITHUB_SHA"},
    )
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


def test_escaped_placeholder_is_emitted_literally(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``$${{ ... }}`` drops one ``$`` and skips interpolation."""
    monkeypatch.setenv("GITHUB_SHA", "abc123")
    cfg = load(FIXTURES / "valid_escaped_placeholder.yaml", env_allowlist={"GITHUB_SHA"})
    assert cfg.custom[0]["body"] == (
        "env: ${{ env.GITHUB_SHA }}\n"
        "expr: ${{ github.sha }}\n"
        "both: ${{ env.GITHUB_SHA }} vs abc123\n"
    )


def test_escaped_placeholder_needs_no_env_var(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """An escaped placeholder never looks the variable up."""
    monkeypatch.delenv("NOT_SET_ANYWHERE", raising=False)
    cfg_file = tmp_path / "wk.yaml"
    cfg_file.write_text(
        "version: 1\n"
        "resources: {}\n"
        "custom:\n"
        "  - path: .well-known/a.txt\n"
        "    body: 'x $${{ env.NOT_SET_ANYWHERE }} y'\n",
        encoding="utf-8",
    )
    cfg = load(cfg_file)
    assert cfg.custom[0]["body"] == "x ${{ env.NOT_SET_ANYWHERE }} y"


# ---------------------------------------------------------------------------
# Env allowlist
# ---------------------------------------------------------------------------


def test_default_allowlist_interpolates_nothing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """With no allowlist, every placeholder fails, even for set variables."""
    monkeypatch.setenv("OUT", "build/wk")
    monkeypatch.setenv("WHO", "world")
    with pytest.raises(ConfigError) as excinfo:
        load(FIXTURES / "valid_with_env_interp.yaml")
    joined = " | ".join(excinfo.value.errors)
    assert "OUT" in joined and "WHO" in joined
    assert "env-allowlist input" in joined
    assert "build/wk" not in joined and "world" not in joined
    assert "build/wk" not in capsys.readouterr().out


def test_secret_outside_allowlist_never_published(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("SOME_TOKEN", "hunter2")
    monkeypatch.setenv("WHO", "world")
    cfg_file = tmp_path / "wk.yaml"
    cfg_file.write_text(
        "version: 1\n"
        "resources: {}\n"
        "custom:\n"
        "  - path: .well-known/leak.txt\n"
        "    body: 'token=${{ env.SOME_TOKEN }} who=${{ env.WHO }}'\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigError) as excinfo:
        load(cfg_file, env_allowlist={"WHO"})
    assert len(excinfo.value.errors) == 1
    assert "SOME_TOKEN" in excinfo.value.errors[0]
    assert "hunter2" not in excinfo.value.errors[0]
    assert "hunter2" not in capsys.readouterr().out


def test_env_errors_carry_line_numbers(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """``output_dir`` sits on line 2, the ``body`` key on line 7."""
    monkeypatch.delenv("WHO", raising=False)
    monkeypatch.setenv("OUT", "build/wk")
    with pytest.raises(ConfigError):
        load(FIXTURES / "valid_with_env_interp.yaml", env_allowlist={"WHO"})
    lines = capsys.readouterr().out.splitlines()
    out_err = [ln for ln in lines if "OUT" in ln]
    who_err = [ln for ln in lines if "WHO" in ln]
    assert out_err and "line=2" in out_err[0], lines
    assert who_err and "line=7" in who_err[0], lines


def test_parse_env_allowlist_accepts_commas_and_newlines() -> None:
    assert parse_env_allowlist("A, B\nC_1\n\n  ,D ") == frozenset(
        {"A", "B", "C_1", "D"}
    )
    assert parse_env_allowlist("") == frozenset()
    assert parse_env_allowlist(None) == frozenset()


@pytest.mark.parametrize("bad", ["BAD-NAME", "1ABC", "A.B", "${{ env.X }}"])
def test_parse_env_allowlist_rejects_invalid_names(bad: str) -> None:
    with pytest.raises(ValueError, match="env allowlist"):
        parse_env_allowlist(f"OK,{bad}")
