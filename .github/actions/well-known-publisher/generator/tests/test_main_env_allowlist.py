"""``--env-allowlist`` reaches the loader through the CLI."""

from __future__ import annotations

from pathlib import Path

import pytest

from well_known_publisher.__main__ import main


def _setup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "gh-output"))
    monkeypatch.setenv("WHO", "world")
    cfg = tmp_path / "wk.yaml"
    cfg.write_text(
        "version: 1\n"
        "resources: {}\n"
        "custom:\n"
        "  - path: .well-known/hello.txt\n"
        "    body: 'hello ${{ env.WHO }}'\n",
        encoding="utf-8",
    )
    return cfg, tmp_path / "out"


def test_allowlisted_var_is_interpolated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cfg, out = _setup(tmp_path, monkeypatch)
    rc = main(
        ["--config", str(cfg), "--output-dir", str(out), "--env-allowlist", "WHO"]
    )
    assert rc == 0
    assert (out / "hello.txt").read_text(encoding="utf-8") == "hello world"


def test_var_missing_from_allowlist_fails_without_writing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cfg, out = _setup(tmp_path, monkeypatch)
    assert main(["--config", str(cfg), "--output-dir", str(out)]) == 2
    assert not (out / "hello.txt").exists()


def test_invalid_allowlist_entry_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cfg, out = _setup(tmp_path, monkeypatch)
    rc = main(
        [
            "--config", str(cfg),
            "--output-dir", str(out),
            "--env-allowlist", "WHO,not-a-name",
        ]
    )
    assert rc == 2
    assert not (out / "hello.txt").exists()
