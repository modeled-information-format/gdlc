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

List an org's packages and versions across npm, Maven, RubyGems, Docker
(legacy `docker.pkg.github.com`), Container (`ghcr.io`, GitHub's actual
Container Registry), NuGet, and generic registries; delete or restore a
package or a single version. Tier-3 domain #6 (Packages) — artifact
distribution, not a planning surface.

`docker` and `container` are distinct, non-interchangeable
`packageType` values — `docker` targets the legacy registry, `container`
targets `ghcr.io`, which is what most repos actually publish to today.

## Install

```
/plugin marketplace add modeled-information-format/gdlc
/plugin install github-packages@github-sdlc-plugins
```

No dependency on the sibling plugins — standalone, pure REST.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `list_org_packages` | List an org's packages of a given type — `packageType` is required; GitHub's real endpoint (verified live) has no "list every type at once" call |
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
org (defaults to `modeled-information-format`). Wired into
`.github/workflows/live-integration-tests.yml`'s `live-verify-packages`
job, which mints a token from the `release` App — the only one of this
org's six Apps with any `packages` permission (`packages: write`, reused
here read-only) — and runs it on `workflow_dispatch`. A personal token
without `read:packages` scope gets a graceful SKIP instead of a crash.
The four write tools are covered by the mocked unit suite only, never
against a real org's published packages.
