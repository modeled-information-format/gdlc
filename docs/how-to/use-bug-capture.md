---
id: 6f2a8c41-3d7e-4b95-a1c8-9e4d2f7b5a30
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-09T00:00:00Z
title: Capture and triage bugs with github-bug-capture
diataxis_type: how-to
---

Turn a diagnostic you just hit (a failing test, a lint error, a build break)
into a structured, severity-labeled, board-tracked GitHub issue, and manage
it through its lifecycle. Assumes Claude Code with this marketplace already
added (see the root [README](../../README.md#quick-start)).

## 1. Install

```text
/plugin install github-bug-capture@github-sdlc-plugins
```

Dependency resolution pulls in `github-pull-requests` and
`github-sdlc-planning` automatically (linkage and board governance live
there, per [ADR-0002](../decisions/adr-0002-pr-issue-linkage-ownership.md)).
Auth comes from `GITHUB_TOKEN` or the `gh` CLI login; Projects v2 writes on
a classic token additionally need the `project` scope
(`gh auth login --scopes project`).

## 2. Turn on the packs you want

The Layer 1 tools work immediately with nothing configured. The AI
enhancement packs are off by default; enable them per project in
`.config/gdlc/config.yml`'s `packs:` section ([ADR-0006](../decisions/adr-0006-eliminate-markdown-config-carriers.md) —
this is committed, team-shared policy, not a personal per-developer toggle):

```yaml
packs:
  hooks: true
  triage-skills: true
```

Keys: `hooks` (failure detection in tool output), `triage-skills`
(`file-bug`/`triage`/`dedup-check`), `mcp-integration` (documentation-only;
the core is already an MCP server), `gh-aw` (batch triage workflow
template, technical preview). Full semantics:
[pack-toggles](../../plugins/github-bug-capture/docs/pack-toggles.md).

## 3. Provision the triage board once

Point severity tooling at your Projects v2 board:

```text
ensure_severity_field { projectOwnerLogin, projectNumber }
```

Idempotent: creates a Severity single-select (Critical/High/Medium/Low) or
returns the existing field untouched. `projectOwnerLogin`/`projectNumber`
(here and on `set_severity`/`get_lifecycle_state`/`set_lifecycle_state`)
are optional once a `board:` mapping exists in
[`.config/gdlc/config.yml`](../reference/config-schema.md) -- the same
mapping section 7 configures. Org-level issue-type/field provisioning
steps and their current API caveats:
[org-provisioning](../../plugins/github-bug-capture/docs/org-provisioning.md).

## 4. File a bug

With `triage-skills` enabled, ask for the **file-bug** skill and describe
the defect (or let it inherit a diagnostic the hooks-pack just captured).
It checks for duplicates first (`search_similar_issues`), files through the
planning plugin's `create_issue` (so the body carries the MIF comment
block), then applies severity via `set_severity`.

With the `hooks` pack enabled, a failing Bash command (test/lint/build
signatures) triggers the diagnostic-capture hook, which hands the excerpt
to the session and points at file-bug; nothing is filed without you.

Without Claude Code at all, the same conventions are scriptable:

```bash
source plugins/github-bug-capture/scripts/gh-bug.sh
bug_create --title "Crash on save" --body "steps..." --severity high \
  --ns myproject --id crash-on-save --repo <owner>/<repo>
```

`--ns` and `--id` are required alongside `--title` and `--severity`; they
become the issue body's MIF identity (`urn:mif:concept:<ns>:<id>`).

## 5. Triage and dedup

- **triage** skill: reads an issue, proposes a severity, applies it on your
  confirmation.
- **dedup-check** skill: given a draft title/body, reports likely existing
  duplicates before you file.
- `close_as_duplicate { owner, repo, issueNumber, duplicateOfNumber }`:
  closes with `state_reason: duplicate` and posts a link to the canonical
  issue.
- Batch triage across all open `bug` issues: copy the gh-aw template from
  [workflows-gh-aw](../../plugins/github-bug-capture/workflows-gh-aw/README.md)
  (technical preview, ships inert).

## 6. Track the lifecycle

- `get_lifecycle_state` returns the composite of native open/closed state
  plus the board's Status value; `set_lifecycle_state` moves the Status
  field and optionally closes the issue (`closeIfDone`).
- Todo-on-add and Done-on-close/merge need no calls at all when the board
  has GitHub's built-in workflows enabled, which this org's project does
  (see [ADR-0003](../decisions/adr-0003-board-status-hygiene.md)); a merged
  PR whose body says `Fixes #N` closes the bug and the board follows.
- The In-Progress leg is covered by the planning plugin's hook once the
  consuming project configures a board, next section.

## 7. Automate In Progress (planning plugin)

Create `.config/gdlc/config.yml` in the consuming project (committed,
team-shared). Step 3's `projectOwnerLogin`/`projectNumber` optionality
reads from this same file's `board:` section -- this is where you create
it:

```yaml
board:
  projectOwnerLogin: <org-or-user>
  projectNumber: <n>
```

From then on, `add_sub_issue`/`update_issue` calls move the affected
issue's board item to In Progress automatically, only when its Status is
unset or Todo, never overriding a later state. No config, no effect.
Repo-level CI automation (auto-label on open, close-keyword audit) is
available as copyable templates:
[workflows](../../plugins/github-bug-capture/workflows/README.md).

> The legacy `board:` key in `.claude/github-sdlc-planning.local.md`
> frontmatter no longer works at all ([ADR-0006](../decisions/adr-0006-eliminate-markdown-config-carriers.md)
> removed the one-release fallback ADR-0004 introduced); migrate that key
> into `.config/gdlc/config.yml`'s `board:` section if you haven't already.
