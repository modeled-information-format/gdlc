---
id: 79be04d5-f42d-46b5-8476-fd6633df3892
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: "Tutorial: audit an org's packages, then delete and restore a version"
diataxis_type: tutorial
---
# Tutorial: audit an org's packages, then delete and restore a version

This tutorial walks through the full read/write surface of
`github-packages` end to end: listing an org's packages, inspecting one,
deleting a single version, and restoring it. By the end you'll have used
all 8 tools at least once.

**Before you start:** pick a package version you can afford to delete and
restore without consequence — ideally a throwaway test package, or an old
version of a real package that nothing currently depends on. The delete
step in this tutorial is real and hits the live GitHub API; it is not a
dry run. Restoring afterward puts the version back within GitHub's ~30-day
recovery window, but don't run this tutorial against a version you can't
risk losing if the restore step fails for any reason.

## 1. Install the plugin

```text
/plugin marketplace add modeled-information-format/gdlc
/plugin install github-packages@github-sdlc-plugins
```

No sibling plugins are pulled in — `github-packages` is standalone.

## 2. Authenticate

The plugin resolves a token from `GITHUB_TOKEN` first, falling back to
`gh auth token`. Package operations need `read:packages` for reads and
`delete:packages` for the write tools:

```text
gh auth login --scopes read:packages,delete:packages
```

## 3. List your org's packages

`packageType` is required by GitHub's real endpoint — there's no single
call that lists every type at once. Start with the type you know you have
packages in, e.g. `npm`:

```text
list_org_packages { org: "your-org", packageType: "npm" }
```

You get back an array of `{ id, name, packageType, visibility,
versionCount }`. Pick one package name from the result to inspect further.

## 4. Inspect one package

```text
get_org_package { org: "your-org", packageType: "npm", packageName: "your-package" }
```

This confirms the single-package shape matches what you saw in the list
call, and gives you the current `versionCount`.

## 5. List its versions

```text
list_package_versions { org: "your-org", packageType: "npm", packageName: "your-package" }
```

You get back `{ id, name, createdAt }` for each version. Pick the `id` of
the version you decided in step 0 you can afford to delete and restore.

## 6. Inspect that version

```text
get_package_version { org: "your-org", packageType: "npm", packageName: "your-package", versionId: 123456 }
```

Confirm this is the exact version you intend to touch — note its `name`
before proceeding, so you can recognize it after restore.

## 7. Delete the version

`delete_package_version` requires you to pass the version id twice — once
as `versionId`, once as `confirmVersionId` — and refuses the call before
touching the API if they don't match:

```text
delete_package_version {
  org: "your-org",
  packageType: "npm",
  packageName: "your-package",
  versionId: 123456,
  confirmVersionId: 123456
}
```

This is a live, real delete. It is restorable only within GitHub's ~30-day
window, and only if nothing republishes under the same version in the
meantime.

## 8. Confirm it's gone

```text
list_package_versions { org: "your-org", packageType: "npm", packageName: "your-package" }
```

The version id from step 5 should no longer appear.

## 9. Restore it

`restore_package_version` carries no confirm-echo guard — restoring undoes
a delete rather than causing new loss:

```text
restore_package_version { org: "your-org", packageType: "npm", packageName: "your-package", versionId: 123456 }
```

## 10. Confirm it's back

```text
get_package_version { org: "your-org", packageType: "npm", packageName: "your-package", versionId: 123456 }
```

The `name` should match what you noted in step 6.

You've now exercised all 8 tools. The same pattern (list → inspect →
delete-with-confirm → restore) applies to whole packages via
`delete_package`/`restore_package`, except deleting a whole package removes
every version at once — see
[how-to/delete-package.md](../how-to/delete-package.md) before trying that.
