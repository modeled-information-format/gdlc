# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
