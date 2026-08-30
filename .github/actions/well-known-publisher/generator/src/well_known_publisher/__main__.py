"""CLI entrypoint: ``python -m well_known_publisher --config ... --output-dir ...``.

Loads the config, runs every registered generator whose key appears under
``resources:``, writes any ``custom:`` entries verbatim, then emits
``files_written`` and ``manifest`` outputs to ``$GITHUB_OUTPUT``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from pathlib import Path

from . import annotations as ann
from .loader import Config, ConfigError, load
from .registry import GeneratorFn, GeneratorResult, discover


def _write_github_output(name: str, value: str) -> None:
    """Write ``name=value`` (multiline aware) to ``$GITHUB_OUTPUT``.

    Falls back to stdout when the env var is unset (local dev / unit
    tests).
    """
    payload: str
    if "\n" in value:
        # GitHub heredoc form so multi-line values survive intact.
        delim = f"ghadelim_{uuid.uuid4().hex}"
        payload = f"{name}<<{delim}\n{value}\n{delim}\n"
    else:
        payload = f"{name}={value}\n"

    target = os.environ.get("GITHUB_OUTPUT")
    if target:
        with open(target, "a", encoding="utf-8") as fh:
            fh.write(payload)
    else:
        sys.stdout.write(f"[github-output] {payload}")


def _write_custom_entries(custom: list[dict], out_dir: Path) -> list[Path]:
    """Write each ``custom:`` entry; return the list of written paths."""
    written: list[Path] = []
    for entry in custom:
        rel = entry["path"]
        # Schema enforces "^\.well-known/" — strip the prefix so the file
        # lands directly inside the configured output dir.
        rel_stripped = rel[len(".well-known/"):]
        dest = out_dir / rel_stripped
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(entry["body"], encoding="utf-8")
        written.append(dest)
    return written


def _run_generators(
    cfg: Config,
    out_dir: Path,
    generators: dict[str, GeneratorFn],
) -> tuple[list[Path], list[dict]]:
    files: list[Path] = []
    manifest: list[dict] = []
    for name, sub_cfg in cfg.resources.items():
        sub_cfg = sub_cfg or {}
        if not sub_cfg.get("enabled", True):
            continue
        fn = generators.get(name)
        if fn is None:
            ann.warning(
                f"no generator registered for resource {name!r}; skipping",
                file=str(cfg.source_path),
            )
            manifest.append(
                {"generator": name, "files": [], "warnings": 1, "skipped": True}
            )
            continue
        result: GeneratorResult = fn(sub_cfg, out_dir)
        produced = [Path(p) for p in result.files]
        files.extend(produced)
        manifest.append(
            {
                "generator": name,
                "files": [str(p) for p in produced],
                "warnings": int(result.warnings),
            }
        )
    return files, manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="well-known-publisher")
    parser.add_argument("--config", required=True, type=Path)
    # --output-dir is OPTIONAL so the config's ``output_dir`` (or the
    # schema default) can win when the caller omits the flag. Precedence:
    # CLI flag > config value > schema/Config default (``dist/.well-known``).
    parser.add_argument("--output-dir", default=None, type=Path)
    args = parser.parse_args(argv)

    try:
        cfg = load(args.config)
    except ConfigError as exc:
        # Errors already surfaced as ::error:: annotations inside load().
        sys.stderr.write(str(exc) + "\n")
        return 2

    out_dir: Path = args.output_dir or cfg.output_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    generators = discover()

    try:
        gen_files, manifest = _run_generators(cfg, out_dir, generators)
        custom_files = _write_custom_entries(list(cfg.custom), out_dir)
    except Exception as exc:  # noqa: BLE001 - surface anything to the action
        ann.error(
            f"generator failure: {exc}",
            file=str(cfg.source_path),
        )
        return 3

    all_files = [*gen_files, *custom_files]
    if custom_files:
        manifest.append(
            {
                "generator": "custom",
                "files": [str(p) for p in custom_files],
                "warnings": 0,
            }
        )

    _write_github_output("files_written", "\n".join(str(p) for p in all_files))
    _write_github_output("manifest", json.dumps(manifest, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
