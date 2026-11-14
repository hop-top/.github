# Configure Dependabot for a hop-top repo

## Use this when

A repo is new, or has no `.github/dependabot.yml`, or has one without cooldown.

## Result

Version updates wait 14 days after a release. Security updates arrive immediately. One PR per dependency across directories.

## Policy

| Kind | Delay | Why |
|---|---|---|
| Version updates | 14 days (`cooldown.default-days: 14`) on every `updates` entry | Fresh releases get yanked, hijacked or fixed; 14 days matches the org dependency age gate |
| Security updates | 0 days | `cooldown` applies to version updates only, never to security updates |

## Steps

### 1. Copy the template

```sh
mkdir -p .github
curl -fsSL https://raw.githubusercontent.com/hop-top/.github/main/templates/dependabot.yml -o .github/dependabot.yml
```

Keep the ecosystems the repo uses; delete the rest. A `directories` entry that does not exist fails the run. List every manifest directory under `directories`; `group-by: dependency-name` then opens one PR per dependency across them.

Each ecosystem has two groups: a version group (`patterns: ["*"]`, `group-by: dependency-name`) and a security group (`applies-to: security-updates`), so one advisory is one PR.

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

Add `cooldown: { default-days: 14 }` to every `updates` entry and the security group, then run step 2.

## See also

- [Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)
- [workflow-lockfiles.md](workflow-lockfiles.md)
