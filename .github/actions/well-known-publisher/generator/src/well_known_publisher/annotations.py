"""GitHub Actions workflow command emitters.

Format reference:
https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message

Messages and property values are percent-encoded the way the runner
decodes them (``%`` -> ``%25``, CR -> ``%0D``, LF -> ``%0A``; properties
also ``:`` -> ``%3A`` and ``,`` -> ``%2C``), so a value containing a newline
cannot start a second workflow command.
"""

from __future__ import annotations

import sys
from typing import IO


def _escape_data(value: str) -> str:
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def _escape_property(value: str) -> str:
    return _escape_data(value).replace(":", "%3A").replace(",", "%2C")


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
        parts.append(f"file={_escape_property(file)}")
    if line is not None:
        parts.append(f"line={int(line)}")
    if col is not None:
        parts.append(f"col={int(col)}")
    head = f"::{level}"
    if parts:
        head += " " + ",".join(parts)
    head += "::"
    out = stream if stream is not None else sys.stdout
    out.write(head + _escape_data(msg) + "\n")
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
