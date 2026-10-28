"""Tests for mirror-subtree.yml.

The `Resolve target repo and refuse self-mirror` step's `run:` block is
lifted out of the workflow verbatim and run with bash, `gh` shimmed to
answer `gh api repos/<slug> --jq .full_name` the way GitHub does: the
canonical name (following a rename redirect), or a 404.

The incident this guards: `hop-top/nerv` was a rename redirect to the
source repo `hop-top/poly-nerv`. The string-only self-mirror check let it
through, and the push would have force-replaced the source repo's main.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

from test_release_please_preflight import step_script

WORKFLOW = (Path(__file__).resolve().parents[2]
            / ".github" / "workflows" / "mirror-subtree.yml")
RESOLVE = "Resolve target repo and refuse self-mirror"
CHECK_MODE = "Check mode inputs"
TAG_ONLY = "Tag nested module on existing mirror"
MIRROR_ONLY_STEPS = ("Ensure mirror repository exists", "Make mirror writable for sync",
                     "Split subtree and push", "Create release on mirror",
                     "Restore mirror read-only")
SOURCE = "hop-top/poly-nerv"

# `gh api repos/<slug> --jq .full_name`: FAKE_GH_REPOS maps lowercase slug
# -> canonical full_name (a redirect maps an old slug to the new name).
# Anything else is a 404, or FAKE_GH_FAIL forces a non-404 error.
GH_SHIM = r"""#!/bin/sh
echo "$*" >> "$FAKE_GH_LOG"
if [ -n "$FAKE_GH_FAIL" ]; then
  echo "gh: Bad credentials (HTTP 401)" >&2
  exit 1
fi
slug=$(printf '%s' "$2" | sed 's#^repos/##' | tr '[:upper:]' '[:lower:]')
for pair in $FAKE_GH_REPOS; do
  if [ "${pair%%=*}" = "$slug" ]; then
    printf '%s\n' "${pair#*=}"
    exit 0
  fi
