---
id: 4afc55b2-791a-45b2-8128-da7f6d6a7d9d
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Get a repo's custom property values
diataxis_type: how-to
---

Read the current custom property values set on a specific repository.

## Call

```
get_repo_custom_properties { "owner": "<owner>", "repo": "<repo>" }
```

## Result

```json
[
  { "propertyName": "team", "value": "platform" },
  { "propertyName": "cost-center", "value": null }
]
```

`value` is `null` if the property is defined at the org level but not
set on this repo; it can also be a `string[]` for multi-select
properties.

## Notes

This only reads one repo at a time. To see what property names are
even valid for this org, check
[list-custom-properties-schema.md](list-custom-properties-schema.md).
To write values (for this repo or several at once), use
[set-repo-custom-properties.md](set-repo-custom-properties.md).
