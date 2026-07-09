# gdlc-native mechanics for the epic pipeline

Background material for `../SKILL.md`. Load this when a step's rationale
needs checking, or when a tool call fails in a way SKILL.md's prose doesn't
already explain.

## Tool inventory across all seven plugins

| Plugin | Tools this pipeline can reach |
| --- | --- |
| `github-sdlc-planning` | `create_issue`, `update_issue`, `add_sub_issue`, `list_sub_issues`, `add_item_to_project`, `set_field_value`, `get_project_items`, `create_milestone`, `list_milestones`, `assign_milestone`, `create_discussion`, `list_discussions`, `format_mif_issue_body`, `parse_mif_issue_body`, `get_session_context`, `get_agent_capabilities` |
| `github-pull-requests` | `create_pull_request`, `classify_pull_request`, `request_review`, `list_review_requests`, `remove_review_request`, `get_linked_issues`, `add_pull_request_to_project`, `sync_linked_issues_project_field` |
| `github-bug-capture` | `get_agent_capabilities`, `ensure_severity_field`, `set_severity`, `get_lifecycle_state`, `set_lifecycle_state`, `search_similar_issues`, `close_as_duplicate` |
| `github-repo-config` | `get_branch_protection`, `update_branch_protection`, `delete_branch_protection`, `list_repo_rulesets`, `get_repo_ruleset`, `get_pages_config`, `get_repo_custom_properties`, `set_repo_custom_properties`, `list_custom_properties_schema`, `get_org_health_file`, `list_org_health_files` |
| `github-org-identity` | `list_organization_roles`, `assign_user_role`, `assign_team_role`, `remove_user_role`, `remove_team_role`, `list_role_users`, `list_role_teams` |
| `github-packages` | `list_org_packages`, `get_org_package`, `list_package_versions`, `get_package_version`, `delete_package`, `delete_package_version`, `restore_package`, `restore_package_version` |
| `github-insights` | `get_repo_traffic_views`, `get_repo_traffic_clones`, `get_repo_contributor_stats`, `get_community_profile`, `get_dependency_graph_sbom` |

The pipeline's core loop (Phases 1–2) lives in the first two rows.
`github-bug-capture` (the third row) is used by default whenever Phase 2
execution surfaces a defect, via `file-bug`/`set_lifecycle_state`. The
remaining four (`github-repo-config`, `github-insights`, `github-packages`,
`github-org-identity`) are genuinely situational, not decorative — reach for
them when the Epic actually calls for it, not on every run:

- **`github-repo-config`**: Phase 0's branch-protection read is always in
  scope. `get_repo_custom_properties`/`get_org_health_file` are worth a look
  when the Epic touches governance (e.g. a Task that changes CODEOWNERS or
  required checks) — read-only, never call `update_branch_protection` or
  `set_repo_custom_properties` from inside this pipeline; a governance
  change is its own explicit, separately-confirmed action.
- **`github-insights`**: pull `get_repo_contributor_stats` or
  `get_dependency_graph_sbom` when sizing a Story/Task split matters (a
  low-contributor repo argues for smaller Tasks; a dependency-graph read
  matters when the Epic is itself a dependency bump).
- **`github-packages`**: relevant when a Task is a release/publish step —
  check `list_package_versions`/`get_org_package` before and after, never
  `delete_package`/`delete_package_version` without a separate, explicit
  user request (those are destructive and out of this pipeline's scope).
- **`github-org-identity`**: relevant only when the Epic itself is an
  access-provisioning task (e.g. "give the new contributor write access
  before assigning them a Task"); not part of the default flow.

## Native Projects v2 automation (ADR-0003)

A project board can have GitHub's eleven built-in Projects v2 workflows
enabled: auto-add on issue creation, auto-Todo on add, auto-Done on
close/merge. Whether a *given* target board has these enabled is not
knowable in advance — this repo's own org project (#1) does; a board
`$ARGUMENTS` targets in another repo might not. That's why the pipeline
never assumes either way:

- `add_item_to_project` is idempotent (`existed: true` on a duplicate) —
  call it unconditionally rather than probing first.
- Only write `Status` when a read shows it's actually unset. A board with
  the workflow already set it; a board without one needs this pipeline to
  set it. Reading first is what makes one code path correct for both.
- The `set-in-progress` hook (`hooks/set-in-progress.mjs`) is the one
  transition with no native GitHub event: it fires on `add_sub_issue`/
  `update_issue` and moves a Todo-or-unset item to In Progress, gated on a
  configured board mapping (see below). It never touches Done or any other
  status — so a Done item this pipeline reads is trustworthy without a
  separate check.
- Done needs nothing from this pipeline where the workflow exists — it
  fires on close/merge. `sync_linked_issues_project_field` is for *other*
  fields (a "Shipped in" iteration, a release column), not a second
  Done-setter; don't conflate the two.

## Config layering (ADR-0004 / ADR-0005)

`destination.repo` and `board.{projectOwnerLogin,projectNumber,
projectOwnerType}` resolve from two YAML layers, project overriding global,
per top-level section:

1. Project layer: `<projectRoot>/.config/gdlc/config.yml` (committed,
   team-shared).
2. Global layer: `$XDG_CONFIG_HOME/gdlc/config.yml` (default
   `~/.config/gdlc/config.yml`).
3. Legacy fallback (one release only, deprecated): a `board:` key in
   `.claude/github-sdlc-planning.local.md`.

Omit `owner`/`repo` or `projectOwnerLogin`/`projectNumber` on a tool call to
let this resolution fill them in — but only ever omit both of a pair, never
one (`missing_destination`/`missing_board_config` otherwise). When
resolution seems wrong, `get_session_context`'s `projectConfigPath` field
names the actual file that was found (or `null` if none was), which is the
fast way to debug a stale-looking default instead of guessing.

## PR-to-issue linkage ownership (ADR-0002)

`github-pull-requests` owns all PR↔issue linkage: `get_linked_issues`
(`closingIssuesReferences`, with retry for GitHub's read-after-write lag),
`sync_linked_issues_project_field`, and PR classification. `github-bug-capture`
consumes this rather than reimplementing it, and so does this pipeline —
never hand-parse a PR body for `Closes #N`/`Fixes #N` text when
`get_linked_issues` can confirm the real, structural linkage GitHub itself
resolved. Cross-repo closing references are real but GitHub doesn't honor
them for auto-close; `get_linked_issues` reports these in `skippedCrossRepo`
so they can be flagged for a manual link instead of silently assumed closed.

## Auth and rate-limit gotchas worth knowing before a failure, not after

- Projects v2 **mutations** need the `project` OAuth scope on a classic PAT
  (`assertProjectScope`); reads don't. App installation tokens (`ghs_`) and
  fine-grained PATs (`github_pat_`) never populate the classic
  `X-OAuth-Scopes` header — an absent header on one of those token types is
  not evidence of a missing scope, only a real `missing_scope` error from
  the call itself is.
- Every plugin's `github-client.ts` enforces a hard 1000ms minimum interval
  between mutating calls, serialized across concurrent callers. Bulk steps
  in this pipeline (creating several sub-issues, filing several bugs) will
  naturally take a few seconds longer than the calls alone suggest — that's
  the pacing working as intended, not a hang.
- Copilot PR review only fires on a **non-draft** PR. If Phase 2 opens the
  PR as a draft for any reason, request Copilot review only after marking
  it ready.
- `GET .../pulls/{n}/requested_reviewers` returns `{users, teams}`, not
  `requested_teams` — relevant if this pipeline ever needs to read back who
  is already requested rather than just requesting more.