done
echo "gh: Not Found (HTTP 404)" >&2
exit 1
"""


class ResolveTargetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="mirror-subtree-"))
        shims = self.tmp / "bin"
        shims.mkdir()
        gh = shims / "gh"
        gh.write_text(GH_SHIM, encoding="utf-8")
        gh.chmod(0o755)
        self.path = f"{shims}{os.pathsep}{os.environ['PATH']}"
        self.script = self.tmp / "step.sh"
        self.script.write_text(step_script(WORKFLOW, RESOLVE), encoding="utf-8")
        self.env_file = self.tmp / "env"
        self.output = self.tmp / "output"
        self.log = self.tmp / "gh.log"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_step(self, target: str, repos: dict[str, str], allow: str = "false",
                 fail: bool = False, mode: str = "mirror") -> tuple[int, str, str, str]:
        for f in (self.env_file, self.output, self.log):
            f.write_text("", encoding="utf-8")
        env = {
            "PATH": self.path,
            "HOME": str(self.tmp),
            "TARGET": target,
            "GITHUB_REPOSITORY": SOURCE,
            "ALLOW_REDIRECT": allow,
            "MODE": mode,
            "GITHUB_ENV": str(self.env_file),
            "GITHUB_OUTPUT": str(self.output),
            "FAKE_GH_REPOS": " ".join(f"{k.lower()}={v}" for k, v in repos.items()),
            "FAKE_GH_LOG": str(self.log),
            "FAKE_GH_FAIL": "1" if fail else "",
        }
        r = subprocess.run(["bash", "-eo", "pipefail", str(self.script)], cwd=self.tmp, env=env,
                           capture_output=True, text=True)
        return (r.returncode, r.stdout + r.stderr,
                self.env_file.read_text(encoding="utf-8"),
                self.output.read_text(encoding="utf-8"))

    def test_plain_mirror_resolves_to_itself(self) -> None:
        code, out, env, outputs = self.run_step("hop-top/nerv-ts", {"hop-top/nerv-ts": "hop-top/nerv-ts"})
        self.assertEqual(code, 0, out)
        self.assertEqual(env, "MIRROR_REPO=hop-top/nerv-ts\n")
        self.assertEqual(outputs, "repo=hop-top/nerv-ts\n")

    def test_case_only_difference_is_not_a_redirect(self) -> None:
        code, out, env, _ = self.run_step("Hop-Top/Nerv-TS", {"hop-top/nerv-ts": "hop-top/nerv-ts"})
        self.assertEqual(code, 0, out)
        self.assertEqual(env, "MIRROR_REPO=hop-top/nerv-ts\n")

    def test_rename_redirect_to_the_source_repo_is_refused(self) -> None:
        # The incident: hop-top/nerv -> hop-top/poly-nerv (this repo).
        for allow in ("false", "true"):
            with self.subTest(allow=allow):
                code, out, env, outputs = self.run_step(
                    "hop-top/nerv", {"hop-top/nerv": SOURCE, SOURCE: SOURCE}, allow=allow)
                self.assertEqual(code, 1, out)
                self.assertIn("::error::Refusing self-mirror", out)
                self.assertIn("redirects to hop-top/poly-nerv", out)
                self.assertEqual(env, "")
                self.assertEqual(outputs, "")

    def test_redirect_to_the_source_repo_in_other_case_is_refused(self) -> None:
        code, out, _, _ = self.run_step("hop-top/nerv", {"hop-top/nerv": "Hop-Top/Poly-Nerv"}, allow="true")
        self.assertEqual(code, 1, out)
        self.assertIn("::error::Refusing self-mirror", out)

    def test_literal_self_mirror_is_refused_before_any_api_call(self) -> None:
        for target in (SOURCE, "HOP-TOP/poly-nerv"):
            with self.subTest(target=target):
                code, out, env, _ = self.run_step(target, {SOURCE: SOURCE})
                self.assertEqual(code, 1, out)
                self.assertIn("::error::Refusing self-mirror", out)
                self.assertEqual(self.log.read_text(encoding="utf-8"), "")
                self.assertEqual(env, "")

    def test_redirect_elsewhere_is_refused_without_opt_in(self) -> None:
        code, out, env, outputs = self.run_step("hop-top/old-name", {"hop-top/old-name": "hop-top/new-name"})
        self.assertEqual(code, 1, out)
        self.assertIn("redirects to hop-top/new-name", out)
        self.assertIn("allow-target-redirect", out)
        self.assertEqual(env, "")
        self.assertEqual(outputs, "")

    def test_redirect_elsewhere_with_opt_in_pushes_to_the_resolved_name(self) -> None:
        code, out, env, outputs = self.run_step(
            "hop-top/old-name", {"hop-top/old-name": "hop-top/new-name"}, allow="true")
        self.assertEqual(code, 0, out)
        self.assertIn("::warning::", out)
        self.assertEqual(env, "MIRROR_REPO=hop-top/new-name\n")
        self.assertEqual(outputs, "repo=hop-top/new-name\n")

    def test_missing_mirror_keeps_the_requested_name_for_creation(self) -> None:
        code, out, env, _ = self.run_step("hop-top/brand-new", {})
        self.assertEqual(code, 0, out)
        self.assertIn("::notice::", out)
        self.assertEqual(env, "MIRROR_REPO=hop-top/brand-new\n")

    def test_tag_only_never_creates_a_missing_mirror(self) -> None:
        code, out, env, outputs = self.run_step("hop-top/brand-new", {}, mode="tag-only")
        self.assertEqual(code, 1, out)
        self.assertIn("does not exist", out)
        self.assertEqual(env, "")
        self.assertEqual(outputs, "")

    def test_tag_only_refuses_redirect_to_the_source_repo(self) -> None:
        code, out, _, _ = self.run_step("hop-top/nerv", {"hop-top/nerv": SOURCE}, mode="tag-only")
        self.assertEqual(code, 1, out)
        self.assertIn("::error::Refusing self-mirror", out)

    def test_other_api_errors_fail_closed(self) -> None:
        code, out, env, _ = self.run_step("hop-top/nerv-ts", {}, fail=True)
        self.assertEqual(code, 1, out)
        self.assertIn("Could not resolve target-repo", out)
        self.assertEqual(env, "")

    def test_the_api_lookup_uses_the_requested_slug(self) -> None:
        self.run_step("hop-top/nerv-ts", {"hop-top/nerv-ts": "hop-top/nerv-ts"})
        self.assertEqual(self.log.read_text(encoding="utf-8").split(),
                         ["api", "repos/hop-top/nerv-ts", "--jq", ".full_name"])


class WorkflowShapeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.text = WORKFLOW.read_text(encoding="utf-8")

    def test_resolve_runs_before_anything_touches_the_target(self) -> None:
        names = re.findall(r"(?m)^      - (?:name|uses): (.+)$", self.text)
        self.assertEqual(names[:2], [CHECK_MODE, RESOLVE])

    def test_later_steps_only_use_the_resolved_name(self) -> None:
        after = self.text[self.text.index("- name: Ensure mirror repository exists"):]
        self.assertNotRegex(after, r"\$\{?TARGET\b")
        self.assertIn("$MIRROR_REPO", after)

    def test_restore_step_skips_when_the_target_was_refused(self) -> None:
        restore = self.text[self.text.index("- name: Restore mirror read-only"):]
        self.assertRegex(restore, r"(?m)^\s*if: always\(\) && .*steps\.target\.outputs\.repo != ''$")

    def test_redirect_opt_in_defaults_off(self) -> None:
        block = re.search(r"(?ms)^      allow-target-redirect:\n(.*?)(?=^      \S|^    \S)", self.text)
        self.assertIsNotNone(block)
        self.assertIn("type: boolean", block.group(1))
        self.assertIn("default: false", block.group(1))


class CheckModeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="mirror-mode-"))
        self.script = self.tmp / "step.sh"
        self.script.write_text(step_script(WORKFLOW, CHECK_MODE), encoding="utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_step(self, mode: str, prefix: str = "") -> tuple[int, str]:
        env = {"PATH": os.environ["PATH"], "MODE": mode, "TAG_PREFIX": prefix}
        r = subprocess.run(["bash", "-eo", "pipefail", str(self.script)], cwd=self.tmp,
                           env=env, capture_output=True, text=True)
        return r.returncode, r.stdout + r.stderr

    def test_default_mirror_mode_without_prefix_passes(self) -> None:
        self.assertEqual(self.run_step("mirror")[0], 0)

    def test_mirror_mode_rejects_a_tag_prefix(self) -> None:
        code, out = self.run_step("mirror", "sdk/go/")
        self.assertEqual(code, 1, out)
        self.assertIn("only valid with mode: tag-only", out)

    def test_tag_only_needs_a_prefix(self) -> None:
        for prefix in ("", "  ", "/", "//"):
            with self.subTest(prefix=prefix):
                code, out = self.run_step("tag-only", prefix)
                self.assertEqual(code, 1, out)
                self.assertIn("needs tag-prefix", out)
        self.assertEqual(self.run_step("tag-only", "sdk/go/")[0], 0)

    def test_unknown_mode_fails(self) -> None:
        code, out = self.run_step("tags")
        self.assertEqual(code, 1, out)
        self.assertIn("mode must be", out)


def git(cwd: Path, *args: str, env: dict | None = None) -> str:
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, env=env, check=True)
    return r.stdout.strip()


class TagOnlyTests(unittest.TestCase):
    """A poly-nerv-shaped source and its root mirror `hop-top/nerv`.

    The root component (`dir: .`) mirrors the HEAD tree minus
    `.github/workflows/`, so `sdk/go` on the mirror is the source's
    `sdk/go` tree. The mirror remote's https URL is rewritten to a local
    bare repo with `url.<path>.insteadOf`, so the step runs unchanged.
    """

    MIRROR = "hop-top/nerv"

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="mirror-tag-only-"))
        self.src = self.tmp / "src"
        self.bare = self.tmp / "mirror.git"
        self.pub = self.tmp / "pub"  # scratch clone that plays the root release
        git(self.tmp, "init", "-q", "--bare", str(self.bare))
        git(self.tmp, "init", "-q", "-b", "main", str(self.src))
        self.base_env = {
            "PATH": os.environ["PATH"],
            "HOME": str(self.tmp),
            "GIT_CONFIG_GLOBAL": str(self.tmp / "gitconfig"),
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
            "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com",
        }
        url = f"https://x-access-token:tok@github.com/{self.MIRROR}.git"
        (self.tmp / "gitconfig").write_text(
            f'[url "{self.bare}"]\n\tinsteadOf = {url}\n[init]\n\tdefaultBranch = main\n',
            encoding="utf-8")
        self.script = self.tmp / "step.sh"
        self.script.write_text(step_script(WORKFLOW, TAG_ONLY), encoding="utf-8")
        shims = self.tmp / "bin"
        shims.mkdir()
        self.shims = shims
        self.dates = iter(range(1_700_000_000, 1_800_000_000, 100))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    # -- fixture helpers -------------------------------------------------

    def commit(self, files: dict[str, str], msg: str) -> str:
        for rel, content in files.items():
            path = self.src / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        date = f"@{next(self.dates)} +0000"
        env = {**self.base_env, "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date}
        git(self.src, "add", "-A", env=env)
        git(self.src, "commit", "-q", "-m", msg, env=env)
        return git(self.src, "rev-parse", "HEAD", env=env)

    def root_mirror_commit(self, src_sha: str) -> str:
        """What the root component's mirror job builds: HEAD tree minus
        .github/workflows, one parentless commit with the source metadata."""
        env = {**self.base_env, "GIT_INDEX_FILE": str(self.tmp / "idx")}
        git(self.src, "read-tree", src_sha, env=env)
        subprocess.run(["git", "rm", "-rf", "--cached", "--quiet", "--ignore-unmatch",
                        ".github/workflows/"], cwd=self.src, env=env, check=True)
        tree = git(self.src, "write-tree", env=env)
        date = git(self.src, "log", "-1", "--format=%cI", src_sha, env=env)
        cenv = {**self.base_env, "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date}
        return git(self.src, "commit-tree", tree, "-m", f"mirror of {src_sha}", env=cenv)

    def release_root(self, src_sha: str, version: str) -> str:
        """Force-push the root mirror commit to main and tag it, as mode: mirror does."""
        sha = self.root_mirror_commit(src_sha)
        git(self.src, "push", "-q", "--force", str(self.bare), f"{sha}:refs/heads/main", env=self.base_env)
        git(self.src, "push", "-q", "--force", str(self.bare), f"{sha}:refs/tags/{version}", env=self.base_env)
        return sha

    def mirror_ref(self, ref: str) -> str:
        r = subprocess.run(["git", "rev-parse", "--verify", "-q", ref], cwd=self.bare,
                           capture_output=True, text=True, env=self.base_env)
        return r.stdout.strip()

    def mirror_refs(self) -> str:
        return git(self.bare, "for-each-ref", "--format=%(refname) %(objectname)", env=self.base_env)

    def run_step(self, tag: str = "v0.3.0", prefix: str = "sdk/go/", source: str = "sdk/go",
                 wait: str = "0", extra_path: str = "") -> tuple[int, str]:
        env = {**self.base_env,
               "PATH": f"{extra_path}{os.environ['PATH']}",
               "GH_TOKEN": "tok", "MIRROR_REPO": self.MIRROR, "TAG": tag,
               "TAG_PREFIX": prefix, "PREFIX": source,
               "WAIT_SECONDS": wait, "POLL_SECONDS": "1"}
        r = subprocess.run(["bash", "-eo", "pipefail", str(self.script)], cwd=self.src,
                           env=env, capture_output=True, text=True)
        return r.returncode, r.stdout + r.stderr

    def seed(self) -> tuple[str, str]:
        """Source with a root module and sdk/go; root released as v1.0.0."""
        sha = self.commit({"go.mod": "module hop.top/nerv\n",
                           ".github/workflows/ci.yml": "name: ci\n",
                           "sdk/go/go.mod": "module hop.top/nerv/sdk/go\n",
                           "sdk/go/nerv.go": "package nerv // v1\n"}, "feat: v1")
        return sha, self.release_root(sha, "v1.0.0")

    # -- behaviour -------------------------------------------------------

    def test_tags_the_mirror_commit_with_the_same_module_tree(self) -> None:
        _, mirror_sha = self.seed()
        before = self.mirror_refs()
        code, out = self.run_step()
        self.assertEqual(code, 0, out)
        self.assertEqual(self.mirror_ref("refs/tags/sdk/go/v0.3.0"), mirror_sha)
        # Only the new tag: main and the root tag are untouched.
        after = self.mirror_refs()
        self.assertEqual(set(after.splitlines()) - set(before.splitlines()),
                         {f"refs/tags/sdk/go/v0.3.0 {mirror_sha}"})
        self.assertEqual(set(before.splitlines()) - set(after.splitlines()), set())

    def test_module_tree_unchanged_since_an_older_root_release_tags_that_release(self) -> None:
        _, v1 = self.seed()
        # Root moves on (new root release); sdk/go does not change.
        self.commit({"nerv.go": "package nerv // root change\n"}, "feat: root only")
        v2 = self.release_root(git(self.src, "rev-parse", "HEAD"), "v1.1.0")
        code, out = self.run_step()
        self.assertEqual(code, 0, out)
        # Newest mirror commit carrying the same sdk/go tree.
        self.assertEqual(self.mirror_ref("refs/tags/sdk/go/v0.3.0"), v2)
        self.assertNotEqual(v1, v2)

    def test_matching_commit_reachable_only_from_an_old_tag_is_found(self) -> None:
        sha, v1 = self.seed()
        # Module changes and the root re-releases: main no longer matches.
        self.commit({"sdk/go/nerv.go": "package nerv // v2\n"}, "feat(go): v2")
        self.release_root(git(self.src, "rev-parse", "HEAD"), "v1.1.0")
        # Release the module at the OLD commit (its tag predates the change).
        git(self.src, "checkout", "-q", "--detach", sha, env=self.base_env)
        code, out = self.run_step()
        self.assertEqual(code, 0, out)
        self.assertEqual(self.mirror_ref("refs/tags/sdk/go/v0.3.0"), v1)

    def test_root_not_released_yet_fails_with_the_ordering_rule(self) -> None:
        self.seed()
        self.commit({"sdk/go/nerv.go": "package nerv // v2\n"}, "feat(go): v2")
        before = self.mirror_refs()
        code, out = self.run_step()
        self.assertEqual(code, 1, out)
        self.assertIn("::error::No commit on hop-top/nerv has sdk/go/", out)
        self.assertIn("no later than the nested module", out)
        self.assertEqual(self.mirror_refs(), before)

    def test_waits_for_a_parallel_root_release(self) -> None:
        self.seed()
        new = self.commit({"sdk/go/nerv.go": "package nerv // v2\n"}, "feat(go): v2")
        mirror_sha = self.root_mirror_commit(new)
        # `sleep` stands in for the parallel run: the first poll interval
        # is when the root release's mirror push lands.
        sleep = self.shims / "sleep"
        sleep.write_text(textwrap.dedent(f"""\
            #!/bin/sh
            git -C "{self.src}" push -q --force "{self.bare}" {mirror_sha}:refs/heads/main
            """), encoding="utf-8")
        sleep.chmod(0o755)
        code, out = self.run_step(wait="5", extra_path=f"{self.shims}{os.pathsep}")
        self.assertEqual(code, 0, out)
        self.assertIn("retrying", out)
        self.assertEqual(self.mirror_ref("refs/tags/sdk/go/v0.3.0"), mirror_sha)

    def test_existing_tag_at_the_right_commit_is_a_no_op(self) -> None:
        _, mirror_sha = self.seed()
        self.assertEqual(self.run_step()[0], 0)
        code, out = self.run_step()
        self.assertEqual(code, 0, out)
        self.assertIn("nothing to do", out)
        self.assertEqual(self.mirror_ref("refs/tags/sdk/go/v0.3.0"), mirror_sha)

    def test_existing_tag_elsewhere_is_never_moved(self) -> None:
        _, v1 = self.seed()
        self.assertEqual(self.run_step()[0], 0)
        new = self.commit({"sdk/go/nerv.go": "package nerv // v2\n"}, "feat(go): v2")
        self.release_root(new, "v1.1.0")
        code, out = self.run_step()
        self.assertEqual(code, 1, out)
        self.assertIn("Refusing to move a published Go module tag", out)
        self.assertEqual(self.mirror_ref("refs/tags/sdk/go/v0.3.0"), v1)

    def test_prefix_spellings_normalise_to_one_tag(self) -> None:
        _, mirror_sha = self.seed()
        for i, prefix in enumerate(("sdk/go", " sdk//go/ ", "./sdk/go/")):
            with self.subTest(prefix=prefix):
                code, out = self.run_step(tag=f"v0.3.{i}", prefix=prefix, source="./sdk/go/")
                self.assertEqual(code, 0, out)
                self.assertEqual(self.mirror_ref(f"refs/tags/sdk/go/v0.3.{i}"), mirror_sha)

    def test_bad_paths_are_rejected_before_touching_the_mirror(self) -> None:
        self.seed()
        before = self.mirror_refs()
        for prefix, source, needle in (("/sdk/go/", "sdk/go", "absolute"),
                                       ("sdk/../go/", "sdk/go", "'..'"),
                                       ("sdk/go/", ".", "subdirectory"),
                                       ("sdk/go/", "sdk/nope", "not a directory")):
            with self.subTest(prefix=prefix, source=source):
                code, out = self.run_step(prefix=prefix, source=source)
                self.assertEqual(code, 1, out)
                self.assertIn(needle, out)
        self.assertEqual(self.mirror_refs(), before)


class ModeWiringTests(unittest.TestCase):
    def setUp(self) -> None:
        self.text = WORKFLOW.read_text(encoding="utf-8")

    def step(self, name: str) -> str:
        start = self.text.index(f"      - name: {name}\n")
        end = self.text.find("\n      - ", start + 1)
        return self.text[start:end if end != -1 else len(self.text)]

    def test_mirror_mode_steps_never_run_in_tag_only_mode(self) -> None:
        for name in MIRROR_ONLY_STEPS:
            with self.subTest(step=name):
                self.assertRegex(self.step(name), r"(?m)^        if: .*inputs\.mode == 'mirror'")

    def test_tag_only_step_is_gated_and_never_forces(self) -> None:
        step = "\n".join(line for line in self.step(TAG_ONLY).splitlines()
                         if not line.lstrip().startswith("#"))
        self.assertIn("if: inputs.mode == 'tag-only'", step)
        self.assertNotIn("--force", step)
        self.assertNotIn("refs/heads/", step.split("git fetch")[0])
        self.assertNotRegex(step, r"git push[^\n]*refs/heads")
        self.assertNotIn("gh api", step)
        self.assertNotIn("gh release", step)

    def test_mode_defaults_keep_existing_callers_unchanged(self) -> None:
        for name, kind, default in (("mode", "string", "mirror"), ("tag-prefix", "string", '""'),
                                    ("wait-seconds", "number", "600")):
            with self.subTest(input=name):
                block = re.search(rf"(?ms)^      {name}:\n(.*?)(?=^      \S|^    \S)", self.text)
                self.assertIsNotNone(block)
                self.assertIn(f"type: {kind}", block.group(1))
                self.assertIn(f"default: {default}", block.group(1))


if __name__ == "__main__":
    unittest.main()
