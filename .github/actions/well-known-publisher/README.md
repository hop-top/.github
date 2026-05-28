# well-known publisher

Composite action that generates files under `/.well-known/*` from a single
YAML config and (optionally, in a separate workflow step) deploys them to a
commit, GitHub Pages, or a Cloudflare Worker.

## Inputs

| Name          | Default                     | Description                                   |
|---------------|-----------------------------|-----------------------------------------------|
| `config_path` | `.github/well-known.yaml`   | YAML driving the generation.                  |
| `output_dir`  | `dist/.well-known`          | Where generated files are written.            |

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

## Schema validation

Configs are validated against `schema/well-known.schema.json` (JSON Schema
draft 2020-12). Unknown top-level keys, unknown resource keys, and missing
required fields all fail loudly with `::error::` annotations.

## Permissions

This action declares no permissions. The caller workflow is responsible for
granting whatever it needs for the chosen deploy mode (e.g. `contents:
write` for `commit`, `pages: write` for `pages`).
