#!/usr/bin/env bash
# Apply the versioned branch rulesets in templates/rulesets/ to a repo.
# Org-level rulesets need a paid plan, so each repo gets its own copy.
# Idempotent: matches by ruleset name; PUT when it exists, POST when not.
#
# Usage: scripts/apply-rulesets.sh [options] <org>/<repo>
#   -n, --dry-run          print the diff per ruleset; write nothing
#   --checks <a,b,...>     replace required status check contexts
#   --add-check <context>  append a required status check (repeatable)
#   --bypass-user <id>     add a user bypass actor, mode always (repeatable)
#   --only <name>          apply one template (file stem); repeatable
# Reference: references/how-to/branch-rulesets.md
set -euo pipefail

err() { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*" >&2; }

usage() {
  sed -n '/^# Usage/,/^# Reference/p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

dry=0
checks=""
add_checks=()
bypass=()
only=()
repo=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -n|--dry-run) dry=1 ;;
    --checks) checks="${2:?--checks needs a value}"; shift ;;
    --add-check) add_checks+=("${2:?--add-check needs a value}"); shift ;;
    --bypass-user) bypass+=("${2:?--bypass-user needs an id}"); shift ;;
    --only) only+=("${2:?--only needs a name}"); shift ;;
    -h|--help) usage ;;
    -*) err "unknown option: $1" ;;
    *) [ -z "$repo" ] || err "one repo only"; repo="$1" ;;
  esac
  shift
done
[[ "$repo" =~ ^[^/]+/[^/]+$ ]] || usage

command -v gh >/dev/null || err "gh not found"
command -v jq >/dev/null || err "jq not found"

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../templates/rulesets" && pwd)"

# Keep only the fields the API accepts and returns stably, for diffing.
# Drop server-added defaults; sort order-insensitive lists.
norm='{name, target, enforcement, bypass_actors, conditions, rules}
  | del(.rules[].parameters? | select(. != null)
      | .dismissal_restriction, .require_extra_approval_for_unattributed_changes, .required_reviewers)
  | .conditions.ref_name.include |= sort
  | (.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks) |= sort_by(.context)'

existing="$(gh api --paginate "repos/${repo}/rulesets" --jq '.[] | [.id, .name] | @tsv')"

for tpl in "$dir"/*.json; do
  stem="$(basename "$tpl" .json)"
  if [ "${#only[@]}" -gt 0 ] && ! printf '%s\n' "${only[@]}" | grep -qx "$stem"; then
    continue
  fi

  want="$(jq -S \
    --arg checks "$checks" \
    --argjson add "$(printf '%s\n' ${add_checks[@]+"${add_checks[@]}"} | jq -R . | jq -s 'map(select(. != ""))')" \
    --argjson byp "$(printf '%s\n' ${bypass[@]+"${bypass[@]}"} | jq -R . | jq -s 'map(select(. != "") | {actor_id: tonumber, actor_type: "User", bypass_mode: "always"})')" \
    "$norm"'
    | (.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks) |=
        ( (if $checks != "" then ($checks | split(",") | map({context: ., integration_id: 15368})) else . end)
          + ($add | map({context: ., integration_id: 15368})) )
    | if $byp != [] then .bypass_actors += $byp else . end' "$tpl")"

  want="$(jq -S "$norm" <<<"$want")"
  name="$(jq -r .name <<<"$want")"
  id="$(awk -F'\t' -v n="$name" '$2 == n {print $1}' <<<"$existing" | head -n1)"

  if [ -n "$id" ]; then
    have="$(gh api "repos/${repo}/rulesets/${id}" | jq -S "$norm")"
    if [ "$have" = "$want" ]; then
      info "${repo}: ${name}: up to date (id ${id})"
      continue
    fi
    info "${repo}: ${name}: UPDATE (id ${id})"
    diff -u <(printf '%s\n' "$have") <(printf '%s\n' "$want") --label "current" --label "desired" || true
    [ "$dry" -eq 1 ] || gh api -X PUT "repos/${repo}/rulesets/${id}" --input - <<<"$want" >/dev/null
  else
    info "${repo}: ${name}: CREATE"
    [ "$dry" -eq 1 ] && printf '%s\n' "$want" | sed 's/^/+ /'
    [ "$dry" -eq 1 ] || gh api -X POST "repos/${repo}/rulesets" --input - <<<"$want" >/dev/null
  fi
done
[ "$dry" -eq 0 ] || info "dry run: nothing written"
