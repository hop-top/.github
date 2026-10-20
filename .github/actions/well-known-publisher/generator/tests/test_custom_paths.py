"""``custom[].path`` must never write outside the output directory."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from well_known_publisher.__main__ import _write_custom_entries, main
from well_known_publisher.loader import ConfigError, load


def _write_config(tmp_path: Path, path_value: str) -> Path:
    cfg = tmp_path / "wk.yaml"
    cfg.write_text(
        "version: 1\n"
        "resources: {}\n"
        "custom:\n"
        # JSON strings are valid YAML double-quoted scalars (escapes intact).
        f"  - path: {json.dumps(path_value)}\n"
        "    body: pwned\n",
        encoding="utf-8",
    )
    return cfg


@pytest.mark.parametrize(
    "path_value",
    [
        ".well-known/../../escaped.txt",
        ".well-known//tmp/x",
        ".well-known/a/../../b",
        ".well-known/./x",
        ".well-known/..",
        ".well-known/",
        ".well-known/a/",
        ".well-known/a//b",
        ".well-known/a\\..\\..\\b",
        ".well-known/a\nb",
        ".well-known/a\n",
    ],
)
def test_schema_rejects_unsafe_custom_path(tmp_path: Path, path_value: str) -> None:
    with pytest.raises(ConfigError) as excinfo:
        load(_write_config(tmp_path, path_value))
    assert any("custom/0/path" in e for e in excinfo.value.errors)


@pytest.mark.parametrize(
    "path_value",
    [
        ".well-known/security.txt",
        ".well-known/nested/dir/file.json",
        ".well-known/.hidden",
        ".well-known/..dots-in-name",
    ],
)
def test_schema_accepts_safe_custom_path(tmp_path: Path, path_value: str) -> None:
    cfg = load(_write_config(tmp_path, path_value))
    assert cfg.custom[0]["path"] == path_value


@pytest.mark.parametrize(
    "path_value",
    [
        ".well-known/./x",
        ".well-known/a//b",
        ".well-known/a/",
        ".well-known/a\\b",
        ".well-known/a\nb",
        "elsewhere/x",
    ],
)
def test_writer_rejects_unsafe_segments(tmp_path: Path, path_value: str) -> None:
    """The writer re-checks segments even when the schema was bypassed."""
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    with pytest.raises(ValueError, match="custom path"):
        _write_custom_entries([{"path": path_value, "body": "x"}], out_dir)
    assert list(out_dir.iterdir()) == []


def test_dotdot_escape_never_written(tmp_path: Path) -> None:
    out_dir = tmp_path / "a" / "out"
    out_dir.mkdir(parents=True)
    with pytest.raises(ValueError, match="custom path"):
        _write_custom_entries(
            [{"path": ".well-known/../../escaped.txt", "body": "pwned"}], out_dir
        )
    assert not (tmp_path / "escaped.txt").exists()


def test_absolute_segment_never_written(tmp_path: Path) -> None:
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    target = tmp_path / "abs-target.txt"
    with pytest.raises(ValueError, match="custom path"):
        _write_custom_entries(
            [{"path": f".well-known/{target}", "body": "pwned"}], out_dir
        )
    assert not target.exists()


def test_symlinked_dir_escape_never_written(tmp_path: Path) -> None:
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    os.symlink(outside, out_dir / "link")
    with pytest.raises(ValueError, match="outside the output directory"):
        _write_custom_entries(
            [{"path": ".well-known/link/x.txt", "body": "pwned"}], out_dir
        )
    assert not (outside / "x.txt").exists()


def test_no_entry_written_when_any_path_is_unsafe(tmp_path: Path) -> None:
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    with pytest.raises(ValueError):
        _write_custom_entries(
            [
                {"path": ".well-known/ok.txt", "body": "fine"},
                {"path": ".well-known/../escaped.txt", "body": "pwned"},
            ],
            out_dir,
        )
    assert not (out_dir / "ok.txt").exists()
    assert not (tmp_path / "escaped.txt").exists()


def test_safe_entries_land_inside_output_dir(tmp_path: Path) -> None:
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    written = _write_custom_entries(
        [{"path": ".well-known/nested/ok.txt", "body": "fine"}], out_dir
    )
    assert written == [out_dir / "nested" / "ok.txt"]
    assert (out_dir / "nested" / "ok.txt").read_text(encoding="utf-8") == "fine"


def test_main_refuses_escape_and_writes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "gh-output"))
    cfg = _write_config(tmp_path, ".well-known/../../escaped.txt")
    out_dir = tmp_path / "a" / "out"
    assert main(["--config", str(cfg), "--output-dir", str(out_dir)]) != 0
    assert not (tmp_path / "escaped.txt").exists()
