# Shipping TypeScript / Node binaries

**Status:** planned, not yet implemented.

When implemented, this page will document one of:

- `pkg-on-tag.yml` — using [`@vercel/pkg`](https://github.com/vercel/pkg)
  or [`nexe`](https://github.com/nexe/nexe) to bundle Node + your
  app into a single executable.
- `electron-on-tag.yml` — using
  [`electron-builder`](https://www.electron.build/) for desktop
  apps with a UI.

Both would follow the same shape as
[`goreleaser-on-tag.yml`](../../.github/workflows/goreleaser-on-tag.yml)
for Go (see [docs/binaries/go.md](go.md)).

## In the meantime

`publish-on-tag.yml`'s `ts` ecosystem already publishes Node
**packages** to npm. If users install via `npm install -g <pkg>`
or `pnpm add -g <pkg>`, that's sufficient — they'll get the CLI
on their `PATH`, executed by their local Node.

For Node **binaries** (no-Node-runtime executables, useful when
distributing to users without Node installed), open an issue
against this repo with your use case so we can prioritize the
implementation. Until then, adopter repos can drop a one-off
`.github/workflows/release.yml` calling `pkg` / `nexe` /
`electron-builder` directly.

## Tool tradeoffs (when this gets implemented)

- **`@vercel/pkg`** — most established, but unmaintained as of
  2023. Will need to assess alternatives like `nexe` (active),
  Bun's native compilation (`bun build --compile`), or Node 21+'s
  built-in single-executable applications (`node --experimental-sea-config`).
- **`electron-builder`** — only for apps with a UI. Outputs `.dmg`
  / `.exe` installers + auto-update channels.
- **Bun** — fastest path if the adopter is already on Bun; a
  single `bun build --compile` produces a static binary per
  target. Constrains the runtime, though.

The likely choice depends on what kit of Node ecosystem adopters
are in. Open an issue to share your case.
