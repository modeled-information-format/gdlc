---
id: 1c9a3f7e-2b6d-4e91-8a5c-7d4f9b2e6c31
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: github-pull-requests tool reference
diataxis_type: reference
---

Exhaustive listing of the 8 MCP tools registered by
`plugins/github-pull-requests/mcp-server/src/index.ts`. Types are the Zod
input schema as declared in source; `pullRequestRefSchema` is
`{ owner: string, repo: string, pullNumber: integer }`, reused by every tool
below that lists it.

## `request_review`

Request reviewers (and/or teams) on a pull request.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | string | yes |
| `repo` | string | yes |
| `pullNumber` | integer | yes |
| `reviewers` | string[] | no |
| `teamReviewers` | string[] | no |

Fails with `stale_target` if the PR is not open. Returns
`{ users: string[], teams: string[] }`.

## `list_review_requests`

List the current requested reviewers and teams on a pull request.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | string | yes |
| `repo` | string | yes |
| `pullNumber` | integer | yes |

Returns `{ users: string[], teams: string[] }`.

## `remove_review_request`

Remove requested reviewers (and/or teams) from a pull request.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | string | yes |
| `repo` | string | yes |
| `pullNumber` | integer | yes |
| `reviewers` | string[] | no |
| `teamReviewers` | string[] | no |

Returns `{ users: string[], teams: string[] }`.

## `get_linked_issues`

Find issues linked to a pull request: `closingIssuesReferences` first
(`source: closing_reference`), Timeline-API/text-parsing fallback labeled
`confidence: heuristic`.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | string | yes |
| `repo` | string | yes |
| `pullNumber` | integer | yes |

Returns `{ items: LinkedIssueResult[], sourceAttempted: LinkedIssueSource[] }`,
where each item carries `number`, `repo`, `source`
(`closing_reference`&#124;`heuristic`), `closing` (boolean), and
`alreadyTracked` (boolean — true when the target issue already carries a
`github-sdlc-planning` MIF comment block).

## `create_pull_request`

Open a pull request via the GraphQL `createPullRequest` mutation.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | string | yes |
| `repo` | string | yes |
| `title` | string | yes |
| `body` | string | no |
| `baseRefName` | string | yes |
| `headRefName` | string | yes |
| `draft` | boolean | no |

Returns `{ number: integer, url: string, nodeId: string }`. No MIF frontmatter
is attached to the PR body — a PR is an implementation artifact for a work
item, not a work item itself. Write `Fixes #N`/`Closes #N` into `body` as
plain text for a closing reference.

## `classify_pull_request`

Apply type/size/risk labels to a pull request. Size is computed automatically
from the diff; type is required, risk is optional. Same-category labels are
replaced, not accumulated.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | string | yes |
| `repo` | string | yes |
| `pullNumber` | integer | yes |
| `type` | enum: `feat`&#124;`fix`&#124;`chore`&#124;`docs`&#124;`refactor`&#124;`test`&#124;`perf` | yes |
| `risk` | enum: `low`&#124;`medium`&#124;`high` | no |

Size is bucketed from `additions + deletions` (Danger.js/PR-size-labeler
convention): `XS` (&lt;10), `S` (&lt;30), `M` (&lt;100), `L` (&lt;500), `XL`
(≥500). Returns `{ type, size, risk?, changedLines, changedFiles,
labelsApplied, labelsRemoved }`. Omitting `risk` leaves any existing
`risk:*` label untouched rather than clearing it; `type:*` and `size:*` are
always managed.

## `add_pull_request_to_project`

Add a pull request to a Projects v2 board via `addProjectV2ItemById`.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | string | yes |
| `repo` | string | yes |
| `pullNumber` | integer | yes |
| `projectOwnerLogin` | string | yes |
| `projectNumber` | integer | yes |
| `projectOwnerType` | enum: `organization`&#124;`user` | no |

Returns `{ itemId: string }`. Requires the `project` OAuth scope on classic
tokens (`assertProjectScope` runs first). Unlike planning's
`add_item_to_project`, this call is not verified idempotent here — check for
an existing item first if re-adding the same PR is possible.

## `sync_linked_issues_project_field`

For a merged pull request, set a Projects v2 field on every same-repo issue
it closes. Requires the PR to be merged; matches issues to project items by
number; closing issues in a different repo are reported in
`skippedCrossRepo`, never guessed at.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | string | yes |
| `repo` | string | yes |
| `pullNumber` | integer | yes |
| `projectOwnerLogin` | string | yes |
| `projectNumber` | integer | yes |
| `projectOwnerType` | enum: `organization`&#124;`user` | no |
| `fieldId` | string | yes |
| `value` | discriminated union, see below | yes |

`value.kind` is one of: `text` (`{ kind: 'text', text: string }`), `number`
(`{ kind: 'number', number: number }`), `date` (`{ kind: 'date', date: string }`),
`singleSelect` (`{ kind: 'singleSelect', optionId: string }`), `iteration`
(`{ kind: 'iteration', iterationId: string }`).

Fails with `not_merged` if the PR is not merged. Returns
`{ synced: {issueNumber, itemId}[], notFoundOnBoard: number[], skippedCrossRepo: number[] }`.
Known limitation: the underlying `get_project_items` call is unpaginated
(`items(first: 100)`), so a board with more than 100 items can report a
genuinely-linked issue as `notFoundOnBoard` when it is simply outside the
first page.

## Error codes

On failure, a tool returns either a structured `PrError`
(`{ error: <code>, message, ...details }` — codes: `github_api_error`,
`rate_limited`, `stale_target`, `missing_scope`, `resolve_id_failed`,
`not_merged`; see `plugins/github-pull-requests/mcp-server/src/errors.ts`)
or, for an error that isn't a `PrError` instance (an unclassified failure
that escaped typing), the generic fallback `{ error: "github_api_error",
message }`.
