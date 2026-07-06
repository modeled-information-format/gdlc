---
id: 25e2e926-891f-458a-b563-94e77e126b8d
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: List an org's default community health files
diataxis_type: how-to
---

See what default community health templates (issue/PR templates,
CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, and similar) an org provides
via its `.github` repo.

## Call

```
list_org_health_files { "org": "<org>" }
```

List a specific directory instead of the repo root:

```
list_org_health_files { "org": "<org>", "path": "ISSUE_TEMPLATE" }
```

## Result

```json
[
  { "name": "CONTRIBUTING.md", "path": "CONTRIBUTING.md", "type": "file" },
  { "name": "ISSUE_TEMPLATE", "path": "ISSUE_TEMPLATE", "type": "dir" }
]
```

## Notes

This always reads the org's public (or internal) `.github` repository —
never `.github-private`, which is a separate internal-tooling repo (for
things like Copilot custom agents) that GitHub does not consult for
these community-health defaults. If the org has no `.github` repo at
all, expect a `github_api_error`. To read a specific file's content once
you've found its path, use
[get-org-health-file.md](get-org-health-file.md).
