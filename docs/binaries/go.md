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
      homebrew-tap-repo: homebrew-tap     # omit if no `brews:` block
      scoop-bucket-repo: scoop-bucket     # omit if no `scoops:` block
```

The reusable workflow handles checkout, Go toolchain setup, the
release-bot App token mint, and the GoReleaser invocation. The
App token's scope is composed dynamically: caller repo always,
plus any package-manager target repos passed via `with:`. See the
[workflow source](../../.github/workflows/goreleaser-on-tag.yml)
for all available inputs (config path, goreleaser version
constraint, Go version).

## `.goreleaser.yaml` template

The reusable workflow synthesizes a `v<bare>` git tag at the same
commit and feeds it via `GORELEASER_CURRENT_TAG`, so stock
`{{.Version}}` and `{{.Tag}}` resolve cleanly under prefixed tags.
Two adopter requirements:

- **`release.disable: true`** — GoReleaser OSS can't target a
  release with a different tag name than the current git tag, so
  the reusable workflow handles GitHub Release uploads itself via
  `gh release upload` to the real prefixed tag.
- **`{{ .Env.RELEASE_TAG }}`** in the Homebrew formula URL only —
  this is the one spot that needs the real prefixed tag, because
  the GitHub Release asset path uses it verbatim.

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
      - -s -w -X main.version={{ .Version }}

archives:
  - id: usp
    ids: [usp]
    name_template: "usp_{{ .Version }}_{{ .Os }}_{{ .Arch }}"
    format_overrides:
      - goos: windows
        formats: [zip]

checksum:
  name_template: checksums.txt

changelog:
  # release-please already authors the changelog; don't duplicate.
  disable: true

release:
  # The reusable workflow handles uploading dist/* to the real
  # release-please-created release. GoReleaser OSS can't target
  # a different tag name on its own (release.tag: is Pro-only).
  disable: true

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
    # {{ .Env.RELEASE_TAG }} is the literal `usp/v<version>` tag,
    # which is the path segment GitHub Releases use for asset
    # downloads. {{.Tag}} here would resolve to the synthesized
    # bare tag — wrong for the URL.
    url_template: "https://github.com/hop-top/usp/releases/download/{{ .Env.RELEASE_TAG }}/{{ .ArtifactName }}"
    install: bin.install "usp"
    test: |
      system "#{bin}/usp", "--version"

scoops:
  - name: usp
    repository:
      owner: hop-top
      name: scoop-bucket
      branch: main
      token: "{{ .Env.SCOOP_BUCKET_TOKEN }}"
    homepage: https://github.com/hop-top/usp
    description: "Universal Sessions Protocol"
    license: MIT
    # Same RELEASE_TAG reasoning as brews above.
    url_template: "https://github.com/hop-top/usp/releases/download/{{ .Env.RELEASE_TAG }}/{{ .ArtifactName }}"
```

## Composition with release-please

The tag-push flow becomes:

```
release-please cuts tag <component>/v<version>
  ↓
publish-on-tag.yml fires        ← language-registry publishes + mirror push
  ↓ (in parallel)
goreleaser-on-tag.yml fires     ← cross-platform binaries
                                  + Homebrew formula (brews:)
                                  + Scoop manifest (scoops:)
```

Both workflows trigger on the same tag, run independently. The
GitHub Release is created by release-please; `publish-on-tag.yml`
relies on registries pulling from the tag, and
`goreleaser-on-tag.yml` uploads its archives + checksum directly
to the release via `gh release upload`.

## Requirements

- The `release-bot` GitHub App must be installed on the source
  repo **and** every package-manager target repo in use
  (`<org>/homebrew-tap` for Homebrew, `<org>/scoop-bucket` for
  Scoop, etc.) — same install, scoped to all.
- `RELEASE_BOT_APP_ID` + `RELEASE_BOT_PRIVATE_KEY` org secrets
  (already required by `release-please.yml`).
- Each package-manager target repo must exist before the first tag
  push; GoReleaser pushes the first commit to it.

## Package managers

`.goreleaser.yaml` can ship to several package managers at once;
the reusable workflow scopes the App token to each target repo
based on the corresponding `with:` input.

| Manager | Platform | GoReleaser block | Workflow input | Tap/bucket convention |
|---|---|---|---|---|
| Homebrew | macOS + Linux | `brews:` | `homebrew-tap-repo: homebrew-tap` | `<org>/homebrew-tap` |
| Scoop | Windows | `scoops:` | `scoop-bucket-repo: scoop-bucket` | `<org>/scoop-bucket` |
| WinGet | Windows (default on Win 11+) | _planned; not yet wired in `goreleaser-on-tag.yml`_ | — | PR into `microsoft/winget-pkgs` via fork |

### Scoop install UX

End users:

```powershell
scoop bucket add hop-top https://github.com/hop-top/scoop-bucket
scoop install usp
```

### WinGet (planned)

Highest reach on modern Windows — ships pre-installed on
Windows 11 and recent Windows 10. First publish requires a
manual PR to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs);
subsequent releases automate via fork. Tracking issue:
[hop-top/.github#28 (TBD)](https://github.com/hop-top/.github/issues).

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

### Why `release.disable: true` is mandatory

GoReleaser OSS computes the release tag from the current git tag
(or `GORELEASER_CURRENT_TAG` if set). It can't be told to "build
under tag X, but publish to release Y." The Pro-only `release.tag`
override exists for exactly this case but isn't available here.

The workaround the reusable workflow uses: synthesize a `v<bare>`
local tag so GoReleaser's tag parser is happy, run with
`release.disable: true` so GoReleaser doesn't try to touch any
GitHub Release, then upload `dist/*.tar.gz`, `dist/*.zip`, and
`dist/checksums.txt` via `gh release upload` to the real
prefixed tag.

Net effect for adopters: set `release.disable: true` and don't
think about it. The reusable workflow does the right thing.
