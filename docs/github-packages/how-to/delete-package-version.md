---
id: 6bb83d89-4694-4c55-90af-cfac2b1b0ba8
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Delete a single package version
diataxis_type: how-to
---

Delete one version of a package, leaving the rest of the package and its
other versions intact.

## Warning: destructive, single-version blast radius

This is restorable only within GitHub's roughly 30-day retention window,
and **only if nothing has since been republished under the same version**
— a republish in that window permanently forecloses the restore option for
what you deleted. Past 30 days, or past a republish, there is no recovery
path at all.

If you mean to remove the entire package (all versions), use
[delete-package](delete-package.md) instead.

## Verify before acting

1. Confirm you have the right version: run
   [get-package-version](get-package-version.md) first and check the
   `name` and `createdAt` match the version you intend to remove.
2. If you're not fully sure which numeric `versionId` corresponds to which
   published version, run [list-package-versions](list-package-versions.md)
   and cross-reference before proceeding — `versionId` is an opaque
   internal id, not the semver/tag string.

## Steps

1. Call the tool, passing the version id twice — once as `versionId`, once
   as `confirmVersionId`. Both must match exactly, or the tool refuses the
   call with a `confirmation_mismatch` error **before making any API
   request**:

   ```text
   delete_package_version {
     org: "your-org",
     packageType: "npm",
     packageName: "your-package",
     versionId: 123456,
     confirmVersionId: 123456
   }
   ```

2. On success you get back `{ org, packageType, packageName, versionId }`.
   There is no dry-run mode — a successful call has already deleted the
   version.

## If you need it back

Within the ~30-day window, and only if nothing has republished under the
same version in the meantime, call
[restore-package-version](restore-package-version.md) with the same
`org`, `packageType`, `packageName`, and `versionId`.
