---
id: f195fe85-72c5-4087-8d31-8eff14996487
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Why github-packages exists
diataxis_type: explanation
---

`github-packages` is one of this marketplace's standalone Tier-3 plugins —
it has no dependency on `github-sdlc-planning` or any sibling plugin, and no
plugin depends on it. Its domain is narrow and mechanical: read and manage
the artifacts an org has published to GitHub Packages, across seven
registry flavors — npm, Maven, RubyGems, the legacy Docker registry
(`docker.pkg.github.com`), the Container registry (`ghcr.io`), NuGet, and
generic packages.

## The domain: list, inspect, delete, restore

The plugin's 8 tools split cleanly into two risk classes:

- **Read tools** (`list_org_packages`, `get_org_package`,
  `list_package_versions`, `get_package_version`) are safe to call freely —
  they only ever return data.
- **Write tools** (`delete_package`, `delete_package_version`,
  `restore_package`, `restore_package_version`) mutate state. The two delete
  tools carry a confirm-echo guard (the caller must pass the target name/id
  twice, under two different field names) that fails closed with a
  `confirmation_mismatch` error before any API call is made. The two
  restore tools carry no such guard, because restoring undoes a delete
  rather than causing new loss — a different risk direction, so it gets a
  different amount of friction.

This mirrors a pattern used across the marketplace's other write-capable
plugins: the confirm-echo contract exists specifically because package
deletion is only recoverable within GitHub's roughly 30-day retention
window, and only if nothing has since republished under the same
name/version. Past that window, or past a republish, deletion is permanent.

## `docker` vs `container` — not interchangeable

The `packageType` enum includes both `docker` and `container` as distinct
values. `docker` targets packages on the legacy `docker.pkg.github.com`
registry; `container` targets GitHub's actual Container Registry
(`ghcr.io`), which is what most repos publish container images to today.
Passing the wrong one for a given package returns a 404, not a helpful
redirect — GitHub's API treats them as genuinely separate namespaces.

## Known limitation: no visibility-mutation API

This plugin cannot toggle a package's visibility (public/private), and it
never will, because no such endpoint exists. GitHub's REST API exposes only
GET, DELETE, and `POST .../restore` for packages — for any auth type,
including GitHub App installation tokens. Changing a package's visibility
is a web-UI-only operation. This is confirmed in the plugin's own
`README.md` ("No visibility-mutation API" section), not merely inferred —
the plugin's tool set was designed around this constraint rather than
attempting to route around it. Anyone scripting a full package-lifecycle
workflow needs to treat visibility changes as a manual, out-of-band step.

## Why REST directly, no dependency on sibling plugins

Unlike `github-pull-requests` (which depends on `github-sdlc-planning` for
issue linkage) or `github-bug-capture` (which depends on both, per
ADR-0001/ADR-0002), `github-packages` has no cross-plugin coupling. Package
management doesn't intersect with issue/PR/planning state in any way that
warrants a dependency edge — it's pure REST against `/orgs/{org}/packages`
and its sub-resources, authenticated the same way as every sibling plugin
(`GITHUB_TOKEN` env var first, `gh auth token` fallback), with the same
1000ms mutation-pacing governor the other write-capable plugins use to stay
under GitHub's undocumented secondary abuse-rate limit.
