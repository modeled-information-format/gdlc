---
id: 948ab5ce-411a-4fce-9162-91897801ce64
type: procedural
created: 2026-07-03T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-03T00:00:00Z
title: Add a plugin to the catalog
diataxis_type: how-to
---
# Add a plugin to the catalog

A plugin joins this marketplace by being **cataloged**: either vendored
in-repo (like `github-sdlc-planning` and `github-pull-requests`) or, for a
future external plugin, referenced by a SHA-pinned `git-subdir` source that CI
re-verifies fail-closed before the entry can merge. A plugin SHA that does not
verify does not enter the catalog.

The external flow:

```
author plugin -> its repo attests its tarball (provenance + SBOM + gate verdicts)
  -> add a git-subdir + sha entry to marketplace.json
  -> catalog-admission re-verifies the attestations fail-closed
  -> merge
```

## Before you start

- The plugin must follow the [canonical layout](../../README.md#layout): a
  `.claude-plugin/plugin.json` with required `name`, plus any of
  `skills/ agents/ hooks/ .mcp.json`.
- An **external** plugin's source repo must produce an attested tarball —
  SLSA build provenance, a CycloneDX SBOM, and the seam-signed gate verdicts —
  at a specific commit. Catalog admission verifies *those* attestations; it
  does not re-scan the plugin from scratch.
- A **vendored** (in-repo) plugin instead goes through this repo's own
  `quality-gates.yml` and `release.yml` directly — no separate SHA-pin step,
  since there's no external source to pin.

## 1. For an external plugin: resolve the source commit SHA

Pin to an immutable 40-char commit SHA, never a tag or branch. Resolve it at
use time:

```bash
gh api repos/<owner>/<plugin-repo>/git/ref/tags/<tag> \
  --jq '.object.sha'
```

## 2. Add an entry to `marketplace.json`

**Vendored (in-repo)** — a local relative-path source:

```jsonc
{
  "name": "<plugin-name>",
  "source": "./plugins/<plugin-name>",
  "description": "<one-line summary>",
  "version": "0.1.0",
  "author": { "name": "modeled-information-format" },
  "category": "planning",
  "license": "MIT",
  "keywords": ["<...>"]
}
```

**External** — a `git-subdir` + `sha` entry (the `sha` is the effective pin;
`ref` is a human-readable label only):

```jsonc
{
  "name": "<plugin-name>",
  "description": "<one-line summary>",
  "author": { "name": "<author>" },
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/<owner>/<repo>.git",
    "path": "plugins/<plugin-name>",
    "ref": "v1.2.3",
    "sha": "<40-char-commit-sha>"
  },
  "license": "<SPDX-id>",
  "keywords": ["<...>"]
}
```

## 3. Declare cross-plugin dependencies, if any

- **Same-marketplace dependency** (e.g. `github-pull-requests` on
  `github-sdlc-planning`): a bare name or `{"name": "...", "version": "..."}`
  entry in the dependent plugin's own `plugin.json` `dependencies` array. No
  catalog-level change needed — resolution happens by name within this
  marketplace.
- **Cross-marketplace dependency** (e.g. `github-sdlc-planning` on
  `mif-docs@modeled-information-format`): the target marketplace must be
  listed in this catalog's `allowCrossMarketplaceDependenciesOn`, and the
  dependent plugin's `plugin.json` names the dependency explicitly with a
  `marketplace` field. Without the allowlist entry, install fails with a
  `cross-marketplace` error.

## 4. Open a PR — catalog admission runs fail-closed

The **catalog-admission** gate runs on every pull request (so it can be a
hard required status check) and fails closed unless **all** of these hold:

- every external plugin source is pinned to a full 40-char `sha` — a `ref`
  without a `sha` is mutable and rejected;
- the pinned `sha` **actually resolves to a plugin**: admission fetches the
  `.claude-plugin/plugin.json` at that commit and rejects the entry if it is
  not there;
- the marketplace `name` is not an Anthropic-reserved name;
- `claude plugin validate` passes (canonical manifest check);
- each external entry's pinned release **attestations verify fail-closed**
  (SLSA provenance).

The soft-fail **manifest-review** (`manifest/v1`) gate reports the same
SHA-pin findings to the Security tab. `catalog-admission` is set as a
**required** check in branch protection so the pin requirement is enforced at
merge, not by convention.

## 5. Verify, then merge

In-pipeline green is not the acceptance test. Re-verify the pinned plugin's
attestations independently from a clean workstation before approving — the
exact commands are in [SECURITY.md](../../SECURITY.md#verify-a-plugin-release)
and [../security/verify.md](../security/verify.md).

Once admission passes and the attestations re-verify, merge. The merged
`marketplace.json` is re-signed (cosign keyless) as part of the release so
consumers can prove they fetched the catalog this repo published.

## Updating a cataloged plugin

For a **vendored** plugin, bump its `version` in both `plugin.json` and its
`marketplace.json` entry and let the normal release pipeline attest the new
content. For an **external** plugin, re-pin its `sha` to the new commit and
let catalog admission re-verify the new digest's attestations. Never edit a
plugin's content in place behind an unchanged SHA — a different content hash
is a different artifact, and the old attestations do not describe it.
