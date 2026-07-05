---
title: "Rely on Native Projects v2 Workflows for Status Hygiene; Add a Hook Only for the In-Progress Gap"
description: "All eleven built-in Projects v2 workflows are already enabled on this org project, covering Todo-on-add and Done-on-close/merge. The remaining gap, marking In Progress before a PR exists, is closed with a narrow hook rather than custom Actions automation."
type: adr
conceptType: semantic
x-ontology:
  id: mif-docs
  version: "1.0.0"
  entity_type: decision-record
category: process
tags:
  - adr
  - projects-v2
  - automation
  - github-sdlc-planning
  - hooks
status: proposed
created: 2026-07-05
updated: 2026-07-05
author: MIF Maintainers
project: gdlc
technologies:
  - github-projects-v2
  - github-graphql
  - claude-code-hooks
audience:
  - developers
  - maintainers
related: []
---

# ADR-0003: Rely on Native Projects v2 Workflows for Status Hygiene; Add a Hook Only for the In-Progress Gap

## Status

Proposed

## Context

### Background and Problem Statement

During a multi-PR campaign against this org's Projects v2 board (project #1),
issue Status fields were set by hand through the `github-sdlc-planning`
plugin's `set_field_value` MCP tool: Todo when an issue was filed, In
Progress when work began, with the intent to set Done once the closing PR
merges. Partway through, the board was found to already carry board items
whose Status did not match anything any tool call in the session had set:
one item showed In Progress and another showed Done while its closing PR
was still open, both attributed to the same account the session's own token
authenticates as, at timestamps the session's own tool-call log does not
account for.

Investigating found the underlying cause: this org project has all eleven
of GitHub's built-in Projects v2 workflows enabled (`Auto-add to project`,
`Auto-add sub-issues to project`, `Item added to project`, `Item closed`,
`Item reopened`, `Pull request linked to issue`, `Pull request merged`,
`Code review approved`, `Code changes requested`, `Auto-close issue`,
`Auto-archive items`, confirmed via the `ProjectV2.workflows` GraphQL
field, `enabled: true` on every one). Two consequences follow. First, the
same issue was being added to the board twice: once by `Auto-add to
project`/`Auto-add sub-issues to project` firing the moment the issue was
created, and a second time by the session's own explicit
`add_item_to_project` call moments later, since `addProjectV2ItemById` has
no idempotency key and happily creates a duplicate item for content already
on the board. Second, at least part of the unexplained status drift is
plausibly this same native automation moving a board item's Status when a
PR referencing it is opened, closed, or merged, running concurrently with
and independently of any manual `set_field_value` call the session made
against a different (often the wrong, duplicate) item.

### Current Limitations

1. **Manual status-setting duplicates work the platform already does.**
   `Item added to project`, `Item closed`, and `Pull request merged` cover
   Todo-on-add and Done-on-close-or-merge natively; a plugin or hook that
   also sets these transitions by hand is redundant at best.
2. **Manual calls can target the wrong item when duplicates exist.** Native
   auto-add and an explicit `add_item_to_project` call can each create a
   separate item for the same issue; a subsequent `set_field_value` against
   one does not affect the other, and nothing surfaces the mismatch.
3. **No native signal exists for "work has begun."** GitHub's built-in
   workflows react to the item being added, closed, reopened, or linked to
   a PR; there is no built-in transition for "an agent or contributor
   started working on this issue" before any PR exists to link.
4. **No Claude Code hook currently addresses any of this.**
   `github-sdlc-planning`'s two hooks (`validate-mif.mjs`, MIF frontmatter
   conformance; `confirm-mutation.mjs`, a confirmation prompt before a board
   mutation) do not watch for or nudge a status transition of any kind.

## Decision Drivers

### Primary Decision Drivers

1. **No duplicated automation.** When GitHub's own Projects v2 workflow
   already performs a status transition, this org's tooling shall not
   re-implement or race against it with a manual mutation.
2. **No silent duplicate board items.** Adding an issue to a project via
   the MCP tool shall not create a second item when the issue is already
   on the board through native auto-add.
3. **The in-progress gap shall be closed.** An issue that a contributor or
   agent has started active work on, with no PR yet open, shall be
   visible as In Progress on the board without requiring a human to
   remember to drag the card.

