---
id: 4a7d2f1e-8c3b-4e6a-9f2d-1b6c8e4a3d75
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: clean up old versions of one package"
diataxis_type: how-to
---

A package (an npm library, a container image, whatever your org publishes)
has accumulated a long tail of old versions nobody uses, and they're
costing you storage. You want to trim it down to the versions that
actually matter, without deleting the whole package or anything currently
in use.

This is a **repeated, single-tool pattern** across many versions, not the
one-shot single-version walkthrough in
[the main tutorial](../tutorials/audit-and-clean-up-a-package.md) — the
difference here is deciding *which* versions are safe to drop before you
start deleting anything.

## Steps

1. **List every version of the package:**

   ```text
   list_package_versions {
     org: "octo-org", packageType: "npm", packageName: "widget-lib"
   }
   ```

   You get back `{ id, name, createdAt }` for each version. Sort by
   `createdAt` yourself — the tool doesn't guarantee an order.

2. **Decide your keep-list before deleting anything.** A reasonable rule:
   keep the most recent N versions, plus any version whose `name` matches a
   tag scheme your consumers might still pin to (e.g. `1.x` LTS tags). This
   plugin has no way to tell you what's actually installed anywhere — that
   judgment call is yours, not the tool's.

3. **For each version you're dropping, delete it — one call, one version:**

   ```text
   delete_package_version {
     org: "octo-org",
     packageType: "npm",
     packageName: "widget-lib",
     versionId: 4821,
     confirmVersionId: 4821
   }
   ```

   `confirmVersionId` must equal `versionId` exactly, or the call fails
   with `confirmation_mismatch` before touching GitHub at all. There's no
   bulk-delete — each version is its own call, so a cleanup of 30 old
   versions is 30 calls, not one.

4. **Don't parallelize the deletes.** Run them one at a time and check each
   result before moving to the next. If a `delete_package_version` call
   fails partway through your list, you want to know exactly which
   versions are gone and which aren't — not guess based on how far your
   loop got.

5. **Spot-check afterward.** Call `list_package_versions` again and confirm
   the count dropped by exactly the number you deleted, and that the
   versions you meant to keep are still there.

## If you delete the wrong one

Package version deletes are restorable within GitHub's ~30-day window, as
long as nothing has since republished under that same version number:

```text
restore_package_version {
  org: "octo-org",
  packageType: "npm",
  packageName: "widget-lib",
  versionId: 4821
}
```

No confirm-echo guard here — restoring undoes a delete rather than causing
new loss, so the tool doesn't ask you to repeat the id back. See
[reference/tools.md](../reference/tools.md#restore_package_version) for the
exact return shape.
