---
id: 7d3f4e21-9a6c-4b8e-8f2d-3c1a9e5b6d70
type: procedural
created: 2026-07-04T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-06T00:00:00Z
title: How the marketplace catalog gets pinned to a release
diataxis_type: how-to
---

The vendored plugins listed in `.claude-plugin/marketplace.json` reside
*inside* this same repository, and their entries point back at it: a
`git-subdir` source with `url:
https://github.com/modeled-information-format/gdlc.git`. A vendored,
self-hosted catalog entry gets the same discipline an external SHA-pinned
entry gets — see [add-a-plugin.md](add-a-plugin.md) and
[../explanation/attested-marketplace.md](../explanation/attested-marketplace.md).
Every release must re-pin every vendored entry to the released commit's exact SHA.
This re-pin is *triggered by* the release (via `pin-catalog`, no separate
manual step required for a routine release) — but it lands in a follow-up
commit on `main` merged *after* `publish` finishes, so a given release vN's
own tarball and signed catalog blob (the ones `SECURITY.md#verify-a-plugin-release`
tells you to download and verify) still show the **previous** release's pin,
not vN's own commit — a commit cannot contain its own hash. Fetch
`main`'s current `marketplace.json` (below, under "Verify it worked") if you
need the pin that actually reflects the release you just verified. This
document is the runbook for both the automated path and the manual fallback.

## Before tagging: bump the plugin manifests

