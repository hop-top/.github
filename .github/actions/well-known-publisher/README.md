# well-known publisher

> **Experimental.** Inputs, outputs and the config schema may change in any
> release until this notice goes away. `@v0` (used below) follows every
> release and picks such changes up; pin an exact release tag (`@v0.x.y`)
> or a commit SHA to choose when you take them.

Composite action that turns a single YAML config into files under
`/.well-known/*`.

## Status

### Works today

- Loading the config: YAML parse, JSON Schema validation with
  line-numbered `::error::` annotations, allowlisted env interpolation
  (see [Environment interpolation](#environment-interpolation)).
- Writing `custom:` entries (after interpolation) into the output
  directory.
- The `files_written` and `manifest` outputs.
- The generator registry that resource modules plug into.

### Not yet

- Resource generators: none exist, so `resources:` accepts no keys yet
  (security.txt, openid-configuration, assetlinks.json and friends are
  the intended first ones).
- Deploying: `deploy`, `worker_endpoint` and `custom[].content_type` are
  validated but nothing acts on them. Publishing the generated files
  (commit, GitHub Pages, a Worker) is up to the caller workflow.

## Inputs

| Name | Default | Description |
| --- | --- | --- |
| `config_path` | `.github/well-known.yaml` | YAML driving the generation. |
| `output_dir` | _unset_ | Where files are written ([precedence](#output_dir-precedence)). |
| `env_allowlist` | _empty_ | Env var names placeholders may read ([details](#environment-interpolation)). |

### `output_dir` precedence

The directory is resolved with the following precedence, highest first:

1. The composite action input `output_dir` (CLI flag `--output-dir`).
2. The `output_dir` value declared in the YAML config file.
3. The schema default `dist/.well-known`.

## Outputs

| Name | Shape |
| --- | --- |
| `files_written` | Newline-separated list of paths emitted. |
| `manifest` | JSON array `[{generator, files, warnings}, ...]`. |

## Usage stub

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hop-top/.github/.github/actions/well-known-publisher@v0
        with:
          config_path: .github/well-known.yaml
          output_dir: dist/.well-known
```

The action only generates files into `output_dir`; any deploy is a later
step of the caller workflow.

## Config skeleton

```yaml
version: 1
output_dir: dist/.well-known
deploy: commit   # or 'pages', 'worker'; validated only, see "Not yet"
resources: {}    # no resource generators exist yet; must stay empty
custom:
  - path: .well-known/example.txt
    content_type: text/plain
    body: |
      hello
```

Each `custom[].path` starts with `.well-known/`; the file lands at
`<output_dir>/<rest of the path>`. Segments must be non-empty, must not be
`.` or `..`, and must not contain backslashes or control characters, and
the resolved target must stay inside `output_dir` (symlinks included).
An unsafe path fails the run before any `custom:` file is written.

Per-resource keys under `resources:` are added by individual generator
modules. See `generator/src/well_known_publisher/resources/` and the JSON
Schema at `schema/well-known.schema.json` for the contract each generator
must satisfy.

### Adding a resource

A resource generator is a function with signature
`(sub_cfg: dict, out_dir: Path) -> GeneratorResult`, decorated with
`@register("<name>")`. The `<name>` MUST match both the YAML key under
`resources:` and a `$defs/<name>` entry in the JSON Schema referenced
from `properties.resources.properties.<name>`.

Return contract:

- `GeneratorResult.files` — list of `Path`s the generator wrote (surface in
  the `files_written` output).
- `GeneratorResult.warnings` — number of `::warning::` annotations the
  generator emitted (surfaced in the `manifest` output so caller
  workflows can fail-on-warning if desired).

Minimal example:

```python
from pathlib import Path
from well_known_publisher.registry import GeneratorResult, register


@register("my_resource")
def generate(sub_cfg: dict, out_dir: Path) -> GeneratorResult:
    target = out_dir / "my-resource.json"
    target.write_text("{}")
    return GeneratorResult(files=[target], warnings=0)
```

## Environment interpolation

Any string value may reference an environment variable using the
GitHub-Actions-style placeholder `${{ env.NAME }}`. The loader substitutes
each occurrence with `os.environ['NAME']` before schema validation.

Only names listed in the `env_allowlist` input are read. The default is
empty, so out of the box no placeholder interpolates and every reference
fails the run. This keeps anything else in the job environment (for
example `GITHUB_TOKEN` passed as env, or the runner's
`ACTIONS_ID_TOKEN_REQUEST_TOKEN`) out of published files. List exactly the
variables the config needs:

```yaml
- uses: hop-top/.github/.github/actions/well-known-publisher@v0
  env:
    SECURITY_CONTACT: mailto:security@example.com
  with:
    env_allowlist: SECURITY_CONTACT
```

A reference to a name outside the allowlist, or to an allowlisted
variable that is unset, fails with an `::error::` annotation carrying the
config file and the line of the key whose value holds the placeholder.

### Publishing a literal `${{ ... }}`

Write `$${{` where the published file needs `${{`. The loader drops one
`$` and leaves the rest of the expression untouched:

```yaml
custom:
  - path: .well-known/ci-howto.txt
    body: |
      sha: $${{ env.GITHUB_SHA }}
      ref: $${{ github.ref }}
```

publishes `sha: ${{ env.GITHUB_SHA }}` and `ref: ${{ github.ref }}`. Only
`${{ env.NAME }}` placeholders interpolate, so other expressions such as
`${{ github.ref }}` come out as written with or without the escape. Each
`$${{` loses exactly one `$` (`$$${{` publishes `$${{`).

## Schema validation

Configs are validated against `schema/well-known.schema.json` (JSON Schema
draft 2020-12). Unknown top-level keys, unknown resource keys, and missing
required fields all fail loudly with `::error::` annotations.

## Runtime

The action sets up Python 3.12 with `update-environment: false` and runs
the generator from a private venv under `$RUNNER_TEMP`, so it does not
change the `python` that later steps of the caller's job see. Dependencies
come from `generator/requirements.txt`: exact versions, `sha256` hashes,
and prebuilt wheels only (available for GitHub-hosted Linux, macOS and
Windows x64 runners). After changing `dependencies` in
`generator/pyproject.toml`, regenerate it from the repo root with the
command recorded in its header.

## Permissions

This action declares no permissions. The caller workflow is responsible for
granting whatever it needs for the chosen deploy mode (e.g. `contents:
write` for `commit`, `pages: write` for `pages`).
