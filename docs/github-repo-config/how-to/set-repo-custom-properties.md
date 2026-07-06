---
id: 6a4941de-1ca3-43ab-9e84-8bcad17412c5
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Bulk-set custom property values across repos
diataxis_type: how-to
---

Write custom property values to one or more repos in a single org-level
call. This is a broad-blast-radius write — it can retarget ruleset
enforcement across every named repo at once if any of those properties
drive ruleset targeting in your org.

## Call

`confirmRepoCount` must equal `repoNames.length` exactly, or the call
throws `confirmation_mismatch` before any API call is made. This is a
deliberate guard against an accidental oversized repo list, not
boilerplate to route around — count your `repoNames` before you set it.

```
set_repo_custom_properties {
  "org": "<org>",
  "repoNames": ["repo-a", "repo-b"],
  "properties": [
    { "propertyName": "team", "value": "platform" },
    { "propertyName": "cost-center", "value": null }
  ],
  "confirmRepoCount": 2
}
```

Pass `value: null` to clear a property, or a `string[]` for a
multi-select property.

## Result

```json
{ "org": "<org>", "repoNames": ["repo-a", "repo-b"] }
```

## Before you call this

- Check [list-custom-properties-schema.md](list-custom-properties-schema.md)
  for the valid `propertyName`s in this org — GitHub validates against
  that schema.
- If you're unsure of a repo's current values, read them first with
  [get-repo-custom-properties.md](get-repo-custom-properties.md) so
  you know what you're overwriting.

## Notes

This writes to **every** repo in `repoNames` in one call — there's no
per-repo dry run. Double-check the list, especially when it's been
built programmatically, before calling.
