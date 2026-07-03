# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  for longer-form planning documents. Creative enhancements: a curated
  project-template gallery, workflow-scaffolding-as-code templates
  (add-to-project.yml, IssueOps board-command.yml), and an adaptive
  board-health gh-aw scaffold.
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
