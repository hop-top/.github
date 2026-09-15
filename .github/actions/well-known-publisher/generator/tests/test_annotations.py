"""Workflow command emitter tests."""

from __future__ import annotations

import io

from well_known_publisher import annotations as ann


def test_error_basic() -> None:
    buf = io.StringIO()
    ann.error("boom", stream=buf)
    assert buf.getvalue() == "::error::boom\n"


def test_error_with_file_line_col() -> None:
    buf = io.StringIO()
    ann.error("nope", file="x.yaml", line=12, col=4, stream=buf)
    assert buf.getvalue() == "::error file=x.yaml,line=12,col=4::nope\n"


def test_warning_with_file_only() -> None:
    buf = io.StringIO()
    ann.warning("careful", file="x.yaml", stream=buf)
    assert buf.getvalue() == "::warning file=x.yaml::careful\n"


def test_notice_plain() -> None:
    buf = io.StringIO()
    ann.notice("fyi", stream=buf)
    assert buf.getvalue() == "::notice::fyi\n"
