#!/usr/bin/env bash
# Shared by catalog-admission.yml's "Verify each external pin resolves to a
# real plugin" step and scripts/test-resolve-pin-retry.sh. Kept as a
# sourceable file, not inlined in the workflow, so the retry behavior is
# unit-testable against a stubbed `gh` (issue #179 -- a single unretried
# `gh api` call failed the whole admission gate on a transient GitHub API
# error, even though the pinned content was genuinely present).

# resolve_pin SLUG MANIFEST_PATH SHA
# Retries the pin-resolution `gh api` call up to 3 attempts total (the
# initial attempt plus 2 retries), with a short linear backoff (1s, then
# 2s) between attempts. Returns 0 as soon as any attempt succeeds, 1 if
# all 3 attempts fail.
resolve_pin() {
  local slug="$1" man="$2" sha="$3" attempt
  for attempt in 1 2 3; do
    if gh api "repos/${slug}/contents/${man}?ref=${sha}" --jq '.name' >/dev/null 2>&1; then
      return 0
    fi
    [ "${attempt}" -lt 3 ] && sleep "${attempt}"
  done
  return 1
}
