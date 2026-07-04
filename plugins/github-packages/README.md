---
id: e317ed9e-de06-490e-93d3-aa0d49418df0
type: semantic
created: 2026-07-04T00:00:00Z
namespace: github-sdlc-plugins/github-packages
modified: 2026-07-04T00:00:00Z
title: github-packages
diataxis_type: reference
---
# github-packages

List an org's packages and versions across npm, Maven, RubyGems, the
container (Docker/OCI) registry, NuGet, and generic registries; delete
or restore a package or a single version. Tier-3 domain #6 (Packages) —
artifact distribution, not a planning surface.

## Install

```
/plugin marketplace add modeled-information-format/gdlc
/plugin install github-packages@github-sdlc-plugins
```

No dependency on the sibling plugins — standalone, pure REST.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `list_org_packages` | List an org's packages, optionally filtered by package type |
| `get_org_package` | Get a single package by name and type |
| `list_package_versions` / `get_package_version` | List/get a package's versions |
| `delete_package` / `delete_package_version` | Delete a package or a single version — restorable only within GitHub's ~30-day window and only if nothing has since republished under the same name/version |
| `restore_package` / `restore_package_version` | Restore a deleted package or version within that same window |

## Confirm-echo contract on writes

`delete_package` and `delete_package_version` require the target
name/id twice, under two different field names
(`packageName`/`confirmPackageName`, `versionId`/`confirmVersionId`). A
mismatch throws `confirmation_mismatch` **before** making any API call.
`restore_package`/`restore_package_version` carry no such guard —
restoring undoes a delete rather than causing new loss, a different risk
direction than the delete tools.

## No visibility-mutation API

There is no GitHub REST endpoint to change a package's visibility
(public/private) — only GET, DELETE, and POST .../restore exist for any
auth type, including GitHub App installation tokens. This plugin doesn't
attempt to expose one because none exists to expose.

## Live verification

`scripts/verify-live.ts` exercises the four read tools against a real
org (defaults to `modeled-information-format`). Run manually — the four
write tools are covered by the mocked unit suite only, never against a
real org's published packages.
