---
id: ddecdef4-a8c4-42b6-ba15-d3c961f62b42
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Create your first Epic with sub-issues
diataxis_type: tutorial
---

# Create your first Epic with sub-issues

In this tutorial you will use `github-sdlc-planning`'s MCP tools directly —
no skill, no agent — to create one Epic issue, attach two Story sub-issues
to it, and confirm the parent tracks their completion. By the end you will
have a real, native GitHub sub-issue hierarchy and understand the four tools
that build it.

This is a hands-on walkthrough; it does not explain every option each tool
accepts (see the [tool reference](../reference/tools.md) for that) or cover
every way to use the plugin (see [how-to](../how-to/) for task recipes).

## Before you start

You need:

- Claude Code with this marketplace added and `github-sdlc-planning`
  installed (`/plugin marketplace add modeled-information-format/gdlc` then
  `/plugin install github-sdlc-planning@github-sdlc-plugins`).
- A GitHub repository you can create issues in.
- `gh auth login --scopes project` run at least once, so a token is
  available (the server falls back to `gh auth token` when `GITHUB_TOKEN`
  isn't set).

Throughout, replace `your-org/your-repo` with a real `owner/repo` you have
write access to.

## 1. Create the Epic

Ask Claude Code to call the `create_issue` tool with:

```json
{
  "owner": "your-org",
  "repo": "your-repo",
  "title": "Ship the onboarding revamp",
  "body": "Redesign new-user onboarding end to end.",
  "mif": { "id": "onboarding-revamp", "type": "Epic", "namespace": "your-repo" }
}
```

The tool returns something like:

```json
{
  "number": 101,
  "nodeId": "I_kwDOExample",
  "url": "https://github.com/your-org/your-repo/issues/101",
  "body": "<!-- mif-id: urn:mif:concept:your-repo:onboarding-revamp -->\n<!-- mif-type: Epic -->\n<!-- mif-ns: your-repo -->\nRedesign new-user onboarding end to end."
}
```

Notice the `body` in the response already carries the three MIF comment
lines — `create_issue` prepends them for you; you never write that block by
hand.

**Checkpoint:** open the returned `url` in a browser. You should see issue
#101 with the title you gave it and a body starting with three HTML
comments, invisible in GitHub's rendered view but present in the raw
Markdown.

## 2. Create a Story to attach

Call `create_issue` again for the first piece of work:

```json
{
  "owner": "your-org",
  "repo": "your-repo",
  "title": "Redesign the welcome email",
  "body": "New copy and layout for the first onboarding email.",
  "mif": { "id": "welcome-email", "type": "Story", "namespace": "your-repo" }
}
```

Note its returned `number` (say, `102`).

## 3. Attach it as a sub-issue

Call `add_sub_issue`:

```json
{
  "owner": "your-org",
  "repo": "your-repo",
  "parentNumber": 101,
  "childNumber": 102
}
```

This returns `{ parentNodeId, childNodeId, replacedParent: true }`. The tool
checked, before calling GitHub, that issue #101 has fewer than 100 existing
sub-issues and sits below the 8-level nesting limit — you don't need to
track those limits yourself.

**Checkpoint:** reload issue #101 in the browser. GitHub's native "Sub-issues"
panel now lists #102.

## 4. Repeat for a second Story

Create a second issue the same way as step 2 (e.g. `"Add a product tour",
type: "Story", id: "product-tour"`), note its number (say, `103`), and call
`add_sub_issue` again with `parentNumber: 101, childNumber: 103`.

## 5. Check progress on the parent

Call `list_sub_issues`:

```json
{ "owner": "your-org", "repo": "your-repo", "parentNumber": 101 }
```

You should see:

```json
{
  "total": 2,
  "completed": 0,
  "percentCompleted": 0,
  "items": [
    { "number": 102, "nodeId": "...", "title": "Redesign the welcome email", "state": "OPEN" },
    { "number": 103, "nodeId": "...", "title": "Add a product tour", "state": "OPEN" }
  ]
}
```

Close either sub-issue on GitHub (or via `update_issue` with `state:
"closed"`) and call `list_sub_issues` again — `completed` and
`percentCompleted` update automatically; GitHub computes this from the
native sub-issue graph, not from anything the plugin tracks separately.

## What you built

One Epic issue with two Story sub-issues attached through GitHub's real
sub-issue relationship (not a task-list checkbox in the body), every body
carrying MIF frontmatter identifying what it is. You used four tools:
`create_issue`, `add_sub_issue`, `list_sub_issues`, and implicitly relied on
`format_mif_issue_body` running inside `create_issue`.

## Next steps

- To do this decomposition automatically from a single goal description
  instead of one `create_issue` call per issue, use the
  **epic-decomposition** skill.
- To put these issues on a Projects v2 board, see
  [`how-to/add-item-to-project.md`](../how-to/add-item-to-project.md).
- For the full tool surface, see the [reference](../reference/tools.md).