### Secondary Decision Drivers

1. **Minimal new surface.** Whatever closes the in-progress gap should be
   the smallest addition that does the job, not a general-purpose
   workflow engine.
2. **Auditable.** Whatever sets In Progress should leave a clear trace of
   why (which tool call, which issue) rather than an unexplained status
   change like the ones this ADR investigates.

## Considered Options

### Option 1: Custom GitHub Actions workflow reacting to issue/PR events

**Description**: A repo-level Actions workflow on `issues` and
`pull_request` events that mints a token and calls the Projects v2 GraphQL
API directly to set Status, replacing reliance on the built-in workflows
entirely.

**Technical Characteristics**: Full control over transition logic and
target status values; requires its own token-minting, permission scoping,
and testing.

**Advantages**: Works identically regardless of which MCP tool or UI
action created the PR or issue; not tied to Claude Code being in the loop.

**Disadvantages**: Duplicates functionality the platform already provides
for every transition except in-progress; adds a new maintained component
whose only job partially overlaps with a toggle already enabled in the
project's settings.

**Disqualifying Factor**: violates the no-duplicated-automation driver for
the majority of the transitions it would handle; the org project already
has this coverage switched on.

**Risk Assessment**:

- **Technical Risk**: Medium. A custom implementation can drift from or
  conflict with the native workflows it overlaps, as this investigation's
  own duplicate-item and unexplained-status findings demonstrate.
- **Schedule Risk**: Medium. New workflow, new token/permission surface,
  new tests.
- **Ecosystem Risk**: Low.

### Option 2: Rely on native workflows for closed/merged/added; add a narrow hook for in-progress only

**Description**: Do nothing new for Todo-on-add, Done-on-close, and
Done-on-merge; the native workflows already listed above cover them.
Close the one real gap, marking In Progress before a PR exists, with a
small addition to `github-sdlc-planning`'s existing hook set: a
`PostToolUse` hook on `create_issue`/`add_sub_issue`/an explicit
"start work" signal that calls `set_field_value` to move the item to In
Progress, and nothing else. Also fix `add_item_to_project` (or the tool
that wraps it) to check for an existing item on the board for that content
before creating a new one, closing the duplicate-item gap directly.

**Technical Characteristics**: One new hook, one existing-tool guard; no
new GitHub Actions workflow; no change to how Todo/Done transitions happen.

**Advantages**: Satisfies every primary driver: no duplicated automation
for the transitions the platform already handles, no silent duplicates
once `add_item_to_project` checks first, and the in-progress gap closes
with the smallest addition that does the job.

