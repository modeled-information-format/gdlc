---
id: 6e1c4a8b-3f7d-4c2e-8a9b-5d1f6c3e7a92
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: recover from an accidental package delete"
diataxis_type: how-to
---

You (or a script, or a teammate) just deleted a package or a package
version that turns out to still be needed. GitHub keeps a deleted package
or version recoverable for about 30 days, as long as nothing has since
republished under the same name or version number — this guide is the
"panic, then recover" path, distinct from the planned cleanup in
[clean-up-old-versions-of-one-package.md](clean-up-old-versions-of-one-package.md).

## Steps

1. **Stop and confirm what was actually deleted before doing anything
   else.** If you're not certain whether the whole package or just one
   version is gone, check first:

   ```text
   get_org_package {
     org: "octo-org", packageType: "npm", packageName: "widget-lib"
   }
   ```

   If this errors (package not found), the whole package is gone — restore
   the package itself, not a version. If it succeeds but
   `list_package_versions` is missing a version you expected, only that
   version was deleted.

2. **If the whole package is gone, restore the package:**

   ```text
   restore_package {
     org: "octo-org", packageType: "npm", packageName: "widget-lib"
   }
   ```

3. **If only one version is gone, restore just that version:**

   ```text
   restore_package_version {
     org: "octo-org",
     packageType: "npm",
     packageName: "widget-lib",
     versionId: 4821
   }
   ```

   You need the exact `versionId` of the deleted version. If you don't
   have it handy (e.g. it came from a script's log output, not from you
   watching the deletion happen), you likely don't have another way to
   recover it through this plugin — there's no "list recently deleted
   versions" tool. Check wherever the delete was triggered from (a CI log,
   a script's own output, a chat message) for the id it reported.

4. **Neither restore tool has a confirm-echo guard.** Unlike the delete
   tools, restoring doesn't ask you to repeat a name or id back — undoing a
   delete is treated as inherently safe, not something to gate behind
   confirmation. That also means a mistaken restore call (wrong
   `packageName`, say) just fails against GitHub's API rather than being
   caught early by this plugin — double-check the parameters yourself
   before calling.

5. **Verify the recovery actually worked** by listing again:

   ```text
   list_package_versions {
     org: "octo-org", packageType: "npm", packageName: "widget-lib"
   }
   ```

   Confirm the version (or, for a whole-package restore, the full version
   list) is back.

## If it's been more than 30 days, or something's republished since

Both restore tools call GitHub's own restore endpoint directly — this
plugin has no extended-recovery path beyond what GitHub itself offers. If
the ~30-day window has passed, or something has already republished under
the same package name or version number, the restore call will fail and
there's no fallback: you'd need to republish the artifact from source
(rebuild and re-publish the npm package, re-push the container image,
etc.), not recover the original bytes.
