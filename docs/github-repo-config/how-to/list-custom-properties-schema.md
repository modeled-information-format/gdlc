---
id: 14cd3c04-5ed9-48d1-8ebf-02c8b3f60399
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: List an org's custom repository-property definitions
diataxis_type: how-to
---

See what custom repository properties an org has defined — the schema,
not any repo's actual values.

## Call

```
list_custom_properties_schema { "org": "<org>" }
```

## Result

```json
[
  { "propertyName": "team", "valueType": "single_select", "required": false },
  { "propertyName": "cost-center", "valueType": "string", "required": true }
]
```

`required` defaults to `false` if the org's schema doesn't specify it.

## Next step

To see what values a specific repo currently has set for these
properties, use
[get-repo-custom-properties.md](get-repo-custom-properties.md). To set
values across one or more repos, use
[set-repo-custom-properties.md](set-repo-custom-properties.md) — GitHub
validates any `propertyName` you set against this org-level schema, so
check it here first if a write unexpectedly fails.
