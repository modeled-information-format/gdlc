---
id: b4fa4d5c-5bee-4bd9-9e11-2290a8e820c9
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-06T00:00:00Z
title: github-sdlc-planning MCP tool reference
diataxis_type: reference
---


Exhaustive listing of the 16 tools registered by
`plugins/github-sdlc-planning/mcp-server/src/index.ts`. Parameter names,
types, and required/optional status are read directly from each tool's Zod
`inputSchema`. This is a lookup document — for task-oriented walkthroughs see
[`how-to/`](../how-to/), for a learning-oriented first run see
[`tutorials/`](../tutorials/).

All tools return `{ content: [{ type: 'text', text: <JSON> }] }` on success.
On failure they return `{ isError: true, content: [{ type: 'text', text: <JSON error> }] }`,
where the JSON error body is either a structured `PlanningError`
(`{ error: <code>, message, ...details }` — codes: `limit_exceeded`,
`missing_scope`, `resolve_issue_id`, `resolve_project_id`,
`unknown_issue_type`, `rate_limited`, `github_api_error`,
`confirmation_required`, `missing_board_config`, `missing_destination`,
`repo_not_allowed`) or, for unclassified errors, `{ error:
"github_api_error", message }`. The last three codes come from the
config-driven defaulting described below (issues #82/#83) — see
[the layered config schema](../../reference/config-schema.md).

## create_issue

Create a GitHub issue via the GraphQL `createIssue` mutation, prepending a
MIF frontmatter comment block to the body before returning.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | no (both or neither of `owner`/`repo` — see below) |
| `repo` | `string` | no (both or neither of `owner`/`repo` — see below) |
| `title` | `string` | yes |
| `body` | `string` | yes |
| `labels` | `string[]` | no |
| `assignees` | `string[]` | no |
| `milestoneNumber` | `number` (int) | no |
| `issueType` | `string` | no |
| `mif` | `{ id: string, type: Initiative\|Epic\|Story\|Task\|Bug\|Feature, namespace: string }` | yes |

`owner`/`repo` default to the configured `destination.repo` when **both**
are omitted; supplying exactly one throws `missing_destination` (they're
resolved as a pair, never mixed with config field-by-field) — same for
"neither given, and no `destination.repo` configured anywhere." Whichever
`owner`/`repo` is now in play, explicit or defaulted, is checked against a
configured `targeting` allowlist, if any, throwing `repo_not_allowed` if
it's excluded. See [the layered config schema](../../reference/config-schema.md).

Returns `{ number, nodeId, url, body }` — `body` includes the prepended MIF
comment block.

## update_issue

Update an issue's title/body/state/issueType. Rejects an unknown `issueType`
(looked up against the organization's `issueTypes`, throwing
`unknown_issue_type`) before calling the API.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |
| `number` | `number` (int) | yes |
| `title` | `string` | no |
| `body` | `string` | no |
| `state` | `"open" \| "closed"` | no |
| `issueType` | `string` | no |

Returns `{ number, url }`.

## add_sub_issue

Attach a child issue to a parent via the GraphQL `addSubIssue` mutation.
Rejects with `limit_exceeded` before forwarding to GitHub if the parent
already has 100 sub-issues, or if attaching would place the hierarchy at or
past 8 nesting levels.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |
| `parentNumber` | `number` (int) | yes |
| `childNumber` | `number` (int) | yes |
| `childOwner` | `string` | no (defaults to `owner`; lets a child live in a different repo in the same org) |
| `childRepo` | `string` | no (defaults to `repo`) |
| `replaceParent` | `boolean` | no (defaults to `true`; GitHub's re-parent option) |

Returns `{ parentNodeId, childNodeId, replacedParent }`.

## list_sub_issues

List a parent issue's sub-issues with a completion summary.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |
| `parentNumber` | `number` (int) | yes |

Returns `{ total, completed, percentCompleted, items: [{ number, nodeId,
title, state }] }`.

## add_item_to_project

Add an issue to a Projects v2 board via `addProjectV2ItemById`, resolving
node IDs first. Idempotent: if the issue already has an item on the target
project (e.g. added by a native auto-add workflow), returns that item with
`existed: true` instead of creating a duplicate (see
[ADR-0003](../../decisions/adr-0003-board-status-hygiene.md)). Requires the
token to carry the `project` scope (classic OAuth-scoped tokens only —
throws `missing_scope` if absent; App installation tokens and fine-grained
PATs skip this pre-check).

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |
| `issueNumber` | `number` (int) | yes |
| `projectOwnerLogin` | `string` | no (both or neither of `projectOwnerLogin`/`projectNumber` — see below) |
| `projectNumber` | `number` (int) | no (both or neither — see below) |
| `projectOwnerType` | `"organization" \| "user"` | no (defaults to `organization`) |

`projectOwnerLogin`/`projectNumber` default to the configured `board:`
mapping when **both** are omitted; supplying exactly one, or omitting both
with no mapping configured anywhere, throws `missing_board_config` (issues
#82/#83 — see [the layered config schema](../../reference/config-schema.md)).

Returns `{ itemId, existed }`.

## set_field_value

Set a Projects v2 item field value via `updateProjectV2ItemFieldValue`.
Requires the `project` scope (same check as `add_item_to_project`).

| Parameter | Type | Required |
| --- | --- | --- |
| `projectOwnerLogin` | `string` | no (both or neither of `projectOwnerLogin`/`projectNumber` — see `add_item_to_project`) |
| `projectNumber` | `number` (int) | no (both or neither — see `add_item_to_project`) |
| `projectOwnerType` | `"organization" \| "user"` | no (defaults to `organization`) |
| `itemId` | `string` | yes (project item node ID, from `add_item_to_project` or `get_project_items`) |
| `fieldId` | `string` | yes (project field node ID) |
| `value` | discriminated union on `kind`, see below | yes |

`value` shapes (`kind` selects the variant):

| `kind` | Additional field |
| --- | --- |
| `text` | `text: string` |
| `number` | `number: number` |
| `date` | `date: string` |
| `singleSelect` | `optionId: string` |
| `iteration` | `iterationId: string` |

Returns `{ itemId }`.

## get_project_items

List a Projects v2 board's items and their field values.

| Parameter | Type | Required |
| --- | --- | --- |
| `projectOwnerLogin` | `string` | no (both or neither of `projectOwnerLogin`/`projectNumber` — see `add_item_to_project`) |
| `projectNumber` | `number` (int) | no (both or neither — see `add_item_to_project`) |
| `projectOwnerType` | `"organization" \| "user"` | no (defaults to `organization`) |

Returns `{ items: [{ id, title, number, repo, fieldValues: [{ fieldName,
text?, number?, date?, optionName? }] }] }`. `number` and `repo` are `null`
for a `DraftIssue`, which has neither. `repo` is `owner/repo`
(`nameWithOwner`) — needed because a board can hold items from multiple
repos, so `number` alone is not a safe join key.

## create_milestone

Create a milestone via the REST milestones endpoint (milestones are
REST-only — GraphQL exposes them read-only).

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |
| `title` | `string` | yes |
| `description` | `string` | no |
| `dueOn` | `string` | no |
| `state` | `"open" \| "closed"` | no |

Returns `{ number, title, url, dueOn }`.

## list_milestones

List a repository's milestones.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |
| `state` | `"open" \| "closed" \| "all"` | no (defaults to `open`) |

Returns `MilestoneResult[]`, each `{ number, title, url, dueOn }`.

## assign_milestone

Assign (or unassign, with `null`) a milestone to an issue.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |
| `issueNumber` | `number` (int) | yes |
| `milestoneNumber` | `number` (int) or `null` | yes |

Returns `{ issueNumber, milestoneNumber }`.

## create_discussion

Create a Discussion via the GraphQL `createDiscussion` mutation. Resolves
`categoryName` against the repository's discussion categories, throwing
`github_api_error` (with the list of available category names in `details`)
if no match is found.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |
| `categoryName` | `string` | yes |
| `title` | `string` | yes |
| `body` | `string` | yes |

Returns `{ id, number, title, url }`.

## list_discussions

List a repository's discussions (first 50).

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |

Returns `DiscussionSummary[]`, each `{ id, number, title, url, category }`.

## format_mif_issue_body

Prepend a MIF L1 frontmatter comment block (`mif-id`/`mif-type`/`mif-ns`) to
a Markdown body. Pure function — no GitHub API call.

| Parameter | Type | Required |
| --- | --- | --- |
| `meta` | `{ id: string, type: Initiative\|Epic\|Story\|Task\|Bug\|Feature, namespace: string }` | yes |
| `body` | `string` | yes |

Returns the formatted body as a plain string (JSON-encoded in the tool
result). The `id` is the slug portion; the emitted comment expands it to
`urn:mif:concept:{namespace}:{id}`.

## parse_mif_issue_body

Parse an issue body's MIF frontmatter block, if present. Pure function — no
GitHub API call.

| Parameter | Type | Required |
| --- | --- | --- |
| `raw` | `string` | yes |

Returns `{ meta: { id, type, namespace } | null, body }`. `meta` is `null`
(and `body` is the input unchanged) when any of the three comment lines is
missing.

## get_session_context

Fetch open milestones and, optionally, Projects v2 board state — the
non-Claude-Code equivalent of the `SessionStart` hook (`hooks/session-start.mjs`).

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |
| `projectOwnerLogin` | `string` | no |
| `projectNumber` | `number` (int) | no |
| `projectOwnerType` | `"organization" \| "user"` | no |

`projectOwnerLogin`/`projectNumber` default to the configured `board:`
mapping when both are omitted (same rule as `add_item_to_project`), but
unlike that tool this one never throws when nothing resolves — an
unconfigured board is a valid state here, not an error.

Returns `{ openMilestones: [{ number, title, url, dueOn }], projectBoard:
<get_project_items result> | null }`. `projectBoard` is `null` unless a
complete `projectOwnerLogin`/`projectNumber` pair resolves, explicit or
configured.

## get_agent_capabilities

Describe this MCP server's tool surface and MIF conformance level — feature
detection for any MCP host. Takes no parameters.

| Parameter | Type | Required |
| --- | --- | --- |

Returns `{ tools: string[] /* all 16 tool names */, mifConformance: "L1",
hooksSupported: false }`. `hooksSupported: false` documents that this MCP
layer never depends on host lifecycle hooks — a caller on a hook-less host
should treat MIF-body validation and session bootstrap as its own
responsibility via `format_mif_issue_body`/`parse_mif_issue_body` and
`get_session_context`, rather than assuming a hook already ran.
