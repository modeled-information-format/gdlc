---
id: 000de147-b37e-41c4-8113-c8a3432eb460
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: List a repo's rulesets
diataxis_type: how-to
---
# List a repo's rulesets

See every ruleset configured on a repository — the forward-compatible
successor to classic branch protection, supporting multiple named rules
per branch/tag pattern.

## Call

```
list_repo_rulesets { "owner": "<owner>", "repo": "<repo>" }
```

## Result

```json
[
  { "id": 12345, "name": "main-protection", "target": "branch", "enforcement": "active" }
]
```

An empty array means the repo has no rulesets — check
[get-branch-protection.md](get-branch-protection.md) too, since classic
protection and rulesets are separate mechanisms that can each apply
independently.

## Next step

To see a specific ruleset's bypass actors and full detail, pass its
`id` to [get-repo-ruleset.md](get-repo-ruleset.md).

## Notes

Read-only in this plugin: creating or updating a ruleset isn't
supported yet (deliberately deferred — see
[explanation/architecture.md](../explanation/architecture.md)).
`enforcement` values include `active`, `evaluate`, and `disabled`; a
ruleset in `evaluate` mode reports what it would block without actually
blocking anything.
