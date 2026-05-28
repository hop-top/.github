"""GitHub Actions workflow command emitters.

Format reference:
https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message
"""

from __future__ import annotations

import sys
from typing import IO


def _emit(
    level: str,
    msg: str,
    *,
    file: str | None = None,
    line: int | None = None,
    col: int | None = None,
    stream: IO[str] | None = None,
) -> None:
    parts: list[str] = []
    if file is not None:
        parts.append(f"file={file}")
    if line is not None:
        parts.append(f"line={line}")
    if col is not None:
        parts.append(f"col={col}")
    head = f"::{level}"
    if parts:
        head += " " + ",".join(parts)
    head += "::"
    out = stream if stream is not None else sys.stdout
    out.write(head + msg + "\n")
    out.flush()


def error(
    msg: str,
    *,
    file: str | None = None,
    line: int | None = None,
    col: int | None = None,
    stream: IO[str] | None = None,
) -> None:
    """Emit an ::error:: annotation."""
    _emit("error", msg, file=file, line=line, col=col, stream=stream)


def warning(
    msg: str,
    *,
    file: str | None = None,
    line: int | None = None,
    col: int | None = None,
    stream: IO[str] | None = None,
) -> None:
    """Emit a ::warning:: annotation."""
    _emit("warning", msg, file=file, line=line, col=col, stream=stream)


def notice(
    msg: str,
    *,
    file: str | None = None,
    line: int | None = None,
    col: int | None = None,
    stream: IO[str] | None = None,
) -> None:
    """Emit a ::notice:: annotation."""
    _emit("notice", msg, file=file, line=line, col=col, stream=stream)
