---
id: 25e52efe-c03b-4458-9262-dafccf4abf92
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Delete a package
diataxis_type: how-to
---

Delete an entire package — every version it has, in one call.

## Warning: destructive, wide blast radius

This deletes **all versions** of the named package at once, not just one.
It is restorable only within GitHub's roughly 30-day retention window, and
**only if nothing has since been republished under the same package
name** — a republish in that window permanently forecloses the restore
option for what you deleted. Past 30 days, or past a republish, there is
no recovery path at all, from this tool or from GitHub's UI.

If you only mean to remove one bad version and keep the rest, use
[delete-package-version](delete-package-version.md) instead — it is
significantly less destructive.

## Verify before acting

1. Confirm you have the right package: run
   [get-org-package](get-org-package.md) first and check the `name`,
   `packageType`, and `versionCount` match what you intend to delete.
2. If `versionCount` is more than 1 and you're not sure every version
   should go, stop and use `delete_package_version` per-version instead.

## Steps

1. Call the tool, passing the package name twice — once as `packageName`,
   once as `confirmPackageName`. Both must match exactly, or the tool
   refuses the call with a `confirmation_mismatch` error **before making
   any API request**:

   ```text
   delete_package {
     org: "your-org",
     packageType: "npm",
     packageName: "your-package",
     confirmPackageName: "your-package"
   }
   ```

2. On success you get back `{ org, packageType, packageName }`. There is
   no dry-run mode — a successful call has already deleted the package.

## If you need it back

Within the ~30-day window, and only if nothing has republished under the
same name in the meantime, call
[restore-package](restore-package.md) with the same `org`, `packageType`,
and `packageName`.