**Disadvantages**: The in-progress hook only fires when the triggering
action goes through a Claude Code session using this plugin's own tools;
work started by a human directly on GitHub, or by an agent using a
different tool path, would not trigger it. This is an accepted, bounded
gap (see Consequences), not a blocking one, since the alternative
(Option 1's server-side coverage) would itself still miss "work has begun"
with no PR yet, for the same reason: there is no native GitHub event for
that transition regardless of who or what initiates it.

**Risk Assessment**:

- **Technical Risk**: Low. Reuses the existing hook and mutation-tool
  infrastructure; the idempotency check is a straightforward query-before-
  mutate addition.
- **Schedule Risk**: Low. Small, scoped change.
- **Ecosystem Risk**: Low.

### Option 3: Do nothing; keep setting status by hand

**Description**: Continue relying on a human or agent to remember to call
`set_field_value` at each transition, as before this investigation.

**Technical Characteristics**: No new code.

**Advantages**: Zero implementation cost.

**Disadvantages**: This is the status quo that produced the duplicate
items and unexplained status drift this ADR investigates; it has already
demonstrated it does not hold up under real, sustained multi-issue work.

**Disqualifying Factor**: fails the in-progress-gap driver by definition,
and does nothing to prevent recurrence of the duplicate-item problem.

**Risk Assessment**:

- **Technical Risk**: High. Already observed to produce incorrect board
  state in practice.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Low.

## Decision

We adopt **Option 2**: rely on the org project's already-enabled native
Projects v2 workflows for Todo-on-add, Done-on-close, and Done-on-merge,
and add a narrow, scoped fix for the two gaps native automation does not
cover:

- **Idempotent add**: before `add_item_to_project` (or its wrapping tool)
  creates a new item, it queries whether the target content already has an
  item on the project and returns that item instead of creating a
  duplicate.
- **In-progress hook**: a new `PostToolUse` hook in
  `plugins/github-sdlc-planning/hooks/` fires on tool calls that represent
  the start of active work (at minimum, a call to a tool that adds a
  sub-issue or begins implementation against an already-filed issue) and
  sets that issue's board item to In Progress via the existing
  `set_field_value` tool, if the item is not already past that state.

No new GitHub Actions workflow is introduced. No change is made to any of
the eleven built-in workflows already enabled on the project.

## Consequences

### Positive

1. **No more duplicate items or unexplained drift from tooling conflict**:
   the idempotent-add fix removes the mechanism that produced the
   duplicate items this investigation found.
2. **In-progress is now visible without manual discipline**: the one gap
   native automation leaves is closed by a small, auditable hook rather
   than depending on a human or agent remembering every time, which this
   session's own experience shows does not hold up.
3. **No redundant custom automation to maintain**: the org project's
   existing, already-enabled workflows continue doing the work they were
   built for.

### Negative

1. **The in-progress hook only covers Claude-Code-mediated work.** Work
   started by a human directly on GitHub, or by tooling outside this
   plugin, will not trigger it; mitigated by this being a strict
   improvement over the current all-manual state, not a regression, and by
   the native `Item added to project` workflow still giving every issue a
   visible (if less precise) Todo starting state.
2. **This ADR does not conclusively explain every anomaly it investigates.**
   The duplicate items are fully explained by native auto-add racing the
   explicit tool call. The two specific unexplained status values found
   during this investigation (one item showing In Progress, another
   showing Done while its closing PR was still open) are plausibly native
   `Pull request linked to issue`/`Pull request merged` automation acting
   on a duplicate item independently of the session's own calls, but this
   was not conclusively traced to a specific event for either occurrence;
   mitigated by leaving those two items untouched pending direct owner
   review, as already agreed separately from this ADR.

### Neutral

1. **The eleven built-in workflows' exact target-status mappings are not
   inspectable via the public API** (the `ProjectV2Workflow` GraphQL type
   exposes `name`/`enabled`/timestamps only, not its configured field
   value), confirmed by introspection. Understanding precisely which
   status value each workflow applies requires checking the project's
   settings UI directly; this ADR proceeds on the workflows' documented,
   named behavior.

## Decision Outcome

The decision achieves its primary objective, correct board state without
duplicated automation, measured by: zero new duplicate items created by
`add_item_to_project` after the idempotency fix ships (verified against a
test board), and every issue an agent begins active work on showing In
Progress without a manual `set_field_value` call, verified in the next
campaign that exercises the hook.

Mitigations:

- The Claude-Code-only coverage gap is accepted and documented above, not
  silently left unaddressed.
- The two unexplained historical status values are excluded from this
  ADR's scope and left for direct owner review, per prior agreement in the
  session that surfaced them.

## Related Decisions

None yet; this is the first ADR addressing Projects v2 board-status
automation in this repository.

## Links

- [About workflows in Projects: GitHub Docs][gh-workflows] - the built-in
  workflow catalog this ADR relies on.
- [Using the API to manage Projects: GitHub Docs][gh-projects-api] -
  confirms the `ProjectV2Workflow` type's exposed fields.

## More Information

- **Date:** 2026-07-05
- **Source:** board-state investigation during a multi-PR campaign against
  org project #1; the duplicate-item and unexplained-status findings that
  motivated this ADR
- **Related ADRs:** none

## Audit

### 2026-07-05

**Status:** Pending

**Findings:**

| Finding                                        | Files | Lines | Assessment |
| ---------------------------------------------- | ----- | ----- | ---------- |
| Drafted as proposed; awaiting maintainer review | -     | -     | pending    |

**Summary:** Drafted with Option 2 recommended after confirming, via the
`ProjectV2.workflows` GraphQL field, that all eleven built-in Projects v2
workflows are already enabled on this org project. The decision is not
binding until the status moves to accepted.

**Action Required:** Maintainer review; on acceptance, implement the
idempotent-add fix and the in-progress hook in
`plugins/github-sdlc-planning`.

[gh-workflows]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations
[gh-projects-api]: https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects
