---
id: ec0a1c83-a3b7-4a5a-a829-b1ca2049fbcc
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Restore a deleted package version
diataxis_type: how-to
---
# Restore a deleted package version

Undo a `delete_package_version` call, within GitHub's ~30-day retention
window.

## Steps

1. Know the exact `org`, `packageType`, `packageName`, and `versionId` of
   the deleted version. If you're not certain a delete happened recently
   enough to be recoverable, try the call anyway — a request outside the
   window, or where something has since republished under the same
   version, surfaces as a plain `github_api_error` rather than corrupting
   anything.
2. Call the tool:

   ```text
   restore_package_version { org: "your-org", packageType: "npm", packageName: "your-package", versionId: 123456 }
   ```

3. On success you get back `{ org, packageType, packageName, versionId }`.

## No confirm-echo guard

Unlike the delete tools, `restore_package_version` takes no `confirm*`
field. Restoring undoes a delete rather than causing new loss, so it isn't
given the same friction.

## Verify it worked

Call [get-package-version](get-package-version.md) with the same `org`,
`packageType`, `packageName`, and `versionId` to confirm the version is
visible again.
