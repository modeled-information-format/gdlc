---
id: e406cdbf-4db3-4c5c-8c30-c014ac003246
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: List a package's versions
diataxis_type: how-to
---

See every published version of one package.

## Steps

1. Know the package's `packageName` and `packageType` — if you don't, run
   [list-org-packages](list-org-packages.md) first.
2. Call the tool:

   ```text
   list_package_versions { org: "your-org", packageType: "npm", packageName: "your-package" }
   ```

3. Read the result: an array of `{ id, name, createdAt }`, one entry per
   version, newest and oldest both included — there is no built-in
   filtering or pagination cap applied by this tool.

Use the `id` values from this result as the `versionId` input to
[get-package-version](get-package-version.md),
[delete-package-version](delete-package-version.md), or
[restore-package-version](restore-package-version.md).

## Common mistake

A high `versionCount` (visible from `list_org_packages`/`get_org_package`)
without visiting this tool tells you nothing about *which* versions are
old, orphaned, or safe to delete — you have to list the versions to make
that judgment. The `package-audit` skill flags high version counts as
worth reviewing, but never decides what to delete on its own.
