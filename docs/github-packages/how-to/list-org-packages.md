---
id: 8cd80ebb-718c-4fa3-b6d8-dc841af1bdb3
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: List an org's packages
diataxis_type: how-to
---
# List an org's packages

List all of an org's packages of one registry type.

## Steps

1. Decide which `packageType` you want: `npm`, `maven`, `rubygems`,
   `docker` (legacy `docker.pkg.github.com`), `container` (`ghcr.io`),
   `nuget`, or `generic`. GitHub's real endpoint requires this — there is
   no single call that lists every type at once.
2. Call the tool:

   ```text
   list_org_packages { org: "your-org", packageType: "npm" }
   ```

3. Read the result: an array of `{ id, name, packageType, visibility,
   versionCount }`, one entry per package of that type.

To audit every type an org publishes, repeat step 2 once per known type
and combine the results — this is exactly what the `package-audit` skill
does.

## Common mistake

Confusing `docker` and `container`: `docker` only sees packages on the
legacy Docker registry. If your org publishes container images via
`ghcr.io` (the common case today), use `packageType: "container"` instead —
`docker` will return an empty or wrong result, not an error.
