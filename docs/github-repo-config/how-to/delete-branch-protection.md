---
id: ee69a379-5e32-46f3-ae75-482f0675b4e5
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Remove all protection from a branch
diataxis_type: how-to
---
# Remove all protection from a branch

Delete a branch's protection entirely — this opens its merge gate
completely. Confirm this is what you want before calling it.

## Call

```
delete_branch_protection {
  "owner": "<owner>",
  "repo": "<repo>",
  "branch": "<branch>",
  "confirmBranch": "<branch>"
}
```

`confirmBranch` must equal `branch` exactly. A mismatch throws
`confirmation_mismatch` before any API call is made — this is a
deliberate guard against removing protection from the wrong branch by
typo, not an extra step to route around.

## Result

```json
{ "owner": "<owner>", "repo": "<repo>", "branch": "<branch>" }
```

## Notes

There is no undo tool, and once deletion succeeds
[get-branch-protection.md](get-branch-protection.md) has nothing left
to read back. If you might want the current configuration again later,
call [get-branch-protection.md](get-branch-protection.md) *before*
deleting and record the result — then restore it afterward with
[update-branch-protection.md](update-branch-protection.md). This tool
only removes classic branch protection; any rulesets governing the
branch are untouched (see
[list-repo-rulesets.md](list-repo-rulesets.md)).
