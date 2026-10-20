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


def test_message_escapes_percent_cr_lf() -> None:
    """GitHub's workflow-command data encoding: % -> %25, CR -> %0D, LF -> %0A."""
    buf = io.StringIO()
    ann.error("100% sure\r\nnext", stream=buf)
    assert buf.getvalue() == "::error::100%25 sure%0D%0Anext\n"


def test_message_newline_cannot_inject_a_command() -> None:
    buf = io.StringIO()
    ann.warning("bad value\n::add-mask::x\n::stop-commands::tok", stream=buf)
    out = buf.getvalue()
    assert out.count("\n") == 1
    assert out.startswith("::warning::bad value%0A::add-mask::x%0A")


def test_properties_escape_comma_colon_percent_and_newlines() -> None:
    buf = io.StringIO()
    ann.error("m", file="dir,x/a:b%c\nd.yaml", stream=buf)
    assert buf.getvalue() == "::error file=dir%2Cx/a%3Ab%25c%0Ad.yaml::m\n"
