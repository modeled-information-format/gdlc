---
id: 3a7c9e11-8f4d-4b2a-9e6c-1d5f8a2b7c4e
type: procedural
created: 2026-07-03T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-03T20:50:00Z
title: Verify cross-agent portability
diataxis_type: how-to
---
# Verify cross-agent portability

Both plugins' MCP cores are designed to be agent-neutral — every write goes
through an MCP tool call with no Claude-Code-only side effect. This is
proven at the protocol level by the unit tests and `evaluation.xml` QA pairs
(`mcp-server/evals/`). This how-to is the **live** check: driving the same
operations from Claude Code and from a second real MCP-capable host, and
confirming identical GitHub-side results.

**Status: partially run.** A sandbox repo (`modeled-information-format/gdlc-sandbox`)
and a real credential (a scoped GitHub App installation token, minted via
`.github/workflows/live-integration-tests.yml`) now exist, and both plugins'
`verify:live` scripts pass in full against real GitHub state — every
representative operation (`create_issue`, `add_sub_issue`, `add_item_to_project`,
`set_field_value`, `get_agent_capabilities`, `request_review`,
`get_linked_issues` via `closingIssuesReferences`, and more) succeeds against
the live API, not mocks. See the passing run:
<https://github.com/modeled-information-format/gdlc/actions/runs/28682702222>.

That is **not** the same claim as this doc's actual procedure below. It
proves the MCP core's own implementation is correct against real GitHub —
a single host (the script) calling the tool functions directly, not through
the MCP protocol, and not compared against a second agent. The genuine
cross-agent comparison (Claude Code vs. Codex/Cursor, through the actual MCP
protocol, diffing tool *responses* not just GitHub-side state) still has not
been run — this deliverable had a sandbox repo but not a second
MCP-capable host driving the protocol layer in this environment.

## Prerequisites

- A sandbox GitHub repo you're willing to create/delete issues, sub-issues,
  and a Projects v2 board in.
- `gh auth login --scopes project` completed against an account with write
  access to that repo.
- A second MCP-capable host available locally — Codex CLI or Cursor are the
  most likely candidates in this environment.

## Procedure

For each of the four representative operations, run it from Claude Code
first, record the result, then run the equivalent call from the second host
and diff:

1. `create_issue` — create an issue with a distinct title, capture the
   returned `body` (must carry the MIF frontmatter block) and `url`.
2. `add_sub_issue` — attach a second issue as a child of the first, capture
   the sub-issue count via `list_sub_issues`.
3. `add_item_to_project` — add the parent issue to a Projects v2 board,
   capture the returned `itemId`.
4. `get_agent_capabilities` — capture the full response; it must be
   byte-identical regardless of host, since it's a static, non-GitHub call.

## What "identical" means

- The GitHub-side state (issue body, sub-issue graph, project item) must
  match regardless of which host drove the call — this is the actual
  portability claim.
- The MCP tool *response* JSON must match in shape and field names; values
  that are inherently host-independent (`itemId`, `url`, `number`) must be
  identical since they describe the same GitHub object.
- `get_agent_capabilities`'s response must be exactly the same string —
  it's a pure function of the server's own code, not the host.

## Recording the result

Once run, add a dated entry to `mcp-server/evals/results/` on each plugin
(per the README already there) noting: date, hosts compared, pass/fail per
operation, and any host-specific behavior discovered (e.g. a hook firing
differently). If a real discrepancy is found, it's a portability bug in the
MCP core — file it against the relevant tool's implementation, not against
this doc.
