---
id: cb06eefb-8ac9-45e0-83b4-e5c469911366
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Get a single org package
diataxis_type: how-to
---
# Get a single org package

Look up one package by name and type, without listing the whole registry.

## Steps

1. Know the package's exact `packageName` and `packageType` — if you
   don't, run [list-org-packages](list-org-packages.md) first.
2. Call the tool:

   ```text
   get_org_package { org: "your-org", packageType: "npm", packageName: "your-package" }
   ```

3. Read the result: `{ id, name, packageType, visibility, versionCount }`.

## Common mistake

Passing the wrong `packageType` for the package's actual registry (most
often `docker` vs `container`) returns a 404 `github_api_error`, not a
helpful "wrong type" message — GitHub treats each type as a fully separate
namespace under the same name.
