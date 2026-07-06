---
title: gdlc — the github-sdlc-plugins marketplace
description: Attested Claude Code plugin marketplace for the GitHub SDLC planning domain — seven plugins, one MCP server each, SHA-pinned and admitted only when their attestation verifies fail-closed.
---

`gdlc` is the attested Claude Code plugin marketplace for the GitHub SDLC
planning domain (`github-sdlc-plugins`). Every plugin ships an independent
MCP server, is SHA-pinned in the catalog, and is admitted only after its
release attestation verifies fail-closed. See
[why an attested marketplace](explanation/attested-marketplace/) for the
full rationale.

## The seven plugins

| Plugin | Domain | Tutorial | Tool reference |
| --- | --- | --- | --- |
| `github-sdlc-planning` | Issues, sub-issues, Projects v2, Milestones, Discussions (Tier-1 foundation) | [Create your first epic](github-sdlc-planning/tutorials/create-your-first-epic/) | [Tools](github-sdlc-planning/reference/tools/) |
| `github-pull-requests` | PR lifecycle: create, classify, review-route, link to issues | [First PR linked to an issue](github-pull-requests/tutorials/first-pr-linked-to-an-issue/) | [Tools](github-pull-requests/reference/tools/) |
| `github-bug-capture` | Development-time bug capture: severity, triage, lifecycle, dedup | [Capture your first bug](github-bug-capture/tutorials/capture-your-first-bug/) | [Tools](github-bug-capture/reference/tools/) |
| `github-repo-config` | Branch protection, rulesets, Pages, custom properties | [Audit and protect a branch](github-repo-config/tutorials/audit-and-protect-a-branch/) | [Tools](github-repo-config/reference/tools/) |
| `github-insights` | Traffic, contributor stats, community profile, SBOM (read-only) | [Repo health snapshot](github-insights/tutorials/repo-health-snapshot/) | [Tools](github-insights/reference/tools/) |
| `github-packages` | Org package/version list, delete/restore | [Audit and clean up a package](github-packages/tutorials/audit-and-clean-up-a-package/) | [Tools](github-packages/reference/tools/) |
| `github-org-identity` | Org roles and team/user assignments | [Audit and assign a role](github-org-identity/tutorials/audit-and-assign-a-role/) | [Tools](github-org-identity/reference/tools/) |

## Get started

- [Add a plugin](how-to/add-a-plugin/) to the catalog
- [Plan and track work with the planning and PR plugins](how-to/plan-work-with-the-plugins/)
- [Verify a release](security/verify/)
- Browse the [architecture decisions](decisions/) behind the marketplace's design
