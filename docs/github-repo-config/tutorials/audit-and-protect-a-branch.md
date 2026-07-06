---
id: 1c1703f9-3356-4a1d-b1cf-7a8de553dbff
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: "Tutorial: audit and set up branch protection on a repo"
diataxis_type: tutorial
---

This walks through using `github-repo-config`'s tools end to end against
a real repo: check what's currently governing the default branch,
compare it against the repo's rulesets, then set (and verify) branch
protection. By the end you'll have driven all three branch-protection
tools plus the two ruleset read tools in one session.

You'll need: the plugin installed (`/plugin install
github-repo-config@github-sdlc-plugins`), a `GITHUB_TOKEN` env var or an
active `gh auth login` session, and write access to a repo you're
comfortable protecting (use a scratch/sandbox repo, not something live,
while you're learning this). Branch-protection writes need `repo` scope
on a classic token, or the equivalent fine-grained permission.

## 1. See what's already there

Start by reading the current state — don't assume the branch is
unprotected just because you don't remember setting anything up:

```
get_branch_protection { "owner": "<you>", "repo": "<sandbox-repo>", "branch": "main" }
```

If nothing is configured yet, this call returns a `github_api_error`
(GitHub's protection-read endpoint 404s when no protection exists) —
that's expected and tells you the branch is currently open.

## 2. Check for rulesets too

Rulesets are the newer, forward-compatible mechanism and can coexist
with classic branch protection. List them before assuming protection is
the only thing governing merges:

```
list_repo_rulesets { "owner": "<you>", "repo": "<sandbox-repo>" }
```

If the list is non-empty, look at each one:

```
get_repo_ruleset { "owner": "<you>", "repo": "<sandbox-repo>", "rulesetId": <id> }
```

The response includes `bypassActors` — check this before setting
protection, since a ruleset that already blocks direct pushes changes
what protection you actually need to add.

## 3. Decide the desired state, then set it in one call

`update_branch_protection` requires the full desired state in every
field — there's no partial update. Decide all three values up front:

```
update_branch_protection {
  "owner": "<you>",
  "repo": "<sandbox-repo>",
  "branch": "main",
  "requiredStatusChecks": { "strict": true, "contexts": ["ci / build"] },
  "enforceAdmins": true,
  "requiredApprovingReviewCount": 1
}
```

`contexts` must match the exact check-run name GitHub reports
(`workflow-name / job-name`), not a display label — a bare or
mismatched name silently blocks nothing. If you don't want a required
status check yet, pass `requiredStatusChecks: null` explicitly rather
than omitting the field (the schema requires it either way).

## 4. Verify the change actually landed

Re-run the read tool rather than trusting the write call's own echoed
response as the last word:

```
get_branch_protection { "owner": "<you>", "repo": "<sandbox-repo>", "branch": "main" }
```

Confirm `requiredStatusChecks`, `enforceAdmins`, and
`requiredApprovingReviewCount` match what you set in step 3.

## 5. (Optional) Tear it down

If this was a scratch exercise, remove the protection you just added.
`delete_branch_protection` requires you to echo the branch name back as
`confirmBranch` — a mismatch is refused before any API call, which is
the tool's guard against removing protection from the wrong branch by
typo:

```
delete_branch_protection {
  "owner": "<you>",
  "repo": "<sandbox-repo>",
  "branch": "main",
  "confirmBranch": "main"
}
```

Run `get_branch_protection` once more to confirm it 404s again.

## What you've learned

You've now driven the full read → cross-check-against-rulesets → write
→ verify → (optionally) remove cycle for branch protection, and used
both ruleset read tools along the way. The same read-verify discipline
applies to the plugin's other domains: check
[reference/tools.md](../reference/tools.md) for the full tool list, and
the `how-to/` directory for a recipe per tool.
