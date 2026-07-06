---
id: 5dc0d97f-1fe8-4fa5-bacd-8b9cde48ba6c
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Read a branch's protection config
diataxis_type: how-to
---
# Read a branch's protection config

Check what protection, if any, currently governs a branch.

## Call

```
get_branch_protection { "owner": "<owner>", "repo": "<repo>", "branch": "<branch>" }
```

## Result

```json
{
  "requiredStatusChecks": { "strict": true, "contexts": ["ci / build"] },
  "enforceAdmins": true,
  "requiredApprovingReviewCount": 1
}
```

`requiredStatusChecks` is `null` if no status checks are required.
`requiredApprovingReviewCount` is `null` if the branch has no required
PR reviews configured at all.

## If the branch has no protection

GitHub's underlying endpoint 404s when a branch isn't protected. The
tool surfaces this as a `github_api_error` — that's the expected
signal for "unprotected," not a failure to diagnose.

## Notes

This tool only sees classic branch protection. A branch can also be
governed by rulesets, which are read separately — see
[list-repo-rulesets.md](list-repo-rulesets.md).
