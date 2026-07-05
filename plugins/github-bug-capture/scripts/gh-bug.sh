#!/usr/bin/env bash
# gh-bug.sh — thin gh CLI affordance for the bug issue lifecycle (ADR-0001).
#
# Shell function library wrapping `gh issue ...` with this plugin's label and
# body conventions so any operator or CI job can drive the full bug lifecycle
# (create/edit/close/list) with no AI assistant and no MCP runtime present.
#
# Deliberately thin: argument shaping only. No retry, no pacing, no dedup —
# that business logic lives once, in the MCP server (mcp-server/src/). Bulk
# or automated operations belong there or in the Actions IssueOps templates
# (workflows/).
#
# Usage: source this file, then call the functions. Requires gh (authenticated)
# and bash 3.2+.
#
#   source scripts/gh-bug.sh
#   bug_create --title "Crash on save" --body "steps..." --severity high \
#     --ns myproject --id crash-on-save --repo owner/repo
#   bug_edit 42 --severity critical --repo owner/repo
#   bug_close 42 --comment "fixed in #43" --repo owner/repo
#   bug_list --severity high --json number,title --repo owner/repo
#
# Conventions applied:
#   - labels: `bug` plus exactly one `severity:<critical|high|medium|low>`
#   - bug_create prepends the MIF L1 comment block (mif-id / mif-type: Bug /
#     mif-ns) to the body, matching the MCP server's formatMifIssueBody
#   - --json and every unrecognized flag pass through to gh unchanged

BUG_SEVERITY_LEVELS="critical high medium low"

# _bug_valid_severity <level> — 0 iff <level> is one of the four levels.
_bug_valid_severity() {
  case " ${BUG_SEVERITY_LEVELS} " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# _bug_other_severity_labels <level> — the severity:* labels for every level
# except <level>, comma-separated (for bug_edit label replacement).
_bug_other_severity_labels() {
  local level out=''
  for level in ${BUG_SEVERITY_LEVELS}; do
    if [ "${level}" != "$1" ]; then
      out="${out:+${out},}severity:${level}"
    fi
  done
  printf '%s' "${out}"
}

# bug_create --title <t> --body <b> --severity <level> --ns <namespace> --id <slug>
#            [--repo <owner/repo>] [extra gh flags...]
# Creates a bug issue: MIF L1 comment block prepended to the body, labels
# `bug` + `severity:<level>` applied. Extra flags pass through to
# `gh issue create` (e.g. --assignee, --project, --web).
bug_create() {
  local title='' body='' severity='' ns='' slug=''
  local -a passthrough=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --title) title="$2"; shift 2 ;;
      --body) body="$2"; shift 2 ;;
      --severity) severity="$2"; shift 2 ;;
      --ns) ns="$2"; shift 2 ;;
      --id) slug="$2"; shift 2 ;;
      *) passthrough+=("$1"); shift ;;
    esac
  done
  if [ -z "${title}" ] || [ -z "${severity}" ] || [ -z "${ns}" ] || [ -z "${slug}" ]; then
    echo "bug_create: --title, --severity, --ns, and --id are required" >&2
    return 2
  fi
  if ! _bug_valid_severity "${severity}"; then
    echo "bug_create: --severity must be one of: ${BUG_SEVERITY_LEVELS}" >&2
    return 2
  fi
  local mif_body
  mif_body="$(printf '<!-- mif-id: urn:mif:concept:%s:%s -->\n<!-- mif-type: Bug -->\n<!-- mif-ns: %s -->\n%s' \
    "${ns}" "${slug}" "${ns}" "${body}")"
  gh issue create --title "${title}" --body "${mif_body}" \
    --label bug --label "severity:${severity}" ${passthrough[@]+"${passthrough[@]}"}
}

# bug_edit <number> [--severity <level>] [--repo <owner/repo>] [extra gh flags...]
# Edits a bug issue. --severity <level> swaps the severity:* label (adds the
# new one, removes the other three). Everything else passes through to
# `gh issue edit` (e.g. --title, --body, --add-assignee).
bug_edit() {
  if [ $# -eq 0 ]; then
    echo "bug_edit: usage: bug_edit <number> [--severity <level>] [gh flags...]" >&2
    return 2
  fi
  local number="$1"
  shift
  local severity=''
  local -a passthrough=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --severity) severity="$2"; shift 2 ;;
      *) passthrough+=("$1"); shift ;;
    esac
  done
  local -a severity_args=()
  if [ -n "${severity}" ]; then
    if ! _bug_valid_severity "${severity}"; then
      echo "bug_edit: --severity must be one of: ${BUG_SEVERITY_LEVELS}" >&2
      return 2
    fi
    severity_args=(--add-label "severity:${severity}" --remove-label "$(_bug_other_severity_labels "${severity}")")
  fi
  gh issue edit "${number}" ${severity_args[@]+"${severity_args[@]}"} ${passthrough[@]+"${passthrough[@]}"}
}

# bug_close <number> [--repo <owner/repo>] [extra gh flags...]
# Closes a bug issue. Extra flags pass through to `gh issue close`
# (e.g. --comment, --reason "not planned").
bug_close() {
  if [ $# -eq 0 ]; then
    echo "bug_close: usage: bug_close <number> [gh flags...]" >&2
    return 2
  fi
  local number="$1"
  shift
  gh issue close "${number}" "$@"
}

# bug_list [--severity <level>] [--repo <owner/repo>] [--json <fields>] [extra gh flags...]
# Lists bug issues (label `bug`), optionally narrowed to one severity level.
# --json and everything else pass through to `gh issue list`.
bug_list() {
  local severity=''
  local -a passthrough=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --severity) severity="$2"; shift 2 ;;
      *) passthrough+=("$1"); shift ;;
    esac
  done
  local -a severity_args=()
  if [ -n "${severity}" ]; then
    if ! _bug_valid_severity "${severity}"; then
      echo "bug_list: --severity must be one of: ${BUG_SEVERITY_LEVELS}" >&2
      return 2
    fi
    severity_args=(--label "severity:${severity}")
  fi
  gh issue list --label bug ${severity_args[@]+"${severity_args[@]}"} ${passthrough[@]+"${passthrough[@]}"}
}
