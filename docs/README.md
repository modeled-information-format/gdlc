---
id: d1fe77a5-98cb-4891-929a-8114a2fe82a1
type: semantic
created: 2026-07-03T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-03T00:00:00Z
title: gdlc documentation
diataxis_type: index
---

Docs for the `github-sdlc-plugins` attested marketplace, organized by
[Diátaxis](https://diataxis.fr/) mode.

| Mode | Document |
| --- | --- |
| How-to | [Plan and track work with the planning and PR plugins](how-to/plan-work-with-the-plugins.md) |
| How-to | [Capture and triage bugs with github-bug-capture](how-to/use-bug-capture.md) |
| How-to | [Add a plugin](how-to/add-a-plugin.md) |
| How-to | [Verify cross-agent portability](how-to/verify-cross-agent.md) |
| Reference | [Gates](reference/gates.md) |
| Explanation | [Why an attested marketplace](explanation/attested-marketplace.md) |
| Security | [Verify a release](security/verify.md) |
| Decisions | [ADR-0001](decisions/adr-0001-bug-capture-layer1-core.md), [ADR-0002](decisions/adr-0002-pr-issue-linkage-ownership.md), [ADR-0003](decisions/adr-0003-board-status-hygiene.md), [ADR-0004](decisions/adr-0004-project-config-surface.md) |

## Per-plugin docs

Each plugin has its own Diátaxis tree: a tutorial (first run), `how-to/`
(task recipes), `reference/tools.md` (exhaustive MCP tool listing), and
`explanation/` (architecture and rationale).

| Plugin | Tutorial | Reference |
| --- | --- | --- |
| `github-bug-capture` | [Capture your first bug](github-bug-capture/tutorials/capture-your-first-bug.md) | [Tool reference](github-bug-capture/reference/tools.md) |
| `github-insights` | [Repo health snapshot](github-insights/tutorials/repo-health-snapshot.md) | [Tool reference](github-insights/reference/tools.md) |
| `github-org-identity` | [Audit and assign a role](github-org-identity/tutorials/audit-and-assign-a-role.md) | [Tool reference](github-org-identity/reference/tools.md) |
| `github-packages` | [Audit and clean up a package](github-packages/tutorials/audit-and-clean-up-a-package.md) | [Tool reference](github-packages/reference/tools.md) |
| `github-pull-requests` | [First PR linked to an issue](github-pull-requests/tutorials/first-pr-linked-to-an-issue.md) | [Tool reference](github-pull-requests/reference/tools.md) |
| `github-repo-config` | [Audit and protect a branch](github-repo-config/tutorials/audit-and-protect-a-branch.md) | [Tool reference](github-repo-config/reference/tools.md) |
| `github-sdlc-planning` | [Create your first epic](github-sdlc-planning/tutorials/create-your-first-epic.md) | [Tool reference](github-sdlc-planning/reference/tools.md) |

See also the root [README.md](../README.md) and [SECURITY.md](../SECURITY.md).
