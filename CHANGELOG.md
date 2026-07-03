# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `github-sdlc-planning` plugin (Tier-1): Issues, native sub-issues,
  Projects v2, Milestones, and Discussions behind a portable MCP core, a
  six-stage project-setup agent, and a Claude Code progressive-enhancement
  layer (hooks + skills). Every issue/discussion body carries MIF-conformant
  frontmatter, authored via a real dependency on `mif-docs@modeled-information-format`.
- `github-pull-requests` plugin (near-term #1): PR review-request routing and
  PR-to-issue link visibility, declaring a real same-marketplace `dependencies`
  edge on `github-sdlc-planning`.
- Attested-marketplace scaffold: `.claude-plugin/marketplace.json`, CI
  (`ci.yml`), quality gates (`quality-gates.yml`), fail-closed catalog
  admission (`catalog-admission.yml`), and a full release/attestation
  pipeline (`release.yml`) — SLSA build provenance, CycloneDX SBOM, seam-signed
  gate verdicts, cosign-signed catalog, OpenVEX disposition.
- Diátaxis documentation set (`docs/`), `SECURITY.md`, `CODEOWNERS`,
  `.vex/openvex.json`.
