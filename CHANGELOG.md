# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

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

### Test coverage

- `github-sdlc-planning/mcp-server`: 66 tests, 96.88% statements / 90.75%
  branches / 94.91% functions / 100% lines.
- `github-pull-requests/mcp-server`: 29 tests, 97.67% statements / 91.46%
  branches / 91.17% functions / 100% lines.