`pin-catalog` stamps every self-referential catalog entry's `version` from
the release tag, but it never touches `plugins/*/.claude-plugin/plugin.json`
— bumping those to the tag version is a manual pre-tag step. Two gates
enforce it (issue #49): the release workflow's *"Vendored plugin manifests
must match the release version"* step fails the release before anything
publishes, and `catalog-admission`'s version-sync check blocks any PR whose
catalog and manifest versions disagree.

## What happens automatically

`.github/workflows/release.yml`'s `pin-catalog` job runs after `publish`
succeeds, on every tag push (`v*.*.*`), never on `workflow_dispatch` dry-runs:

1. Mints a short-lived installation token from the org's **catalog** GitHub
   App (`CATALOG_CLIENT_APP_ID` / `CATALOG_CLIENT_APP_PRIVATE_KEY` — see
   [Why an App, not a PAT](#why-an-app-not-a-pat) below) and checks out `main`
   with it.
2. Rewrites every vendored entry's `source.ref`/`source.sha` (and its
   `version` field) to the just-published tag/commit, in **one** commit —
   the entries always move together, since they ship from the same repo
   tarball. If the catalog is already pinned to that tag/sha, it exits
   without committing anything — idempotent if the job (or the whole release)
   is ever re-run.
3. Pushes a `chore/pin-catalog-<tag>` branch, opens a PR, and enables
   `gh pr merge --auto --squash`. The PR is not special-cased: it must clear
   every required check on `main` — `catalog-admission`, `marketplace-validate`,
   both MCP servers' test suites, `secrets`, `manifest-review`, `pin-check`,
   and `validate-workflows` — exactly like any other change. `catalog-admission`
   in particular re-verifies the new pin resolves to a real
   `.claude-plugin/plugin.json` at that commit before it can merge.

## Per-plugin dependency tags

Claude Code resolves a `plugin.json` semver-range dependency (e.g. a
different plugin declaring `"version": "^0.4.1"` against one of this repo's
7 plugins) by running `git ls-remote --tags` against this repo and matching
only tags shaped `{pluginName}--v{version}` — never the bare `vX.Y.Z` release
tag above. `release.yml`'s `tag-plugins` job runs right after `publish`, on
every tag push, and creates + pushes one such tag per plugin
(`plugins/*/.claude-plugin/plugin.json`) at the release commit, using the
same release App token as `publish`. It is idempotent: a re-run skips any
`{name}--v{version}` tag that already exists on `origin`.

Verify after a release:

```bash
git ls-remote --tags --repo modeled-information-format/gdlc | grep -- '--v<X.Y.Z>'
```

## Verify it worked

After a release, confirm the catalog was actually re-pinned:

```bash
gh pr list --repo modeled-information-format/gdlc --state merged \
  --search "chore(catalog): pin vendored plugins" --limit 1 \
  --json number,title,mergedAt

git fetch origin main
jq '.plugins[] | {name, source}' \
  <(git show origin/main:.claude-plugin/marketplace.json)
# Both entries' .source.sha should equal the release tag's commit:
git rev-parse v<X.Y.Z>
```

If `pin-catalog`'s run shows a failure, check the job logs first — most
failures are either the opened PR failing a required check (fix the check,
the branch auto-merges once green) or an expired/misconfigured
`CATALOG_CLIENT_APP_ID`/`CATALOG_CLIENT_APP_PRIVATE_KEY`.

## Manual fallback (if the automated job fails)

Do this exactly once, by hand, if `pin-catalog` fails and you need the
catalog current before diagnosing the automation. This is also how the
catalog's very first self-referential pin was bootstrapped (v0.1.0) — the
job only *re-pins* an existing `git-subdir` entry; promoting a plugin's very
first local relative-path source into a pinned one is a one-time manual step.

```bash
TAG="v0.2.0"                                       # the tag you just released
# git rev-parse alone returns the ANNOTATED TAG OBJECT's sha, not the commit
# it points at -- peel with ^{commit} or this pins to the wrong sha entirely
# (a real bug in an earlier version of this script, caught in review).
RELEASE_SHA="$(git rev-parse "${TAG}^{commit}")"
FILE=.claude-plugin/marketplace.json
SELF_URL="https://github.com/modeled-information-format/gdlc.git"

# Handles BOTH cases in one pass: re-pins an existing git-subdir entry to
# the new tag/sha, AND promotes a plugin still on a local relative-path
# string source (e.g. "source": "./plugins/<name>") into a pinned
# git-subdir entry for the first time. An earlier version of this script
# only matched entries already in object/git-subdir form -- for a
# string source, `(.source | type) == "object"` is false, the `and`
# short-circuits, and the entry is silently left untouched (caught in
# review: this script could never actually do the "first-time promotion"
# it claimed to document).
jq --arg ref "${TAG}" --arg sha "${RELEASE_SHA}" --arg ver "${TAG#v}" --arg url "${SELF_URL}" '
  .plugins = [.plugins[] |
    if (.source | type) == "object" and .source.source == "git-subdir" and .source.url == $url
    then .version = $ver | .source.ref = $ref | .source.sha = $sha
    elif (.source | type) == "string" and (.source | startswith("./plugins/"))
    then .version = $ver | .source = {
      source: "git-subdir",
      url: $url,
      path: (.source | sub("^\\./"; "")),
      ref: $ref,
      sha: $sha
    }
    else . end]
' "${FILE}" > "${FILE}.tmp" && mv "${FILE}.tmp" "${FILE}"

claude plugin validate .   # confirm it's still valid before committing

git switch -c "chore/pin-catalog-${TAG}"
git add "${FILE}"
git commit -m "chore(catalog): pin vendored plugins to ${TAG} (${RELEASE_SHA:0:7})"
git push -u origin "chore/pin-catalog-${TAG}"
gh pr create --title "chore(catalog): pin vendored plugins to ${TAG}" --body "Manual catalog pin (see docs/how-to/catalog-pinning.md)."
```

Branch protection on `main` requires `catalog-admission`, `marketplace-validate`,
both test suites, `secrets`, `manifest-review`, `pin-check`, and
`validate-workflows` — there is no admin bypass for required status checks
here, so this still goes through a PR like the automated path; wait for the
checks to pass, then merge.

## Why an App, not a PAT

Every "self-hosted marketplace pins itself" implementation needs *some*
credential that can push a re-pin commit; this org's answer is a GitHub App,
not a personal access token, for the same reason nothing else in this
repo's pipeline uses a PAT: a fine-grained PAT is scoped to one person's
account, expires silently, and isn't tracked anywhere; an App installation
token is short-lived, scoped to exactly this repo for the duration of one job,
and its permissions (`contents: write`, `actions: write`, `pull_requests:
write` — see `auth/apps.json` in the `.github` repo) are declared once and
audited by `app-manifest-validate.yml`.

`main`'s branch protection requires 8 status checks and has **no** bypass
allowance for the catalog App (confirmed via `gh api
repos/modeled-information-format/gdlc/branches/main/protection` — no
`bypass_pull_request_allowances`, `enforce_admins: false` only exempts human
admins, not App tokens). That is exactly why `pin-catalog` opens a PR and
auto-merges rather than pushing straight to `main`: an App-authenticated
direct push here would be rejected outright, the same way a first attempt at
skipping the PR would be for anyone else.

**Token rotation**: App installation tokens are minted fresh per job run and
expire in under an hour — there is nothing to rotate. If `pin-catalog`
starts failing with an auth error, the problem is the App itself (uninstalled,
or `CATALOG_CLIENT_APP_ID`/`CATALOG_CLIENT_APP_PRIVATE_KEY` org secrets
rotated/revoked) — check `auth/apps.json` in the `.github` repo and the org's
Actions secrets/variables, not a per-repo credential.

## Why this only applies to the vendored entries

Vendored entries are matched generically — any `plugins[]` entry whose `source`
is already an object with `source.source == "git-subdir"` **and** whose
`source.url` points back at this repo (`https://github.com/modeled-information-format/gdlc.git`)
gets its `ref`/`sha`/`version` rewritten to this release's tag/commit. A
**local** relative-path source
(`"./plugins/<name>"`, the starting state for a brand-new vendored plugin
before its first release) is never touched by this job — see
[add-a-plugin.md](add-a-plugin.md#2-add-an-entry-to-marketplacejson) for how
it gets promoted to a pinned entry on its first release. A genuinely
**external** plugin (a different repo entirely) is pinned by its own release
process and re-verified/re-pinned by the org's central
`plugin-catalog-update-hub.yml` (in the `.github` repo), not by this job —
this job only ever writes `sha`/`ref`/`version` on entries that already point
back at `modeled-information-format/gdlc`.
