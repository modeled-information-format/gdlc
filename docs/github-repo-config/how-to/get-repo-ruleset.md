---
id: 778786e7-2bac-45d4-a522-bac2d3bbac60
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Get a single ruleset's detail
diataxis_type: how-to
---

Read one ruleset by id, including who or what can bypass it.

## Before you call this

You need the ruleset's numeric `id`. Get it from
[list-repo-rulesets.md](list-repo-rulesets.md) first.

## Call

```
get_repo_ruleset { "owner": "<owner>", "repo": "<repo>", "rulesetId": 12345 }
```

## Result

```json
{
  "id": 12345,
  "name": "main-protection",
  "target": "branch",
  "enforcement": "active",
  "bypassActors": [
    { "actorId": 1, "actorType": "Team", "bypassMode": "always" }
  ]
}
```

`bypassActors` is an empty array if the ruleset defines no bypass —
i.e., it applies to everyone with push access, no exceptions.

## Notes

Read-only in this plugin. Check `bypassActors` before assuming a
ruleset fully blocks a given action for a given actor — an admin or bot
identity present here bypasses the rule entirely.
