---
id: 2f6a8d1c-4b9e-4a3d-8c1f-5e7b3a9d6f28
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: standardize custom properties across repos"
diataxis_type: how-to
---

Your org uses custom repository properties (a `team-owner` tag, a
`data-classification` value, whatever your governance model needs) and a
batch of repos has drifted — missing the property, or holding an
inconsistent value. You want to bring them all in line in one pass instead
of clicking through each repo's settings.

## Steps

1. **Check what properties your org actually has defined** before setting
   anything — you can't set a property that isn't in the org's schema:

   ```text
   list_custom_properties_schema { org: "octo-org" }
   ```

   Note the exact `propertyName` and `valueType` for the property you're
   standardizing (string vs. an array of allowed values).

2. **See where each candidate repo currently stands**, one repo at a time:

   ```text
   get_repo_custom_properties { owner: "octo-org", repo: "widget-app" }
   ```

   Do this for a sample of your target repos first, not all of them — it
   tells you whether you're dealing with "property is missing entirely"
   or "property is set but wrong," which changes how confident you should
   be before the bulk write.

3. **Build your repo list and target values, then set them in one call.**
   This is a genuine bulk operation — one call sets the same properties
   across every repo you name, not one call per repo:

   ```text
   set_repo_custom_properties {
     org: "octo-org",
     repoNames: ["widget-app", "widget-api", "widget-docs"],
     properties: [
       { propertyName: "team-owner", value: "platform-team" }
     ],
     confirmRepoCount: 3
   }
   ```

   `confirmRepoCount` must equal the length of `repoNames` exactly — it's
   not a separate approval step, just a check that you counted your own
   list correctly before an org-wide write goes out. Get the count wrong
   and the call fails with `confirmation_mismatch` before touching
   anything.

4. **Spot-check a few repos afterward** with `get_repo_custom_properties`
   again to confirm the value actually landed, especially if `properties`
   included more than one property in the same call.

## Why this is one call, not a loop

Unlike most of this plugin's other tools (which operate on one repo per
call), `set_repo_custom_properties` is deliberately bulk — the reference
notes it can retarget properties across every named repo in one write.
That's the whole point of using it over, say, calling a hypothetical
per-repo setter in a loop: fewer calls, and `confirmRepoCount` catches a
mis-sized repo list before any of them get written, rather than partway
through a loop.

## If a repo in your list doesn't have the property in its schema at all

`set_repo_custom_properties` writes values for properties the org has
already defined (from step 1) — it doesn't create new property
definitions. If `list_custom_properties_schema` doesn't show the property
you want, that's an org-level schema change outside this plugin's tool
set; this plugin only reads and writes values against an existing schema.
