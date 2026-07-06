---
id: f06237a1-2144-4d8f-b83d-7853a944a6d4
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: github-bug-capture MCP tool reference
diataxis_type: reference
---

The `github-bug-capture` MCP server (`plugins/github-bug-capture/mcp-server`)
registers seven tools. This page lists each exactly as declared in
`src/index.ts`: its name, its one-line purpose, and its input schema. It does
not explain when or why to use them — see [how-to](../how-to/) for
task-oriented recipes and [explanation](../explanation/) for the
architecture behind them.

All tools return `{ content: [{ type: 'text', text: <JSON> }] }` on success.
On failure, structured `BugCaptureError`s return
`{ isError: true, content: [{ type: 'text', text: <JSON error> }] }` with an
`error` code from the set below; unstructured GitHub API failures return
`{ error: 'github_api_error', message }`.

## `get_agent_capabilities`

Describe this MCP server's tool surface, MIF conformance level, and the
sibling plugins it composes with — feature detection for any MCP host.

**Input:** none (`{}`).

**Returns:** `{ plugin, tools, mifConformance, composesWith, hooksSupported }`
— see `src/capabilities.ts`.

## `ensure_severity_field`

Ensure the triage board (a Projects v2 board) has a `Severity` single-select
field with options Critical/High/Medium/Low, creating it if absent.
Idempotent: an existing field is returned with its option IDs without
mutating.

**Input:**

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `projectOwnerLogin` | `string` | yes | Org or user login that owns the Projects v2 board. |
| `projectNumber` | `number` (int) | yes | The board's project number. |
| `projectOwnerType` | `'organization' \| 'user'` | no | Defaults to `'organization'` if omitted. |

## `set_severity`

Set an issue's Severity single-select value on the triage board. Fails with
a typed error if the issue is not on the board or the Severity field/option
is missing.

**Input:**

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `owner` | `string` | yes | Repo owner. |
| `repo` | `string` | yes | Repo name. |
| `issueNumber` | `number` (int) | yes | |
| `projectOwnerLogin` | `string` | yes | |
| `projectNumber` | `number` (int) | yes | |
| `projectOwnerType` | `'organization' \| 'user'` | no | Defaults to `'organization'`. |
| `severity` | `'Critical' \| 'High' \| 'Medium' \| 'Low'` | yes | One of `SEVERITY_LEVELS`. |

## `get_lifecycle_state`

Read an issue's lifecycle state: native GitHub state (open/closed) plus the
triage board's Status single-select value, if the issue is on that board.
Never errors when the issue is off the board or the Status field/value is
absent — both report as a null status.

**Input:**

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `owner` | `string` | yes | |
| `repo` | `string` | yes | |
| `issueNumber` | `number` (int) | yes | |
| `projectOwnerLogin` | `string` | yes | |
| `projectNumber` | `number` (int) | yes | |
| `projectOwnerType` | `'organization' \| 'user'` | no | Defaults to `'organization'`. |

**Returns:** `{ issueNumber, nativeState: 'open'|'closed', onBoard: boolean, status: string | null }`.

## `set_lifecycle_state`

Set an issue's Status single-select value on the triage board via the
project's existing `Status` field (looked up by name, never created),
optionally closing the underlying issue afterward when `closeIfDone` is
true. Fails with a typed error if the issue is not on the board or the
Status field/option is missing.

**Input:**

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `owner` | `string` | yes | |
| `repo` | `string` | yes | |
| `issueNumber` | `number` (int) | yes | |
| `projectOwnerLogin` | `string` | yes | |
| `projectNumber` | `number` (int) | yes | |
| `projectOwnerType` | `'organization' \| 'user'` | no | Defaults to `'organization'`. |
| `status` | `string` | yes | Must match an existing option name on the board's `Status` field exactly. |
| `closeIfDone` | `boolean` | no | Closes the issue via REST PATCH after the Status value is set. |

## `search_similar_issues`

Find candidate duplicate issues via the REST `search/issues` endpoint (plain
keyword search, not AI/embedding similarity — out of scope per the research
report).

**Input:**

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `owner` | `string` | yes | |
| `repo` | `string` | yes | |
| `query` | `string` | yes | Free-text search terms, combined server-side with `repo:<owner>/<repo> is:issue`. |

**Returns:** `{ candidates: [{ number, title, state, htmlUrl }], totalCount }`.

## `close_as_duplicate`

Close an issue with `state_reason: duplicate` via the REST PATCH endpoint,
and post a comment linking to the canonical issue it duplicates.

**Input:**

| Parameter | Type | Required | Notes |
| --- | --- | --- | --- |
| `owner` | `string` | yes | |
| `repo` | `string` | yes | |
| `issueNumber` | `number` (int) | yes | The issue being closed. |
| `duplicateOfNumber` | `number` (int) | yes | The canonical issue number referenced in the close comment. |

**Returns:** `{ issueNumber, duplicateOfNumber, state: 'closed', stateReason: 'duplicate', commentUrl }`.

## Error codes

Structured failures (`BugCaptureError`, `src/errors.ts`) carry one of:

| Code | Meaning |
| --- | --- |
| `github_api_error` | Unstructured GitHub API failure (fallback). |
| `missing_scope` | The token lacks the `project` OAuth scope for a Projects v2 mutation. |
| `resolve_project_id` | The `projectOwnerLogin`/`projectNumber`/`projectOwnerType` did not resolve to a project node ID. |
| `resolve_issue_id` | The `owner`/`repo`/`issueNumber` did not resolve to an existing issue. |
| `issue_not_on_board` | The issue is not an item on the target project. |
| `field_type_conflict` | A field with the expected name exists but is not a single-select field. |
| `missing_field` | The expected single-select field (`Severity` or `Status`) does not exist on the board. |
| `missing_option` | The field exists but has no option matching the requested value. |
