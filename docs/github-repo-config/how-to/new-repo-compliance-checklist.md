---
id: 8d3f1a6b-2e7c-4d5a-9b3e-6f1c8a4d2e93
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: run a new-repo compliance checklist"
diataxis_type: how-to
---

A new repo just got created and, before it's treated as "really live,"
you want to confirm it meets your org's baseline: the community-health
files your org expects, its Pages setup (if it's supposed to have one), and
branch protection on its default branch. This chains three different
domains this plugin covers — health files, Pages, and branch protection —
into one checklist, rather than treating them as three unrelated
lookups.

## Steps

1. **Check the org's expected health files first**, so you know what
   "complete" means before checking the new repo against it:

   ```text
   list_org_health_files { org: "octo-org" }
   ```

   This reads from the org's `.github` repo (never `.github-private`) —
   it's the org-wide template set, not the new repo itself. If you need to
   see a specific file's actual content (to compare wording, not just
   presence), follow up with:

   ```text
   get_org_health_file { org: "octo-org", path: "CONTRIBUTING.md" }
   ```

2. **Check the new repo's Pages status**, if your org expects docs sites on
   new repos:

   ```text
   get_pages_config { owner: "octo-org", repo: "new-widget" }
   ```

   A `status` other than built/live here just means Pages isn't set up yet
   — that may be expected for a brand-new repo, not necessarily a
   compliance gap. Judge this against what your org actually requires, not
   against "Pages must always be on."

3. **Check current branch protection on the default branch:**

   ```text
   get_branch_protection {
     owner: "octo-org", repo: "new-widget", branch: "main"
   }
   ```

   A freshly created repo typically comes back with no protection at all
   — that's the expected starting point you're about to fix, not an
   error.

4. **Set the protection your org requires.** GitHub needs the full desired
   state in one call — an omitted field isn't "leave as-is," it silently
   disables that protection, so specify all three:

   ```text
   update_branch_protection {
     owner: "octo-org",
     repo: "new-widget",
     branch: "main",
     requiredStatusChecks: { strict: true, contexts: ["ci"] },
     enforceAdmins: true,
     requiredApprovingReviewCount: 1
   }
   ```

5. **Re-read branch protection to confirm it took**, using the same
   `get_branch_protection` call from step 3 — the return shape matches, so
   diffing the "before" and "after" responses tells you exactly what
   changed.

## Building this into a repeatable checklist

Since this plugin has no single "run all compliance checks" tool, the
repeatable unit is the sequence above, run manually (or scripted around
these same calls) against each new repo as it's created. Keep your org's
expected health-file list and required branch-protection settings written
down somewhere outside this plugin (a policy doc, a checklist template) —
the plugin reads and writes GitHub's state, it doesn't store or remember
what your org's policy is.
