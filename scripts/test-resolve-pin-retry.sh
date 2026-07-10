#!/usr/bin/env bash
# Regression test for issue #179: catalog-admission's pin-resolution step had
# no retry, so a single transient `gh api` error failed the whole admission
# gate even though the pinned content was genuinely present. This proves
# resolve_pin() (scripts/lib/resolve-pin.sh) actually retries against a
# stubbed `gh`, not just that the workflow's bash parses -- actionlint and
# ShellCheck already cover that.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091 # runtime-resolved path (SCRIPT_DIR); verified by this script's own passing run, see scripts/lib/resolve-pin.sh for the sourced file
source "${SCRIPT_DIR}/lib/resolve-pin.sh"

STUB_DIR="$(mktemp -d)"
trap 'rm -rf "${STUB_DIR}"' EXIT

# Shadows the real `gh` on PATH with a stub whose behavior is driven by a
# counter file, so each test case can script "fail N times then succeed" or
# "always fail" without touching the network.
install_stub() {
  local fail_count="$1"
  local counter_file="${STUB_DIR}/calls"
  echo 0 > "${counter_file}"
  cat > "${STUB_DIR}/gh" <<EOF
#!/usr/bin/env bash
n=\$(cat "${counter_file}")
n=\$((n + 1))
echo "\$n" > "${counter_file}"
if [ "\$n" -le ${fail_count} ]; then
  exit 1
fi
echo '{"name": ".claude-plugin/plugin.json"}'
exit 0
EOF
  chmod +x "${STUB_DIR}/gh"
  echo "${counter_file}"
}

fail=0

# Case 1: succeeds on the first attempt (no retry needed).
counter_file=$(install_stub 0)
PATH="${STUB_DIR}:${PATH}"
if PATH="${STUB_DIR}:${PATH}" resolve_pin "acme/widgets" ".claude-plugin/plugin.json" "deadbeef"; then
  calls=$(cat "${counter_file}")
  if [ "${calls}" -ne 1 ]; then
    echo "FAIL: case 1 (immediate success) expected exactly 1 call, got ${calls}"
    fail=1
  else
    echo "PASS: case 1 (immediate success, 1 call)"
  fi
else
  echo "FAIL: case 1 (immediate success) should have returned 0"
  fail=1
fi

# Case 2: fails twice, succeeds on the 3rd attempt -- proves the retry path
# actually recovers, the exact issue #179 scenario.
counter_file=$(install_stub 2)
if PATH="${STUB_DIR}:${PATH}" resolve_pin "acme/widgets" ".claude-plugin/plugin.json" "deadbeef"; then
  calls=$(cat "${counter_file}")
  if [ "${calls}" -ne 3 ]; then
    echo "FAIL: case 2 (recovers on 3rd attempt) expected exactly 3 calls, got ${calls}"
    fail=1
  else
    echo "PASS: case 2 (recovers on 3rd attempt, 3 calls)"
  fi
else
  echo "FAIL: case 2 (recovers on 3rd attempt) should have returned 0"
  fail=1
fi

# Case 3: always fails -- proves a genuinely broken pin is still rejected
# after exhausting retries, not masked indefinitely.
counter_file=$(install_stub 99)
if PATH="${STUB_DIR}:${PATH}" resolve_pin "acme/widgets" ".claude-plugin/plugin.json" "deadbeef"; then
  echo "FAIL: case 3 (always fails) should have returned 1"
  fail=1
else
  calls=$(cat "${counter_file}")
  if [ "${calls}" -ne 3 ]; then
    echo "FAIL: case 3 (always fails) expected exactly 3 attempts, got ${calls}"
    fail=1
  else
    echo "PASS: case 3 (always fails, 3 attempts then gives up)"
  fi
fi

if [ "${fail}" -ne 0 ]; then
  echo "test-resolve-pin-retry: FAILED"
  exit 1
fi
echo "test-resolve-pin-retry: all cases passed"
