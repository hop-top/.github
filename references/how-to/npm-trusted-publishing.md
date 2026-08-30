# Publish to npm without tokens (trusted publishing)

Bind each npm package to its publishing workflow via OIDC so `publish-ts`
needs no token, no OTP, and nothing that expires.

## Use this when

- Setting up a new npm-shipping repo (do this instead of minting a token).
- `publish-ts` fails with any of the token-path errors in
  [troubleshooting/ts.md § npm auth failure ladder](../troubleshooting/ts.md#npm-auth-failure-ladder).
- Rotating `NPM_REGISTRY_TOKEN` for the second time and tired of it.

## Result

`pnpm publish` authenticates via a short-lived OIDC exchange. Publishes
carry sigstore provenance. No secret to rotate — npm is deprecating
2FA-bypass tokens anyway (<https://gh.io/npm-gat-bypass2fa-deprecation>),
so the token path has a shelf life regardless.

## One command per package

```sh
npm trust github @<scope>/<pkg> \
  --repo <org>/<source-repo> \
  --file publish.yml \
  --allow-publish --yes
```

Verify:

```sh
npm trust list @<scope>/<pkg>
```

Expected: `type: github`, your repo, `file: publish.yml`,
`permissions: publish, stage publish`.

## The details that bite

- **`--file` takes a FILENAME, not a path.** Passing
  `.github/workflows/publish.yml` fails with
  `GitHub Actions workflow must be just a file not a path`.
- **Bind the CALLER workflow (`publish.yml`), never the reusable
  (`publish-ts.yml`).** GitHub's OIDC `workflow_ref` claim names the
  calling workflow — the same trap as PyPI trusted publishing
  ([secrets.md § OIDC trap](../secrets.md)).
- **It's per package, by design.** The registry supports exactly one
  binding per package and nothing scope- or org-wide: a scope-level
  binding would let one compromised repo publish every package in the
  scope — the exact blast radius tokens have and OIDC exists to remove.
  A monorepo also makes the mapping non-inferable: one repo + one
  `publish.yml` can ship many packages, so each package opts in.
- **You need a logged-in npm session with 2FA.** `E401` → `npm login`
  first. `EOTP` → append `--otp <6-digit-code>` (or approve the printed
  browser URL and re-run).
- **`E409 Conflict` means the binding already exists** — a previous
  attempt landed. Confirm with `npm trust list`; don't retry.
- **`package.json` MUST declare `repository`.** npm validates the
  sigstore provenance bundle against it; a missing or mismatched field
  rejects the publish with `E422 ... Error verifying sigstore provenance
  bundle`. In a monorepo, point at the source repo with a `directory`:

  ```json
  "repository": {
    "type": "git",
    "url": "git+https://github.com/<org>/<source-repo>.git",
    "directory": "ts"
  }
  ```

- **OIDC wins when both are configured.** With a trusted publisher bound,
  `NPM_REGISTRY_TOKEN` is ignored by the publish (observed: a 2FA-walled
  token present AND a binding → publish succeeded via OIDC, with
  provenance). `publish-ts.yml` still declares the secret, so keep it
  set — it's the fallback for packages without a binding.
- **Configs created after 2026-05-20 must explicitly allow actions** —
  hence `--allow-publish`.

## First publish of a NEW package

Trusted publishing can't create a package that doesn't exist yet — and
neither can the org-scoped CI token (scoped tokens publish updates, not
new names). Bootstrap the first publish locally
([`scripts/bootstrap-first-publish.sh npm`](../../scripts/README.md),
[SKILL.md § First publish](../../SKILL.md#first-publish-of-a-new-package)),
then bind the trusted publisher immediately after.
