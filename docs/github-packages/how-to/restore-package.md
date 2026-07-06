---
id: 0c33ddcc-9af0-4e0d-adc9-16dd3c3d4872
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Restore a deleted package
diataxis_type: how-to
---
# Restore a deleted package

Undo a `delete_package` call, within GitHub's ~30-day retention window.

## Steps

1. Know the exact `org`, `packageType`, and `packageName` of the deleted
   package. If you're not certain a delete happened recently enough to be
   recoverable, try the call anyway — a request outside the window, or
   where something has since republished under the same name, surfaces as
   a plain `github_api_error` rather than corrupting anything.
2. Call the tool:

   ```text
   restore_package { org: "your-org", packageType: "npm", packageName: "your-package" }
   ```

3. On success you get back `{ org, packageType, packageName }`.

## No confirm-echo guard

Unlike the delete tools, `restore_package` takes no `confirm*` field.
Restoring undoes a delete rather than causing new loss, so it isn't given
the same friction.

## Verify it worked

Call [get-org-package](get-org-package.md) with the same `org`,
`packageType`, and `packageName` to confirm the package is visible again.
