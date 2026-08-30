# PHP troubleshooting

Everything specific to shipping a php component through this skill.

## Use this when

- A php tag push didn't end up on Packagist.
- `composer install` rejects your prerelease version string.
- Packagist shows your package as abandoned even though `composer.json` doesn't say so.
- You're configuring `publish.yml` for a php component and want to know what can go wrong.

## Result

You can diagnose and fix any php-specific failure mode the
publish-on-tag pipeline can throw at you.

## How PHP publishing works here

PHP "publishing" is not publish-from-source — Packagist polls the
mirror repo for tags. The `publish-php` job runs **after** the
mirror push and POSTs to Packagist's `update-package` API to
trigger an immediate re-index (vs. waiting for the polling
interval, which can be hours). Without the notify step, the
mirror's new tag eventually surfaces on Packagist anyway, but the
workflow run completes green with no signal that anything is
pending — a silent-success failure mode that motivated PR
[#41](https://github.com/hop-top/.github/pull/41).

## One-time setup per package

After the **first** mirror push lands on `<org>/<name>-php`, submit
the package at <https://packagist.org/packages/submit> with the
mirror repo URL. See [docs/browser-playbooks.md § Packagist:
submit package](../../docs/browser-playbooks.md#packagist-submit-package).
This is a one-time operation — Packagist needs to know the package
exists before the API notify can re-index it.

## Packagist notify: the per-tag flow

```
tag push <name-php>/v<x.y.z>
  ↓ publish.yml fires
  ↓ parse → ecosystem=php → mirror runs → publish-php runs
  ↓ publish-php: POST https://packagist.org/api/update-package
  ↓                 ?username=…&apiToken=…
  ↓                 {"repository":{"url":"https://github.com/<org>/<name>-php"}}
  ↓ Packagist returns 202 + job id, queues re-index
  ↓ p2 metadata (composer-install path) updates within minutes
  ↓ legacy /packages/<vendor>/<pkg>.json (web UI) lags behind CDN — up to 12h
```

## PHP requires the mirror

The `publish-php` job has `needs: mirror`. If a caller sets
`enable-mirror: false` with `ecosystem: php`, `parse` fails early
with:

```
::error::ecosystem=php requires enable-mirror=true (Packagist notify depends on the mirror job)
```

There is no "publish to Packagist without the mirror" path —
Packagist polls the mirror slug, not the source.

## Composer rejects `experimental.N` pre-release identifiers

PHP's Composer parser only accepts a fixed list of pre-release
stability identifiers: **`dev` | `alpha` | `beta` | `RC` |
`stable`**. A SemVer string like `0.4.0-experimental.1` parses
everywhere else (npm, cargo, Go module proxy, PyPI after
normalization) but **fails `composer install` with `Invalid version
string`**.

Use `0.4.0-alpha.N` for the prerelease counter in `composer.json`
(and the release-please manifest for the php package). The other
ecosystems can keep `experimental.N` if you prefer — but the php
package needs `alpha.N`. This bit T-0183; see commit
[`0b76224d`](https://github.com/hop-top/poly-kit/commit/0b76224d).

## "Abandoned" flag is sticky and Packagist-side only

Packagist has a per-package `abandoned: bool` flag that's set via
the Packagist **web UI** (or undocumented authenticated API), NOT
via `composer.json`. The flag persists across `update-package`
notify calls — re-indexing the mirror tag will not clear it.

If a previous test/cleanup or accidental click marked the package
abandoned, unmark it in the browser at the package's edit page
(maintainer access required). See [docs/browser-playbooks.md §
Packagist: unmark abandoned](../../docs/browser-playbooks.md#packagist-unmark-abandoned).

The p2 metadata (`/p2/<vendor>/<pkg>.json`, the install path)
updates immediately on unmark; the legacy
`/packages/<vendor>/<pkg>.json` endpoint can lag the CDN's
`s-maxage=43200` (12h) cache.

## Packagist credentials missing: clean skip, green run

A php tag pipeline whose caller hasn't wired `PACKAGIST_USERNAME` /
`PACKAGIST_TOKEN` still publishes the mirror; the `publish-php` step
emits a `::notice::` and `exit 0` instead of failing. Workflow run
stays green, Packagist polling eventually picks up the new tag on
its own schedule (hours, not minutes).

Symptom: workflow green, "Notify Packagist of new tag" step shows
`::notice::PACKAGIST_USERNAME and/or PACKAGIST_TOKEN not provided;
skipping Packagist notify`, and the Packagist page shows the new
version only after the next poll cycle.

Root cause: missing-secret config error, not a publish failure.
"No credentials" means "don't notify Packagist," not "fail the
release." Hard-fail on missing creds belongs in the preflight
check, not the publish path.

Resolution: if you wanted Packagist notified immediately, add the
secrets to the consumer `publish.yml` `secrets:` block (see
[references/secrets.md](../secrets.md)). Otherwise the silent-poll
fallback is the documented behavior — same graceful-skip design as
[SKILL.md § Umbrella / meta-component tags](../../SKILL.md#umbrella--meta-component-tags).

## Workflow internals (for debuggers)

- The `publish-php` job's `if:` uses `always() && needs.parse.outputs.ecosystem == 'php' && needs.mirror.result == 'success'`. The `always()` is required because the transitive needs include `publish-ts/publish-py/publish-rs` (via `mirror`), which are `skipped` for a php tag — without `always()`, GitHub Actions applies the implicit "skip downstream if any transitive need is non-success" rule and skips publish-php before evaluating the explicit conditions. Same pattern the `mirror` job uses. See PR [#43](https://github.com/hop-top/.github/pull/43).
- Credentials are URL-encoded with `jq @uri` and registered with `::add-mask::` before they appear in the `$url` variable — GH's auto-masking only matches the raw secret value, not its URL-encoded form (e.g. tokens containing `+`/`/`/`=`).

## Common issues

| Problem | Cause | Fix |
|---|---|---|
| Packagist returns 404 even after the mirror has a tag | First version requires manual one-time submit | Submit once at <https://packagist.org/packages/submit>; subsequent tags auto-notify via `publish-php`. |
| Tag push runs green but Packagist shows no new version | `publish-php` job was `skipped` (pre-v0.9.1 dotgithub) OR consumer `publish.yml` doesn't forward `PACKAGIST_USERNAME` / `PACKAGIST_TOKEN` | Bump `publish.yml` to `@v0` rolling tag (already fixed at v0.9.1+). Confirm both secrets in the consumer `secrets:` block. |
| `composer install`: `Invalid version string "0.4.0-experimental.1"` | Composer's pre-release stability whitelist | Rename suffix to `alpha.N`. |
| Packagist shows `"abandoned": true` after re-notify | Packagist-side flag, not in composer.json | Unmark via Packagist web UI. |
| `parse` fails: `ecosystem=php requires enable-mirror=true` | Caller set `enable-mirror: false` for php | Set `enable-mirror: true`. |
| Workflow green, Packagist not re-indexed immediately | `PACKAGIST_USERNAME` / `PACKAGIST_TOKEN` missing in consumer secrets; `publish-php` skips notify with `::notice::` and exits 0 (intended) | Wire both secrets to trigger immediate notify, or accept the polling fallback. See [§ Packagist credentials missing: clean skip, green run](#packagist-credentials-missing-clean-skip-green-run). |

## Next steps

- [references/secrets.md](../secrets.md) — `PACKAGIST_USERNAME` / `PACKAGIST_TOKEN` reference.
- [docs/browser-playbooks.md](../../docs/browser-playbooks.md) — Packagist setup walkthroughs.
- [concepts/version-strings.md](../concepts/version-strings.md) — why Composer is stricter than npm/cargo/PyPI.
