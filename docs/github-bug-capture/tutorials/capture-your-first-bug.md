---
id: ceed1a05-5abe-4a80-a567-f4daf2952427
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: "Tutorial: capture your first bug end to end"
diataxis_type: tutorial
---

This tutorial walks through the full arc of `github-bug-capture`'s Layer 1
tools on one made-up issue, from checking for duplicates to setting its
severity to confirming its lifecycle state. By the end you will have driven
all seven MCP tools at least once. It assumes `github-bug-capture` is
installed (dependency resolution also installs `github-pull-requests` and
`github-sdlc-planning`, per
[ADR-0002](../../decisions/adr-0002-pr-issue-linkage-ownership.md)), that
you have a GitHub token with the `project` OAuth scope
(`gh auth login --scopes project` for a classic token), and that you know
the `owner`/`repo` of a sandbox repository you can create issues in, plus
the `projectOwnerLogin`/`projectNumber` of a Projects v2 board attached to
it.

We'll use a fictional example throughout: a crash you just hit locally —
"Save button crashes when the filename contains a slash" — in a repo we'll
call `octo-org/widget-app`, with a triage board at `octo-org` project `7`.

## 1. Check what this server can do

Before anything else, ask the server to describe itself:

```text
get_agent_capabilities
```

You should get back a JSON object listing all seven tool names, the MIF
conformance level (`L1`), and `composesWith: ["github-pull-requests",
"github-sdlc-planning"]`. This confirms the server is reachable and tells
you, without reading any source, which sibling plugins it expects to be
installed alongside it.

## 2. Check for duplicates before filing

You don't want to file a second issue for a crash someone already reported.
Search first:

```text
search_similar_issues {
  owner: "octo-org",
  repo: "widget-app",
  query: "crash save filename slash"
}
```

This runs a plain keyword search against GitHub's `search/issues` REST
endpoint — not AI similarity — and returns a `candidates` array with
`number`, `title`, `state`, and `htmlUrl` for each match, plus a
`totalCount`. Read through the candidates. For this tutorial, assume none of
them are a real match and you decide to file a new issue.

(Filing the issue itself is not a `github-bug-capture` tool — that's
`create_issue` in `github-sdlc-planning`, consumed the same way this plugin
consumes PR linkage from `github-pull-requests`. For this tutorial, assume
you've already filed the issue through that tool, or through the plugin's
`file-bug` skill if you have the `triage-skills` pack enabled, and it came
back as issue number `142`.)

## 3. Provision the Severity field once per board

Before you can set a severity on any issue, the board needs a `Severity`
single-select field. This only needs to happen once per board — run it now
to see the idempotent behavior:

```text
ensure_severity_field {
  projectOwnerLogin: "octo-org",
  projectNumber: 7
}
```

The first time you run this against a given board, it creates the field
with options `Critical`/`High`/`Medium`/`Low` and returns
`{ fieldId, created: true, options }`. Run the exact same call again — you
should get `created: false` back, with the same `fieldId` and `options`,
and nothing on the board changes. That idempotence is what makes this call
safe to include in setup scripts without a guard.

## 4. Set the severity

A crash on save is a real user-facing defect but not data loss — call it
`High`:

```text
set_severity {
  owner: "octo-org",
  repo: "widget-app",
  issueNumber: 142,
  projectOwnerLogin: "octo-org",
  projectNumber: 7,
  severity: "High"
}
```

This requires issue `142` to already be an item on project `7` — if it
isn't yet (native Projects v2 auto-add workflows usually place it there
within moments of filing, or a caller adds it explicitly), you'll get a
typed `issue_not_on_board`-shaped failure instead of a silent no-op. Retry
once auto-add has caught up.

## 5. Check the lifecycle state

Now check where the issue stands, combining GitHub's native open/closed
state with whatever the board's `Status` field says:

```text
get_lifecycle_state {
  owner: "octo-org",
  repo: "widget-app",
  issueNumber: 142,
  projectOwnerLogin: "octo-org",
  projectNumber: 7
}
```

You should see `{ issueNumber: 142, nativeState: "open", onBoard: true,
status: "Todo" }` or similar — the exact `status` string depends on
whatever your board's native Projects v2 workflows set on add. This call
never errors just because a Status value is missing; it reports `status:
null` instead.

## 6. Move it forward, then close it

Once the fix is in progress and later merged, move the board's Status
forward. As a stand-in for a real fix landing, set the status straight to
whatever your board calls its terminal state (commonly `"Done"`) and let
the tool close the issue in the same call:

```text
set_lifecycle_state {
  owner: "octo-org",
  repo: "widget-app",
  issueNumber: 142,
  projectOwnerLogin: "octo-org",
  projectNumber: 7,
  status: "Done",
  closeIfDone: true
}
```

`status` must match an existing option name on the board's `Status` field
exactly — if your board uses different labels, use one of those instead.
Run `get_lifecycle_state` again afterward and confirm `nativeState` is now
`"closed"` and `status` reflects the value you set.

## 7. Close a lookalike as a duplicate

To see the last tool, imagine a second report comes in for the same crash
as issue `150`. Instead of triaging it independently, close it pointing back
at the original:

```text
close_as_duplicate {
  owner: "octo-org",
  repo: "widget-app",
  issueNumber: 150,
  duplicateOfNumber: 142
}
```

This closes issue `150` with `state_reason: "duplicate"` and posts a
comment on it linking to `#142`. Check the `commentUrl` in the response to
see the comment GitHub created.

## What you've done

You've now exercised every tool `github-bug-capture` registers: capability
detection, dedup search, idempotent field provisioning, severity setting,
lifecycle reads and writes, and duplicate closing. For the exact input
schema of each tool, see [reference/tools.md](../reference/tools.md). For a
task-first recipe on any one of them, see the matching file under
[how-to/](../how-to/).
