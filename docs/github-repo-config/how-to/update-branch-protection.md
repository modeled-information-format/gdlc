---
id: e1cb5100-9747-4509-bca3-be842f0a3e79
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Set the full branch-protection config for a branch
diataxis_type: how-to
---

Set (or replace) a branch's protection in one call.

## Before you call this

Decide the full desired state for all three fields first. GitHub's PUT
endpoint takes the complete desired state per call, not a partial patch
— an omitted field is not "leave as-is," it disables that protection.
This tool's schema makes all three fields required for exactly that
reason.

## Call

```
update_branch_protection {
  "owner": "<owner>",
  "repo": "<repo>",
  "branch": "<branch>",
  "requiredStatusChecks": { "strict": true, "contexts": ["ci / build"] },
  "enforceAdmins": true,
  "requiredApprovingReviewCount": 1
}
```

Pass `"requiredStatusChecks": null` explicitly if you don't want any
required status checks — you cannot omit the field.

## Result

Same shape as [get-branch-protection.md](get-branch-protection.md)'s
result, reflecting what was just set.

## Getting `contexts` right

Each entry in `requiredStatusChecks.contexts` must be the exact
check-run name GitHub reports for a workflow job:
`workflow-name / job-name`. A display label or a bare name that doesn't
match the reported check-run name silently blocks nothing — the branch
will look protected but the check won't actually gate merges.

## Notes

The tool sends `restrictions: null` to GitHub internally (no push
restrictions) — this plugin doesn't expose push restrictions as an
input yet. Verify the result with
[get-branch-protection.md](get-branch-protection.md) rather than
trusting the write call alone as confirmation.
