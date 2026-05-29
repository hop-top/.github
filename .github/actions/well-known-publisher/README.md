# well-known publisher

Composite action that generates files under `/.well-known/*` from a single
YAML config and (optionally, in a separate workflow step) deploys them to a
commit, GitHub Pages, or a Cloudflare Worker.

## Inputs

| Name          | Default                     | Description                                   |
|---------------|-----------------------------|-----------------------------------------------|
| `config_path` | `.github/well-known.yaml`   | YAML driving the generation.                  |
| `output_dir`  | _unset_                     | Where generated files are written; when omitted, the config's `output_dir` wins, falling back to `dist/.well-known`. |

### `output_dir` precedence

The directory is resolved with the following precedence, highest first:

1. The composite action input `output_dir` (CLI flag `--output-dir`).
2. The `output_dir` value declared in the YAML config file.
3. The schema default `dist/.well-known`.

## Outputs

| Name            | Shape                                                           |
|-----------------|-----------------------------------------------------------------|
| `files_written` | Newline-separated list of paths emitted.                        |
| `manifest`      | JSON array `[{generator, files, warnings}, ...]`.               |

## Usage stub

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hop-top/.github/.github/actions/well-known-publisher@main
        with:
          config_path: .github/well-known.yaml
          output_dir: dist/.well-known
```

Deploy modes (commit / pages / worker) are wired by the caller workflow; the
action itself only generates files into `output_dir`.

## Config skeleton

```yaml
version: 1
output_dir: dist/.well-known
deploy: commit   # or 'pages', 'worker', or omitted for generate-only
resources: {}    # per-resource generators register their own keys
custom:
  - path: .well-known/example.txt
    content_type: text/plain
    body: |
      hello
```

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
each occurrence with `os.environ['NAME']` before schema validation and
emits a workflow `::error::` annotation (with the offending line number)
for any missing variable.

> **WARNING — no literal escape.** Substitution is unconditional in every
> string value, including `custom.body`. A `custom:` entry whose body
> documents `${{ env.GITHUB_SHA }}` (or any other GitHub Actions
> expression) will be **silently rewritten** at generate time. There is
> no built-in escape today. To publish the literal token, sidestep the
> regex — write the dollar sign with its Unicode escape (`$`) inside
> a JSON-encoded YAML string, split the placeholder across a YAML
> concatenation, or generate the file from a real resource module instead
> of `custom:`. Do not rely on this action to round-trip the
> documentation as-is.

## Schema validation

Configs are validated against `schema/well-known.schema.json` (JSON Schema
draft 2020-12). Unknown top-level keys, unknown resource keys, and missing
required fields all fail loudly with `::error::` annotations.

## Permissions

This action declares no permissions. The caller workflow is responsible for
granting whatever it needs for the chosen deploy mode (e.g. `contents:
write` for `commit`, `pages: write` for `pages`).
