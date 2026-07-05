# Org provisioning: issue types and typed issue fields

One-time, org-wide configuration the bug-capture plugin builds on (issue
#32): the **Bug issue type** and the **severity/priority typed issue
fields**. Everything below was verified against the
`modeled-information-format` org with read-only API calls on **2026-07-05**;
API responses are quoted from that verification. Typed issue fields are a
GitHub **public preview** (announced May 2026) — re-verify before relying on
this document once the feature reaches general availability.

## a) Org-level `Bug` issue type — already provisioned

The org defines three enabled issue types: `Task`, `Bug`, `Feature`
(created 2026-06-24). No provisioning action is needed.

Verification command:

```bash
gh api /orgs/<org>/issue-types
```

Observed for this org (2026-07-05): `Bug` present with id `34531193`,
node_id `IT_kwDOEazZic4CDud5`, color `red`, `is_enabled: true`.

Detection predicate (prints `true` when provisioned):

```bash
gh api /orgs/<org>/issue-types --jq 'any(.[]; .name=="Bug" and .is_enabled)'
```

Reading the endpoint worked with an ordinary org-member token. Creating,
renaming, or disabling issue types is managed in the organization settings
web UI and requires **organization owner** rights — an automation token
scoped for repo/issue writes cannot do it.

## b) Org-wide typed issue fields (public preview)

### Observed state (2026-07-05)

`GET /orgs/<org>/issue-fields` responds (the preview endpoint exists and is
readable with an org-member token). The org has **four** fields, all
`visibility: organization_members_only`, created 2026-06-24:

| Field | `data_type` | Options |
| --- | --- | --- |
| `Priority` | `single_select` | Urgent / High / Medium / Low |
| `Start date` | `date` | — |
| `Target date` | `date` | — |
| `Effort` | `single_select` | High / Medium / Low |

So: **priority is provisioned; a `Severity` field is not.** The plugin's
label convention (`severity:*`, applied by `scripts/gh-bug.sh` and the
`workflows/` templates) and the triage board's `Severity` single-select
field (the `ensure_severity_field` MCP tool) work without it; an org-wide
typed Severity field would additionally make severity a first-class issue
attribute across all repos.

Detection commands:

```bash
# List all typed issue fields with their types:
gh api /orgs/<org>/issue-fields --jq '[.[] | {name, data_type}]'

# Predicate: prints true when a Severity field exists, false when absent:
gh api /orgs/<org>/issue-fields --jq 'any(.[]; .name=="Severity")'
```

Observed for this org (2026-07-05): the predicate prints `false`.

### API surface observed

- `GET /orgs/<org>/issue-fields` — **works** (collection read, verified).
- `GET /orgs/<org>/issue-fields/<id>` — returns **404 Not Found** (verified
  with an existing field id); the preview exposes only the collection read.
- No create/update/delete REST call was exercised (they would mutate org
  state); none is assumed to exist. As of the verification date the
  provisioning path is the web UI.

### Manual provisioning steps (org-admin required)

Creating or editing typed issue fields happens in the organization settings
web UI and requires **organization owner** rights; automation tokens
(fine-grained PATs, GitHub App installation tokens) cannot perform it and
`GITHUB_TOKEN` in a workflow cannot either.

1. As an org owner, open the organization's **Settings**.
2. Open the issue **fields** configuration (where the existing `Priority`,
   `Start date`, `Target date`, and `Effort` fields of this org are listed).
3. Create a new single-select field named `Severity` with options
   `Critical`, `High`, `Medium`, `Low` (matching the triage board's field
   options and the `severity:*` label levels, in that order).
4. Choose its visibility (this org's existing fields use
   *organization members only*).
5. Re-run the detection predicate above and confirm it prints `true`.

There is no severity-specific automation to run afterwards: the plugin
detects org state at use time and its label/board conventions are
independent of the typed field.
