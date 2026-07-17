# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.4] - 2026-07-17

### Fixed

- `github-sdlc-planning`: `get_session_context`'s board fallback and
  `withOptionalBoardCoordinates`/`withRequiredBoardCoordinates` resolved
  `.config/gdlc/config.yml` from the MCP server process's own cwd rather
  than the target repo, so a board lookup could silently miss the caller's
  actual project config (#274, #280); three more config-resolving call
  sites shared the identical root cause and are fixed the same way (#281,
  #284); `add_item_to_project`'s idempotency check queried an issue's own
  `projectItems` connection, unreliable for a project owned by a different
  org/user than the issue's repo, and now scans project-side instead
  (#282, #285); `configure-gdlc`/`project-setup`'s `tools:` frontmatter
  granted the wrong MCP tool-name namespace, silently leaving the
  subagent with zero usable tools (#276).
- `github-bug-capture`: `set_severity`/`set_lifecycle_state` failed with a
  false `issue_not_on_board` for items that genuinely exist on the board,
  same root cause as #273 — resolved via a project-side scan instead of
  the issue-side connection (#273, #283).
- Every skill's `allowed-tools:` frontmatter now grants both MCP
  tool-name forms, since a Skill's `allowed-tools:` is a permission
  allowlist (not a hard capability restriction the way an Agent's
  `tools:` is) and only granted one of the two forms a plugin-provided
  MCP server can resolve under (#279).
- The Agent tool cannot resolve a skill-only name as `subagent_type` (it
  only matches files under a plugin's `agents/` dir); 13 Skill-only
  capabilities across all seven plugins shared a name with no matching
  Agent, so any caller guessing skill-as-agent silently got the wrong
  resolution or none — disambiguated with `Skill-only` guidance (#287,
  #288).
- The ticket-hygiene lifecycle-comment hook's Stop/SubagentStop backstop
  replayed a `PostToolUse`-time finding verbatim even after a later
  same-turn action had already resolved it (#278, #286); its underlying
  `scanTranscriptForComment` also never matched a real Claude Code
  transcript line at all — every tool call lives in `message.content[]`
  as one or more `tool_use` blocks, not the bare `tool_name`/`tool_input`
  shape the scan actually checked, so both MCP comment tools and literal
  `gh issue|pr comment <N>` calls sharing a line with another tool call
  went undetected (#289, #290). Propagated identically to the two sibling
  hook copies per ADR-0007.

## [0.10.3] - 2026-07-12

### Added

- `github-sdlc-planning`: `get_gdlc_config`/`write_gdlc_config` MCP tools
  implementing ADR-0009 — explicit-target writes (never inferred via
  ancestor search), CST-preserving YAML writes via `yaml.Document`
  (untouched sections keep their formatting/comments byte-for-byte),
  zod-based per-section validation. A new `configure-gdlc` agent and
  matching skill elicit and write `.config/gdlc/config.yml` through a
  guided, confirm-before-write flow instead of hand-authored YAML (#253,
  #256, #260).
- `github-sdlc-planning`: automated config lifecycle hardening (#264) — a
  CI job validating any `.config/gdlc/config.yml` against the schema on
  every PR, and a non-blocking `SessionStart` hook that re-validates the
  resolved config and best-effort spot-checks the configured board against
  live GitHub state.

The remaining six plugins (`github-bug-capture`, `github-insights`,
`github-org-identity`, `github-packages`, `github-pull-requests`,
`github-repo-config`) carry no functional changes in this release; their
version bump is catalog-lockstep consistency only, per this repo's
version-discipline convention (issue #49).

## [0.10.2] - 2026-07-12

### Fixed

- `github-sdlc-planning` and `github-pull-requests`: `prLifecycle.localReviewer`
  defaulted to `/code-review:code-review --fix`, the plugin-qualified command
  from the `code-review@claude-plugins-official` marketplace plugin, which is
  PR-fetch-only and has no `--fix` handling -- the pre-PR local-review gate
  was asking agents to run something structurally incapable of running
  before a PR exists (#246). Default now points at native `/code-review
  --fix`, which reviews the current diff and can genuinely run pre-PR.
- `schema/gdlc-config.schema.json` (not inside any single plugin's
  directory): `prLifecycle` was missing the `gateNewWorkOnUnresolvedThreads`
  property, which the loader has supported since PR #193/#211 -- any config
  setting that field would be rejected by schema-validating tooling (#247,
  #250).

The remaining five plugins (`github-bug-capture`, `github-insights`,
`github-org-identity`, `github-packages`, `github-repo-config`) carry no
functional changes in this release; their version bump is catalog-lockstep
consistency only, per this repo's version-discipline convention (issue #49).

## [0.10.1] - 2026-07-11

### Changed

- `github-sdlc-planning`: widened the `mif-docs` cross-marketplace
  dependency range from `^0.3.1` to `>=0.3.1 <1.0.0` (#241). The caret
  range only resolved `>=0.3.1 <0.4.0`, silently excluding the
  already-released `mif-docs` v0.4.0 (a purely additive, opt-in-off-by-
  default feature) from resolution.

### Fixed

- Corrected two overstated claims in `SECURITY.md` and
  `docs/explanation/attested-marketplace.md` (#242, #243): `mif-docs` is
  not a SHA-pinned `marketplace.json` entry (it's a `dependencies[]`
  semver-range edge, resolved against upstream git tags, never a `sha`);
  `catalog-admission` only enforces the cross-marketplace entry's
  allowlist membership, never the same-marketplace edge or either edge's
  version-range resolution; and the `manifest-review` gate is soft-fail,
  not the fail-closed check for SHA-pinning (`catalog-admission` is).

## [0.10.0] - 2026-07-11

### Added

- `github-sdlc-planning`: `withOptionalBoardCoordinates` (used by
  `get_session_context`) now writes a one-time-per-process stderr
  diagnostic naming exactly what to configure when board resolution is a
  no-op, instead of falling back completely silently.

### Fixed

- Real fix for a config-cascade shadowing bug (Epic #227): the layered
  `.config/gdlc/config.yml` resolver previously stopped its upward
  ancestor search at the first directory with *any* config file, even if
  that file didn't define the section being resolved — silently
  shadowing a real ancestor override (e.g. a nested repo's own
  `board:`-only config hiding a workspace-root ancestor's `packs:`
  override) and falling through to the wrong layer instead. Now climbs
  every ancestor up to `$HOME`, resolving each section (`board:`/
  `packs:`/`prLifecycle:`) independently from the nearest ancestor that
  actually, validly defines it — using each section's own real
  parse/validate function as the sole presence oracle, never a separate
  synthetic predicate. Documented in [ADR-0008](docs/decisions/adr-0008-project-config-n-ancestor-resolution.md),
  amending ADR-0004/0005. Fixed identically across `github-sdlc-planning`
  (`config.ts`, `in-progress.mjs`, `settings.mjs`), `github-bug-capture`
  (`settings.mjs`), and `github-pull-requests` (`pr-lifecycle-config.mjs`).
- `github-sdlc-planning`/`github-bug-capture`: caught and fixed a related,
  previously-undetected bug via the above's regression tests —
  `resolveLayerPacks` was treating a `packs:` section's header line
  existing as "present," even with zero successfully-parsed keys (e.g. a
  comment-only body), instead of requiring at least one valid key. Diverged
  from `github-pull-requests`' `prLifecycle:` reader, which had already
  been fixed for the same class of bug once before.
- `github-sdlc-planning`: `config.ts`'s `normalizeConfig` now matches the
  hooks-layer reader's `board:` presence rule exactly — a `board:` header
  present but invalid (comment-only body, or every field malformed) now
  correctly stops the cascade there (resolving to an empty/partial board)
  instead of silently falling through to a further ancestor or the global
  layer, the opposite fall-through direction from `packs:`/`prLifecycle:`.
- `github-pull-requests`: `pr-readiness.ts`'s CLI script crashed when run
  from an installed plugin cache (issue #226) — it imported
  `@github-sdlc-plugins/github-sdlc-planning-mcp-server` via a path only
  resolvable inside this monorepo's npm workspaces, and the installed
  plugin cache's version-namespaced directory layout left even a correctly
  created dependency symlink dangling. Now bundled via esbuild
  (`dist/pr-readiness.js`) at build time, the same way the main MCP server
  already handles this cross-package import, so it runs standalone with no
  `node_modules` present. Also fixed the built file's shebang (`node`, not
  `tsx` — a bundled plain-JS file has no `tsx` dependency to invoke) and
  broadened its usage text to cover all three valid invocation forms.

## [0.9.0] - 2026-07-10

### Added

- `github-sdlc-planning`: new `get_project_status_profile` MCP tool and an
  XDG-conformant (`$XDG_CONFIG_HOME/gdlc/`) project-profile + user-prefs
  cache (`project-profile.ts`), so a board's real Status-field schema is
  discovered and cached once instead of assumed (Epic #198, Story #199).
- `github-sdlc-planning`'s `get_project_items`/`sync_linked_issues_project_field`:
  cursor-based pagination (`hasNextPage`/`endCursor`) — the prior
  `items(first: 100)` silently dropped items past the first page on any
  board over 100 items, causing false-negative `notFoundOnBoard` results
  (Story #200).
- `github-pull-requests`: new `review-thread-gate.mjs` PreToolUse hook that
  blocks new branch/worktree creation while a PR opened this session has
  unresolved review threads (Story #202), and `track-opened-prs.mjs` /
  `session-prs.mjs` to track which PRs a session has opened.
- `github-pull-requests`: PR-body closing-keyword validation — GitHub only
  auto-closes the first issue in a comma-separated `Closes #A, #B, #C` list;
  the hygiene hook now detects this and cross-checks post-merge that every
  referenced issue actually closed (Story #201).
- `hygiene-check.mjs` (canonical copy in `github-sdlc-planning`, propagated
  to `github-pull-requests`/`github-bug-capture`): now also checks
  `add_sub_issue`, `request_review`, and `sync_linked_issues_project_field`
  actions, previously matched by the hook's registration regex but silently
  no-op'd (Story #203).
- `set-in-progress.mjs`: now also flips a Todo/unset board item to In
  Progress on the first `Write`/`Edit`/`MultiEdit` touch in a session, not
  only on `add_sub_issue`/`update_issue` — closing an observed ~63 minute
  lag between work starting and the board reflecting it (Story #204).
- New `gateNewWorkOnUnresolvedThreads` config toggle (`prLifecycle` section),
  default `true`.

### Fixed

- Local review (3 passes, 2 Copilot rounds) across Epic #198 caught and
  fixed real bugs before this shipped: a Windows-broken hand-rolled
  `dirname` implementation, an unsafe `items?.pageInfo.hasNextPage`
  optional-chaining gap that could throw on a malformed GraphQL response,
  and a `yaml`-transitive-dependency violation of a module's stated
  dependency-free design. All have regression tests.

## [0.8.0] - 2026-07-10

### Added

- New `prLifecycle` config section (`.config/gdlc/config.yml`): `enabled`,
  `localReviewer`, `requireLocalReview`, `requireCopilotReview`,
  `requireCleanCodeScanning`. Fail-closed, off by default.
- Two new `github-pull-requests` hooks: `pr-lifecycle-gate.mjs` (PreToolUse
  on `create_pull_request`, asks naming the configured local-review command)
  and `pr-lifecycle-reminder.mjs` (PostToolUse, reminds to request Copilot
  review). Neither can invoke the review command itself — a hook can only
  spawn an OS process, not a slash command/skill.
- New `check_pr_readiness` MCP tool and CLI script (`npm run pr-readiness`)
  on `github-pull-requests`: a single settled/not-settled verdict combining
  status checks, review state, review-thread resolution, and code-scanning
  alerts, meant to be called by name from a Monitor loop instead of
  hand-rolled `gh api`/`jq` polling (Epic #185; Stories #186-#189).

### Fixed

- `check_pr_readiness`'s local review (3 passes) caught and fixed 5 real
  bugs before this shipped: the hooks-layer `prLifecycle` reader disagreeing
  with `config.ts`'s resolver on a present-but-malformed config section; two
  GitHub check-conclusion misclassifications (`ACTION_REQUIRED`/
  `STARTUP_FAILURE` counted as passing, `EXPECTED` counted as passing
  instead of pending); a blanket error-swallow on the code-scanning fetch
  that would have silently reported zero alerts on an auth failure; and a
  `requireCleanCodeScanning` toggle that was defined and documented but
  never wired into `check_pr_readiness`. All five now have regression tests.

## [0.7.2] - 2026-07-10

### Fixed

- `.github/workflows/catalog-admission.yml`'s "Verify each external pin
  resolves to a real plugin" step called `gh api` once per catalog entry
  with no retry, so a single transient GitHub API error failed the whole
  admission gate even though the pinned content was genuinely present.
  `resolve_pin()` now retries each entry up to 3 attempts with a short
  linear backoff (1s, then 2s), extracted into `scripts/lib/resolve-pin.sh`
  so the retry behavior itself is unit-tested (`scripts/test-resolve-pin-retry.sh`,
  wired in as its own CI step ahead of the real check) against a stubbed
  `gh` (issue #179, PR #182).
- `confirm-mutation.mjs`'s PreToolUse `ask` outranked every
  `permissions.allow` entry with no opt-out. Adds a fail-closed
  `skipMutationConfirm` pack toggle (default disabled), read via a new
  `hooks/lib/settings.mjs` (issue #183, PR #184).
- All 7 plugins' `mcp-server/src/index.ts` hardcoded `new McpServer({
  version: '0.6.0' })`, three releases stale (never bumped through 0.7.0 or
  0.7.1) even though the catalog, `plugin.json`, and `package.json` all
  agreed at 0.7.1. Brought in line with this release.

## [0.7.1] - 2026-07-10

### Fixed

- `github-sdlc-planning`, `github-pull-requests`, and `github-bug-capture`'s
  `hooks.json` matchers hardcoded the bare `mcp__<plugin>__<action>` MCP
  tool-name form; a marketplace-installed session actually exposes these
  tools as `mcp__plugin_<marketplace>_<plugin>__<action>`, so the matchers
  never matched and every one of these hooks (`set-in-progress.mjs`,
  `hygiene-check.mjs`, `validate-mif.mjs`, `confirm-mutation.mjs`) silently
  never ran in a real installed session — confirmed by
  `get_agent_capabilities` reporting `hooksSupported: false`. Matchers now
  match both tool-name forms, anchored on the required `mcp__` prefix so a
  non-MCP tool name can never match; `github-sdlc-planning`'s three
  internal scripts extract the action via a shared
  `lib/mcp-tool-name.mjs` helper instead of an exact bare-name comparison
  (issue #177, PR #178).

## [0.7.0] - 2026-07-10

### Added

- New ticket-hygiene reinforcement hooks ([ADR-0007](docs/decisions/adr-0007-ticket-hygiene-reinforcement-hooks.md)),
  shipped as byte-identical copies across `github-sdlc-planning`,
  `github-pull-requests`, and `github-bug-capture`: advisory-only
  PostToolUse/Stop hooks that nudge Status progression (the `In Review`
  gap left open by [ADR-0003](docs/decisions/adr-0003-board-status-hygiene.md)),
  a missing lifecycle comment, and unlinked sub-issues. Coverage spans
  three call surfaces uniformly — a plugin's own MCP tools, the generic
  `github` MCP server, and raw `gh` CLI invocations — and never blocks or
  exits non-zero. A new `hygiene-hook-drift-check` CI job guards the three
  copies against drift (Epic #156, PR #173).

### Fixed

- `checkLifecycleComment` (the ADR-0007 hygiene hook) can now resolve
  issue identity for a `set_field_value` touch — a Projects v2 Status
  change, the single most direct way an agent moves a board item — which
  previously went unchecked because that tool's own input/output carries
  only `itemId`/`fieldId`, never `owner`/`repo`/`number`. Resolves the
  `itemId` to real issue coordinates via a new async GraphQL round trip,
  failing open (no finding) on any ambiguity, the same as every other
  unresolvable case in this hook (issue #172, fixed by PR #174).

## [0.6.0] - 2026-07-09

### Added

- New `epic-pipeline` skill on `github-sdlc-planning`: composes the full
  plugin suite (`epic-decomposition`, `github-pull-requests`'s PR-lifecycle
  tools, `github-bug-capture`'s `file-bug`, `github-repo-config`'s
  branch-protection read) into one decompose-to-merged-PR pipeline,
  replacing hand-rolled `gh api graphql`/`gh pr create` calls with the
  plugin tools this marketplace already ships (#138).
- New internal `packages/singleflight-cache` package: the duplicated
  get-or-create/self-evict-on-rejection in-flight-promise-cache pattern
  from `github-sdlc-planning` and `github-org-identity` is now one shared,
  independently-tested implementation both consume via a `file:`
  dependency. No behavior change for either plugin (#133).

### Changed

- **Breaking:** `github-bug-capture`'s enhancement-pack toggles
  (`hooks`/`triage-skills`/`mcp-integration`/`gh-aw`) now read
  `.config/gdlc/config.yml`'s `packs:` section instead of
  `.claude/github-bug-capture.local.md` frontmatter. This is a deliberate
  reversal of ADR-0004's original "stays local-only" call
  ([ADR-0006](docs/decisions/adr-0006-eliminate-markdown-config-carriers.md)):
  pack toggles are now committed, team-shared policy rather than a personal,
  uncommitted per-developer setting. Anyone with an existing
  `.claude/github-bug-capture.local.md` must move its `packs:` map into
  `.config/gdlc/config.yml` by hand — there is no automated fallback.

### Removed

- **Breaking:** `github-sdlc-planning`'s legacy `board:` key fallback in
  `.claude/github-sdlc-planning.local.md` (deprecated by ADR-0004, kept
  working "for one release") is removed entirely. A repo still relying on it
  must migrate that key into `.config/gdlc/config.yml`'s `board:` section.
  After this change, no `.claude/<plugin>.local.md` config carrier remains
  anywhere in the plugin suite (issue #139, delivered by PR #145).

### Fixed

- The `github-sdlc-planning` MCP server's Docker image build (`docker-publish.yml`)
  no longer fails `npm ci` on every push to `main`. Its `package.json`
  depends on `@github-sdlc-plugins/singleflight-cache` via a monorepo-relative
  `file:` path that resolved outside the Docker build context (previously
  scoped to the mcp-server's own directory); the context is now the repo
  root, with a matching `.dockerignore` and a restructured `Dockerfile` that
  mirrors the same repo-relative layout the `file:` dependency expects
  (issue #147, fixed by PR #149).
- `github-bug-capture`'s `hooks` pack Stop-hook diagnostic-capture no longer
  re-triggers on every subsequent Stop event once a real failure signature
  is found. It previously had no memory of what it had already scanned, so
  its own prior notification (which quotes the triggering excerpt verbatim)
  became a fresh match on the next pass, compounding a layer of
  JSON-string-escaping each cycle. Fixed with a per-transcript high-water-mark
  and explicit exclusion of the hook's own previously-injected output from
  what it scans (issue #146, fixed by PR #148).
- `github-org-identity`'s organization-roles tools (`list_organization_roles`
  and the other six) now throw a typed `feature_unavailable` error, instead
  of a generic `github_api_error`, when the target org's plan doesn't
  support organization roles (a GitHub Enterprise Cloud-only feature) — a
  plan-tier precondition check runs before the call, memoized per org, and
  falls through to the real endpoint unchanged whenever the plan can't be
  determined from the resolved identity (#129). Docs across
  `docs/github-org-identity/` now document the fourth error code, which had
  landed code-only (#134).

## [0.5.1] - 2026-07-07

### Added

- Two new use-case-driven how-to guides per plugin (14 total) covering
  real end-to-end workflows across all seven plugins, on top of the
  existing one-per-MCP-tool how-to coverage (#121).

## [0.5.0] - 2026-07-07

### Fixed

- `github-sdlc-planning`'s `update_issue` `issueType` no longer silently
  no-ops: the REST PATCH now sends `type` as the bare type-name string per
  GitHub's documented shape, not `{ name: ... }` (issue #108).
- `create_issue` now derives a native `issueType` from `mif.type` when the
  caller omits it (`Task`→`Task`, `Bug`→`Bug`, else→`Feature`), so
  decomposition output is classified by default instead of needing a manual
  enrichment pass; an org without the derived type defined degrades to no
  type rather than failing the create (issue #108).
- `resolveToken()` no longer caches a GitHub token for the life of the MCP
  server process: a `gh auth switch` (or any credential change) mid-session
  now resolves correctly on the next call instead of requiring a restart.
  `assertProjectScope`'s own scope-check cache is now keyed by the resolved
  token, closing the same staleness class (issue #105).
- `loadGdlcConfig`/`readBoardConfig` now search upward from cwd toward the
  project root (git-style, like git/npm/tsconfig) for
  `.config/gdlc/config.yml`, so a cwd nested inside the project root (e.g. a
  build subdirectory) resolves the project-layer config where it previously
  didn't. `get_session_context` gained a `projectConfigPath` diagnostic
  field so the resolution outcome is now observable. Does not resolve a cwd
  that is an *ancestor* of the project root (e.g. a multi-repo workspace
  directory) — see ADR-0005 for the full analysis and the documented
  workaround (issue #106).

## [0.4.0] - 2026-07-06

### Added

- Layered global/project configuration system (epic #78, ADR-0004): a
  project-level `.config/gdlc/config.yml` and a global
  `$XDG_CONFIG_HOME/gdlc/config.yml`, merged per top-level section
  (project wins). Covers `targeting` (repo/org allowlist for issue
  capture), `destination` (default posted-issue target), and `board`
  (project-board mapping). The shared loader lives in
  `github-sdlc-planning`'s MCP server (`src/config.ts`, exported via a
  `./config` subpath) and is consumed directly by `github-bug-capture`
  (a new dependency edge on `github-sdlc-planning`, alongside its
  existing one on `github-pull-requests`).
- `create_issue`'s `owner`/`repo`, and `add_item_to_project`/
  `set_field_value`/`get_project_items`/`get_session_context`'s
  `projectOwnerLogin`/`projectNumber`, now default from the layered
  config when omitted (atomically — a partial pair is treated as
  unresolved, never mixed with a config-sourced value). `create_issue`
  additionally enforces a configured `targeting` allowlist, if any. Same
  defaulting applies to `github-bug-capture`'s `ensure_severity_field`/
  `set_severity`/`get_lifecycle_state`/`set_lifecycle_state`.
- `github-sdlc-planning`'s `set-in-progress` hook now reads the new
  `.config/gdlc/config.yml` board mapping first, falling back to the
  global layer, then — for one release, with a deprecation notice — the
  legacy `board:` key in `.claude/github-sdlc-planning.local.md`.
- Documentation: `docs/reference/config-schema.md` (the schema and
  cascade, with a verified end-to-end transcript), updated tool-reference
  and how-to docs across both plugins, and an Astro/Starlight
  documentation site scaffold (epic #67).

## [0.3.0] - 2026-07-05

Covers everything since v0.1.0; v0.2.0 was tagged without a changelog cut,
so its changes appear here as well.

### Added

- Consumer usage how-tos: `docs/how-to/plan-work-with-the-plugins.md`
  (decompose, board, milestone, PR, linkage, end to end) and
  `docs/how-to/use-bug-capture.md` (install, packs, severity, dedup,
  lifecycle, automation), linked from the root README's quick start.
- `github-bug-capture`: seventh vendored plugin, realizing the bug-capture
  research deliverable's BUILD decision. Layer 1 MCP core (severity
  triage-board tools, lifecycle state, keyword dedup,
  `close_as_duplicate` with `state_reason`), gh CLI wrapper library,
  Actions IssueOps templates, and four opt-in Layer 2 packs (diagnostic
  hooks, triage skills, MCP-integration doc, gh-aw batch triage
  template). Composes with `github-pull-requests` (linkage) and
  `github-sdlc-planning` (boards) per ADR-0001/0002.
- ADRs 0001-0003 moved from proposed to accepted, each with a compliance
  audit entry recording what shipped. ADR-0003's two decision items are
  implemented in `github-sdlc-planning`: `add_item_to_project` is now
  idempotent (it checks for an existing item on the target project before
  mutating, returning `{ itemId, existed: true }` instead of creating a
  duplicate), and a new `set-in-progress` `PostToolUse` hook moves a
  Todo-or-unset board item to In Progress when work starts against it (on
  `add_sub_issue`/`update_issue`, gated on a per-project
  `.claude/github-sdlc-planning.local.md` settings file). See
  `plugins/github-sdlc-planning/README.md`'s Hooks section and
  `docs/decisions/adr-0003-board-status-hygiene.md`.
- `github-pull-requests`: full PR lifecycle control, closing a gap between
  the plugin's originally-scoped "near-term #1" framing (review-routing +
  link-visibility) and its actual chief requirement (create, classify, and
  couple to Projects v2 too). Four new tools:
  - `create_pull_request` — opens a PR via the GraphQL `createPullRequest`
    mutation (not a `gh pr create` shell-out), so future MIF-frontmatter
    authoring can hook the same path issues already use.
  - `classify_pull_request` — applies `type:`/`size:`/`risk:` labels; size
    is computed automatically from the diff (`additions + deletions`,
    danger.js/PR-size-labeler-convention buckets XS–XL); same-category
    labels are replaced, not accumulated.
  - `add_pull_request_to_project` — adds a PR to a Projects v2 board via
    `addProjectV2ItemById`, sharing (not duplicating) the sibling
    `github-sdlc-planning` package's `resolveProjectNodeId`.
  - `sync_linked_issues_project_field` — for a merged PR, sets a Projects v2
    field on every same-repo issue it closes. Matches project-board items to
    linked issues by `number` **and** `repo` on both sides of the join — a
    Projects v2 board can hold items from multiple repos, so `number` alone
    is never a safe join key; cross-repo closing issues are reported in
    `skippedCrossRepo`, never guessed at.
  - `github-sdlc-planning`'s `get_project_items` now exposes `number` and
    `repo` per item (previously only `title`), and the package gained two new
    `exports` subpaths (`./resolvers`, `./tools/projects`) so
    `github-pull-requests` reuses the real, already-tested
    `resolveProjectNodeId`/`getProjectItems`/`setFieldValue` instead of
    re-implementing that GraphQL logic a second time.
  - Known limitation: `get_project_items`' `items(first: 100)` query has no
    pagination cursor, so a board with more than 100 items can report a
    genuinely-linked issue as `notFoundOnBoard` when it's simply outside the
    first page. Fixing this needs cursor-based pagination shared with that
    tool's other consumers (`session.ts`) — tracked as a follow-up, not
    fixed in this pass.
- Self-referential catalog pinning: both vendored plugin entries in
  `.claude-plugin/marketplace.json` are now `git-subdir` sources pointing back
  at this repo, pinned to a full 40-char commit SHA like any external catalog
  entry. `release.yml`'s new `pin-catalog` job re-pins both entries to the
  just-published tag/sha automatically after every release, using the org's
  `catalog` GitHub App and a gated PR/auto-merge flow (`main`'s branch
  protection has no bypass allowance for App tokens). See
  `docs/how-to/catalog-pinning.md`.

### Fixed

- CI workflows set up Node with `node-version: 'lts/*'` while every plugin's
  `mcp-server/package.json` declares `engines.node: ">=24"`. `lts/*` tracks
  whatever the current LTS major is at the time a job runs and could drift
  below the declared floor with nothing catching the mismatch (#51). Pinned
  `quality-gates.yml`, `release.yml`, and `live-integration-tests.yml` to
  Node 24 explicitly, matching the pin the gh-aw-generated
  `sprint-milestone-digest.lock.yml` already used.
- All six vendored plugin manifests, `mcp-server/package.json` files, and
  server version strings were synced to `0.2.0` to match the catalog, which
  the `v0.2.0` release had already advertised without the manifests
  following (#49). Two fail-closed gates now hold this invariant going
  forward: `catalog-admission` rejects a PR where a self-referential
  catalog entry's version disagrees with its manifest, and the release
  workflow refuses to publish a tag whose vendored manifests are not
  already bumped to the tag version.
- Corrected the `[0.1.0]` entry below: it claimed "workflow-scaffolding-as-code
  templates (add-to-project.yml, IssueOps board-command.yml), and an adaptive
  board-health gh-aw scaffold" shipped alongside `github-sdlc-planning`. None
  of those three ever existed in the repo (confirmed by a full-tree search) —
  only the project-template gallery in that same bullet was real. The
  `[0.1.0]` entry now describes only what actually shipped; the gh-aw
  integration remains a genuinely open Tier-1 item (priority-matrix row #7).

## [0.1.0] - 2026-07-03

### Added

- `github-sdlc-planning` plugin (Tier-1): Issues, native sub-issues,
  Projects v2, Milestones, and Discussions behind a portable MCP core (16
  tools), a six-stage project-setup agent, five skills (project-setup,
  epic-decomposition, sprint-plan, milestone-triage, template-gallery), and a
  Claude Code progressive-enhancement layer (SessionStart/PreToolUse/
  PostToolUse hooks). Every issue body carries MIF-conformant frontmatter via
  a native, portable `format_mif_issue_body`/`parse_mif_issue_body`
  implementation, plus a real dependency on `mif-docs@modeled-information-format`
  for longer-form planning documents. Creative enhancement shipped: a curated
  project-template gallery (`skills/template-gallery`, backed by
  `templates/manifest.yml`).
- `github-pull-requests` plugin (near-term #1, the primary driving
  deliverable): PR review-request routing and PR-to-issue link visibility (4
  tools), a `pr-review-route` skill, declaring a real same-marketplace
  `dependencies` edge on `github-sdlc-planning` — resolved by name, exercised
  by tests, not just documented.
- Both MCP servers are bundled with esbuild into a single self-contained
  `dist/index.js` (zero runtime dependencies) and committed to git, since
  Claude Code installs plugins from source with no build step.
- Attested-marketplace scaffold: `.claude-plugin/marketplace.json`
  (`allowCrossMarketplaceDependenciesOn: ["modeled-information-format"]`), CI
  (`ci.yml`), quality gates (`quality-gates.yml` — org-standard SAST/SCA/
  Trivy/Scorecard, plugin-constituent ShellCheck/Semgrep/secrets/
  manifest-review, plus build/test/lint for both MCP servers with a
  committed-dist/-matches-fresh-build check), fail-closed catalog admission
  (`catalog-admission.yml`), and a full release/attestation pipeline
  (`release.yml`) — SLSA build provenance, CycloneDX SBOM, seam-signed gate
  verdicts, cosign-signed catalog, OpenVEX disposition.
- Evals: per-skill `evals.json` (6 skills, autoresearch-validated) and
  per-MCP-server `evaluation.xml` QA pairs (18 questions total, independently
  verified against the actual implementation).
- Diátaxis documentation set (`docs/`), `SECURITY.md`, `CODEOWNERS`,
  `.vex/openvex.json`.

### Fixed

Found and fixed via real live-API testing (`verify:live`, not mocks) against
a sandbox repo — none of these were caught by the mocked unit test suite,
which is exactly why live verification exists:

- `assertProjectScope` rejected valid GitHub App installation tokens: it
  checked the `X-OAuth-Scopes` header, which only classic PATs populate, and
  treated its absence as "missing scope" for tokens that never carry it.
- `handleResponse` treated every 403 as rate-limited, discarding the real
  response body. A 403 is ambiguous — secondary rate limits, primary rate
  limits, and ordinary permission errors all return it, distinguished only by
  the `Retry-After` / `X-RateLimit-Remaining` headers, which are now checked
  explicitly instead of assumed.
- `GET .../requested_reviewers` and `POST`/`DELETE` on the same path return
  different response shapes (`{users, teams}` vs. the full PR object with
  `requested_reviewers`/`requested_teams` fields) — the code used the wrong
  shape for POST/DELETE, undetected because the mocked tests used the same
  wrong shape.
- `closingIssuesReferences` and Projects v2 item reads have real
  read-after-write lag; `verify:live` now retries with backoff instead of
  asserting instant consistency.
- Added a deterministic mutation-pacing governor (hard minimum interval
  between content-creating calls, independent of which MCP host drives the
  tools) after discovering the lack of one is what caused a real GitHub
  secondary rate limit during repeated test runs against the sandbox.

### Live verification

Both plugins' `verify:live` scripts pass in full against real GitHub state
(not mocks): every representative operation across both plugins succeeds,
including sub-issue creation, Projects v2 item/field writes, Discussions,
Milestones, and PR review-request routing with `closingIssuesReferences`
resolution. This is real-API proof the implementation is correct — it is
explicitly not the same claim as genuine cross-agent (dual MCP host)
verification, which has not been run; see
`docs/how-to/verify-cross-agent.md`.

### Test coverage

- `github-sdlc-planning/mcp-server`: 84 tests, 97.06% statements / 91.04%
  branches / 97.01% functions / 100% lines.
- `github-pull-requests/mcp-server`: 46 tests, 98.28% statements / 91.5%
  branches / 97.56% functions / 100% lines.
