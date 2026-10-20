"""Every reusable workflow that mints the release-bot App token.

actions/create-github-app-token deprecated its `app-id` input in favour of
`client-id` (v3.1.0). The action reads either input into the same value,
the issuer of the JWT it signs, and GitHub accepts an App ID as well as a
Client ID there. So the workflows pass the callers' RELEASE_BOT_APP_ID
secret to `client-id`: no deprecation warning, no caller change, the
secret contract stays as it is.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
ACTION = "actions/create-github-app-token@"
MINTING = {"goreleaser-on-tag.yml", "release-please-on-push.yml",
           "release-tag-on-merge.yml", "spec-status-line.yml"}


def token_steps(text: str) -> list[tuple[str, str]]:
    """(ref, step text) of each step using create-github-app-token."""
    lines = text.splitlines()
    steps = []
    for i, line in enumerate(lines):
        m = re.match(rf"^\s*(?:- )?uses: {re.escape(ACTION)}(\S+)", line)
        if not m:
            continue
        start = next(j for j in range(i, -1, -1) if re.match(r"^\s*- ", lines[j]))
        indent = len(lines[start]) - len(lines[start].lstrip())
        end = next((j for j in range(start + 1, len(lines))
                    if lines[j].strip() and len(lines[j]) - len(lines[j].lstrip()) <= indent),
                   len(lines))
        steps.append((m.group(1), "\n".join(lines[start:end])))
    return steps


class ReleaseBotTokenTests(unittest.TestCase):
    def test_the_minting_workflows_are_the_known_ones(self) -> None:
        # A new minting workflow joins MINTING and so the checks below.
        found = {p.name for p in WORKFLOWS.glob("*.yml") if ACTION in p.read_text(encoding="utf-8")}
        self.assertEqual(found, MINTING)

    def test_client_id_carries_the_app_id_secret(self) -> None:
        for name in sorted(MINTING):
            steps = token_steps((WORKFLOWS / name).read_text(encoding="utf-8"))
            self.assertTrue(steps, name)
            for ref, step in steps:
                with self.subTest(workflow=name):
                    self.assertRegex(step, r"(?m)^\s*client-id: \$\{\{ secrets\.RELEASE_BOT_APP_ID \}\}$")
                    self.assertRegex(step, r"(?m)^\s*private-key: \$\{\{ secrets\.RELEASE_BOT_PRIVATE_KEY \}\}$")
                    self.assertNotRegex(step, r"(?m)^\s*app-id:")

    def test_action_version_has_client_id(self) -> None:
        # client-id exists from v3.1.0; the floating v3 tag carries it.
        for name in sorted(MINTING):
            for ref, _ in token_steps((WORKFLOWS / name).read_text(encoding="utf-8")):
                with self.subTest(workflow=name, ref=ref):
                    m = re.fullmatch(r"v(\d+)(?:\.(\d+))?(?:\.(\d+))?", ref)
                    self.assertIsNotNone(m, "pin a version tag")
                    major, minor = int(m.group(1)), int(m.group(2) or 0)
                    floating = m.group(2) is None
                    self.assertTrue(major > 3 or (major == 3 and (floating or minor >= 1)), ref)

    def test_callers_keep_their_secret_names(self) -> None:
        for name in sorted(MINTING):
            text = (WORKFLOWS / name).read_text(encoding="utf-8")
            secrets = text[text.index("    secrets:\n"):]
            for secret in ("RELEASE_BOT_APP_ID", "RELEASE_BOT_PRIVATE_KEY"):
                with self.subTest(workflow=name, secret=secret):
                    block = re.search(rf"(?ms)^      {secret}:\n(.*?)(?=^      \S|^\S|\Z)", secrets)
                    self.assertIsNotNone(block)
                    self.assertIn("required: true", block.group(1))


if __name__ == "__main__":
    unittest.main()
