# Shipping Go binaries

Reference for [`goreleaser-on-tag.yml`](../../.github/workflows/goreleaser-on-tag.yml).

Wraps [GoReleaser](https://goreleaser.com) to build cross-platform
binaries (linux / macOS / windows × amd64 / arm64), publish them
as GitHub Release assets, and push a Homebrew formula to a tap
repo — all driven by a `<component>/v<version>` tag push from
release-please.

## When to use this

- You ship a Go CLI or daemon that end-users install (not just a
  library other Go projects import).
- You want `brew install` and direct binary downloads, not just
  `go install hop.top/<repo>@latest`.

If you're shipping a library only, skip this — `publish-on-tag.yml`'s
`go` ecosystem is a no-op because Go modules ship via
`proxy.golang.org` pulling git tags. No build step needed.

## Why a dedicated workflow

GoReleaser's `monorepo:` block strips the `<component>/` tag
prefix so `{{.Version}}` resolves to the bare semver. That block
is **[GoReleaser Pro][gr-monorepo] only**. The OSS version sees
`<component>/v<version>` tags as opaque strings, breaking artifact
names, ldflag injection, and the Homebrew formula's `version:`
field.

`goreleaser-on-tag.yml` works around this by deriving the bare
semver in shell and exposing it as `BARE_VERSION` (plus the
literal tag as `RELEASE_TAG`) to the GoReleaser step's
environment. Both `<component>/v<version>` and plain `v<version>`
shapes work — same workflow, no caller config to tune.

[gr-monorepo]: https://goreleaser.com/customization/monorepo/

## Caller workflow

`.github/workflows/goreleaser.yml`:

```yaml
name: goreleaser
on:
  push:
    tags: ['usp/v*']    # match your release-please tag shape

jobs:
  goreleaser:
    uses: hop-top/.github/.github/workflows/goreleaser-on-tag.yml@v0
    secrets:
      RELEASE_BOT_APP_ID: ${{ secrets.RELEASE_BOT_APP_ID }}
      RELEASE_BOT_PRIVATE_KEY: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
    with:
      homebrew-tap-repo: homebrew-tap   # omit if no `brews:` block
```

The reusable workflow handles checkout, Go toolchain setup, the
release-bot App token mint, and the GoReleaser invocation. See the
[workflow source](../../.github/workflows/goreleaser-on-tag.yml)
for all available `with:` inputs (config path, goreleaser version
constraint, Go version).

## `.goreleaser.yaml` template

Reference `{{ .Env.BARE_VERSION }}` and `{{ .Env.RELEASE_TAG }}`
wherever you'd normally use `{{.Version}}` or `{{.Tag}}`. That's
the only template-side adjustment needed:

```yaml
version: 2
project_name: usp

builds:
  - id: usp
    main: ./cmd/usp
    binary: usp
    env: [CGO_ENABLED=0]
    flags: [-trimpath, -buildvcs=false]
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]
    ldflags:
      - -s -w -X main.version={{ .Env.BARE_VERSION }}

archives:
  - id: usp
    ids: [usp]
    name_template: "usp_{{ .Env.BARE_VERSION }}_{{ .Os }}_{{ .Arch }}"
    format_overrides:
      - goos: windows
        formats: [zip]

checksum:
  name_template: checksums.txt

changelog:
  # release-please already authors the changelog; don't duplicate.
  disable: true

release:
  # release-please created the GitHub Release at tag-cut time;
  # append binaries to that existing release.
  mode: append

brews:
  - name: usp
    repository:
      owner: hop-top
      name: homebrew-tap
      branch: main
      token: "{{ .Env.HOMEBREW_TAP_TOKEN }}"
    homepage: https://github.com/hop-top/usp
    description: "Universal Sessions Protocol"
    license: MIT
    # {{ .Env.RELEASE_TAG }} is the literal `usp/v...` tag, which
    # is what the GitHub Release URL uses for asset downloads.
    url_template: "https://github.com/hop-top/usp/releases/download/{{ .Env.RELEASE_TAG }}/{{ .ArtifactName }}"
    install: bin.install "usp"
    test: |
      system "#{bin}/usp", "--version"
```

## Composition with release-please

The tag-push flow becomes:

```
release-please cuts tag <component>/v<version>
  ↓
publish-on-tag.yml fires        ← language-registry publishes + mirror push
  ↓ (in parallel)
goreleaser-on-tag.yml fires     ← cross-platform binaries + Homebrew formula
```

Both workflows trigger on the same tag, run independently. The
GitHub Release is created by release-please; both publish layers
attach their artifacts to it (GoReleaser uses `release.mode: append`).

## Requirements

- The `release-bot` GitHub App must be installed on the source
  repo **and** the Homebrew tap repo (if `brews:` is used) — same
  install, scoped to both.
- `RELEASE_BOT_APP_ID` + `RELEASE_BOT_PRIVATE_KEY` org secrets
  (already required by `release-please.yml`).
- The Homebrew tap repo (`<org>/homebrew-tap`) must exist before
  the first tag push; GoReleaser pushes the first commit to it.

## Gotchas

### `-buildvcs=false` is required

Go's default `-buildvcs=true` stamps the binary with VCS metadata
from the build environment. GoReleaser runs each build in a
checkout that's frequently in a state Go's VCS detection rejects
(e.g. detached HEAD with no tracking branch), which surfaces as:

```
error obtaining VCS status: exit status 128
    Use -buildvcs=false to disable VCS stamping.
```

Always include `-buildvcs=false` in the `flags:` list of every
build.

### GoReleaser version compatibility

The reusable workflow defaults to `~> v2` (latest 2.x). The
`.goreleaser.yaml` template above assumes:

- `monorepo:` not used (Pro-only)
- `archives.ids:` (renamed from `archives.builds:` in 2.x)
- `archives.format_overrides.formats:` (renamed from `format:` in 2.x)
- `brews:` (still works in 2.x but deprecated in favor of
  `homebrew_casks:`; will need a migration in a future major)

### Homebrew formula's `version:` is auto-derived

GoReleaser sets the formula's `version:` field from `{{.Version}}`,
not `{{.Env.BARE_VERSION}}`. With prefixed tags + OSS GoReleaser,
`{{.Version}}` becomes the literal `usp/v0.1.0-alpha.1` rather
than the bare semver. The current workaround: leave `version:`
alone (GoReleaser writes it, even if ugly), and rely on the
formula's `url:` to drive the actual download. Users get the
right binary; the formula's reported version is cosmetic.

If/when the cosmetic version matters, override `release.name_template`
in `.goreleaser.yaml` to inject `BARE_VERSION`. The simpler path
is GoReleaser Pro + the `monorepo:` block.
