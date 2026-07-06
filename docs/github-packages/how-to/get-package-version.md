---
id: cecde70e-73f1-45c9-9bf3-e9ed364515e4
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Get a single package version
diataxis_type: how-to
---

Look up one version of a package by its numeric id.

## Steps

1. Know the version's `versionId` — if you don't, run
   [list-package-versions](list-package-versions.md) first.
2. Call the tool:

   ```text
   get_package_version { org: "your-org", packageType: "npm", packageName: "your-package", versionId: 123456 }
   ```

3. Read the result: `{ id, name, createdAt }`.

This is the recommended step before deleting a version — confirm the
`name` and `createdAt` match what you expect before calling
[delete-package-version](delete-package-version.md).

## Common mistake

`versionId` is GitHub's internal numeric package-version id, not the
semver/tag `name` string shown elsewhere (e.g. `1.2.3` or `sha256:...`).
Passing a version's display name where an id is expected fails validation
(the schema requires an integer) rather than silently matching by name.
