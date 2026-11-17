# Configure Dependabot for a hop-top repo

## Use this when

A repo is new, or has no `.github/dependabot.yml`, or has one without cooldown.

## Result

Version updates wait 14 days after a release and arrive as one PR at a time across every ecosystem; while that PR is open, Dependabot updates it instead of opening another. Security updates arrive immediately, one grouped PR per ecosystem.

## Policy

| Kind | Delay | Why |
|---|---|---|
| Version updates | 14 days (`cooldown.default-days: 14`) on every `updates` entry | Fresh releases get yanked, hijacked or fixed; 14 days matches the org dependency age gate |
| Security updates | 0 days | `cooldown` applies to version updates only, never to security updates |

| Kind | PRs open at once | How |
|---|---|---|
| Version updates | 1, all ecosystems together | top-level `multi-ecosystem-groups.dependencies` with `open-pull-requests-limit: 1`; every `updates` entry sets `multi-ecosystem-group: dependencies` and `patterns: ["*"]` |
| Security updates | 1 per ecosystem | `groups.<eco>-security` with `applies-to: security-updates`; security updates cannot join a multi-ecosystem group, and GitHub caps them at 10 open PRs |

## Steps

### 1. Copy the template

```sh
mkdir -p .github
curl -fsSL https://raw.githubusercontent.com/hop-top/.github/main/templates/dependabot.yml -o .github/dependabot.yml
```

Keep the ecosystems the repo uses; delete the rest. A `directories` entry that does not exist fails the run. List every manifest directory under `directories`. `schedule`, `commit-message` and the PR limit live on the multi-ecosystem group, never on an `updates` entry (a group-only key on an entry is a configuration error).

Validate before committing:

```sh
curl -fsSL https://json.schemastore.org/dependabot-2.0.json -o /tmp/dependabot-schema.json
uvx check-jsonschema --schemafile /tmp/dependabot-schema.json .github/dependabot.yml
```

### 2. Enable security updates (repo setting)

The config alone does not turn on security updates. Enable alerts and security updates:

```sh
scripts/enable-dependabot-security.sh <org>/<repo>
# or by hand
gh api -X PUT repos/<org>/<repo>/vulnerability-alerts
gh api -X PUT repos/<org>/<repo>/automated-security-fixes
```

Idempotent; safe on existing repos. Verify: `gh api repos/<org>/<repo>/automated-security-fixes --jq .enabled` prints `true`.

### 3. Existing repo with a config

Replace it with the template's shape (multi-ecosystem group, `cooldown: { default-days: 14 }` on every entry, one security group per ecosystem), keeping its ecosystems, directories and `ignore` rules, then run step 2. Open per-dependency PRs are folded into the group PR on the next run or can be closed.

## See also

- [Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)
- [workflow-lockfiles.md](workflow-lockfiles.md)
