# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
