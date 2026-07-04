---
id: dfa0de8b-342b-4eb9-aca2-5b49bbfa5d0b
type: semantic
created: 2026-07-03T00:00:00Z
namespace: github-sdlc-plugins
modified: 2026-07-03T00:00:00Z
title: gdlc
diataxis_type: reference
---
<p align="center">
  <strong>gdlc</strong> — an attested Claude Code plugin marketplace for the
  GitHub SDLC planning domain.
</p>

# gdlc

An **attested Claude Code plugin marketplace**. Every plugin in this catalog —
and every constituent it ships (skills, agents, hooks, bundled MCP servers) —
is SHA-pinned (for external sources), scanned across the org's quality gates,
signed, and attested. A plugin's content enters the catalog only when its
attestations verify fail-closed in CI.

> The marketplace `name` in `.claude-plugin/marketplace.json` is
> **`github-sdlc-plugins`**. It is checked against Claude Code's reserved-name
> list and is not reserved.

## What this is

A plugin marketplace is a `marketplace.json` catalog plus the plugins it
lists. Claude Code resolves it when a user runs `/plugin marketplace add` and
installs plugins from it on demand. This repo turns the plugin distribution
path into an attested one, following the same pattern as the sibling
[`modeled-information-format/claude-code-plugins`](https://github.com/modeled-information-format/claude-code-plugins)
marketplace:

- Each plugin tarball gets **SLSA build provenance** and a **CycloneDX SBOM**.
- Each deploy-gating **gate verdict** (SAST, SCA, license/misconfig,
  ShellCheck, Semgrep, secrets, manifest-review) becomes a signed,
  digest-bound attestation.
- The `marketplace.json` catalog itself is **cosign-signed (keyless)**.
- A plugin is admitted to the catalog **only when all of its attestations
  verify** — admission, not convention, is the gate.

See [docs/explanation/attested-marketplace.md](docs/explanation/attested-marketplace.md)
for the full rationale.

> **Every gate is risk-reducing, not risk-eliminating.** A scanner finds the
> classes of problem it knows about; a signature proves origin and integrity,
> not safety. Attestation narrows the trust surface — it does not vouch that a
> plugin is benign.

## What ships

Five real plugins, vendored in-repo (two dependency-linked, three standalone):

```
.claude-plugin/marketplace.json   # the catalog (name: "github-sdlc-plugins")
plugins/
  github-sdlc-planning/            # Tier-1: Issues, sub-issues, Projects v2,
                                    # Milestones, Discussions — portable MCP
                                    # core + Claude Code enhancement layer.
                                    # Depends on mif-docs@modeled-information-format.
  github-pull-requests/            # Full PR lifecycle: create, classify,
                                    # review-route, link to issues, couple
                                    # to Projects v2. Depends on
                                    # github-sdlc-planning (same-marketplace,
                                    # real dependency edge).
  github-repo-config/              # Tier-3 (deferred domain, narrowly
                                    # scoped): branch protection/rulesets,
                                    # org .github community health files,
                                    # Pages status, custom repo properties.
                                    # Standalone, no dependency edge.
  github-insights/                 # Tier-3 (deferred domain): read-only
                                    # traffic, contributor stats, community
                                    # profile, dependency-graph/SBOM.
                                    # Standalone, no dependency edge.
  github-org-identity/             # Near-term #2: organization roles and
                                    # teams — list roles/assignments, assign
                                    # or remove a role for a team or user.
                                    # Standalone (no dependency edge); SAML/SSO
                                    # is out of scope.
external_plugins/                  # reserved for future git-subdir + sha plugins
docs/                               # Diátaxis docs (this README links into them)
```

## Quick start

```bash
# in Claude Code
/plugin marketplace add modeled-information-format/gdlc
/plugin install github-pull-requests@github-sdlc-plugins
```

Installing `github-pull-requests` auto-installs `github-sdlc-planning` as a
resolved dependency. `github-pull-requests@github-sdlc-plugins` reads as
*plugin `github-pull-requests` from the `github-sdlc-plugins` marketplace* —
the marketplace name, not the repo name.

Before trusting a release, verify it yourself: see [SECURITY.md](SECURITY.md)
and [docs/security/verify.md](docs/security/verify.md).

## Layout (canonical)

The repository follows Anthropic's documented plugin layout.

| Path | Required | Purpose |
| --- | --- | --- |
| `.claude-plugin/marketplace.json` | yes | The catalog: marketplace `name`, `owner`, and the `plugins` list |
| `<plugin>/.claude-plugin/plugin.json` | yes | Per-plugin manifest — required: `name` |
| `<plugin>/skills/` | optional | Skills |
| `<plugin>/agents/` | optional | Subagents |
| `<plugin>/hooks/` | optional | Event hooks (`hooks.json` + scripts) |
| `<plugin>/.mcp.json` | optional | Bundled MCP server definitions |

External plugin sources support a native **40-char `sha`** pin. When both
`ref` and `sha` are set, the `sha` is the effective pin.

## Priority-matrix roadmap

This marketplace is not built all at once. Tier-1 (`github-sdlc-planning`),
the full PR-lifecycle scope of `github-pull-requests` (create, classify,
review-route, link to issues, couple to Projects v2 — grown past the
priority matrix's original narrower "near-term #1: review-routing +
link-visibility" framing once that gap was confirmed as the project's chief
requirement), near-term #2 (`github-org-identity`: organization roles +
teams, read+write with a confirm-echo guard on writes; SAML/SSO out of
scope), and three narrowly-scoped Tier-3 domains (`github-repo-config`,
`github-insights`, `github-packages`) all ship. Three remaining deferred
domains (the broader Actions ecosystem beyond gh-aw, gitflow, the Audit Log)
stay documented follow-ups — each already has a citation-backed tier
rationale on record (and, for gitflow/Audit Log, a concrete reason it isn't
buildable/verifiable against this org: no GitHub-native API surface for
gitflow, and Audit Log requires GitHub Enterprise Cloud, confirmed 404
against this org's Free plan) — added as a new `plugins[]` entry only if
that changes.

## Gates and attestations

See the full table in [docs/reference/gates.md](docs/reference/gates.md).
Each gate is a thin SHA-pinned caller of an
`modeled-information-format/.github` central reusable.

## Where "fail-closed" actually lives

Claude Code does **not** verify plugin signatures or attestations at install
time yet (tracked upstream:
[anthropics/claude-code#30727](https://github.com/anthropics/claude-code/issues/30727)).
So this marketplace cannot rely on the installer to refuse an unverified
plugin. Enforcement instead lives at four points: catalog admission (a plugin
enters the catalog only after its attestations verify in CI), SHA-pinned
external sources, the cosign-signed catalog blob, and documented consumer
verification. See [docs/explanation/attested-marketplace.md](docs/explanation/attested-marketplace.md)
for why admission-time enforcement is the right seam regardless.

## Central gate pins

Every gate is a thin caller of the central
[`modeled-information-format/.github`](https://github.com/modeled-information-format/.github)
reusables, pinned to a released commit SHA and kept fresh by Dependabot's
`github-actions` updater.

## Documentation

Docs follow the [Diátaxis](https://diataxis.fr/) framework. Start at
[docs/README.md](docs/README.md).

| Mode | Document |
| --- | --- |
| How-to | [Add a plugin](docs/how-to/add-a-plugin.md) |
| Reference | [Gates](docs/reference/gates.md) |
| Explanation | [Why an attested marketplace](docs/explanation/attested-marketplace.md) |
| Security | [Verify a release](docs/security/verify.md) |

See also [SECURITY.md](SECURITY.md) for vulnerability reporting and the full
verification reference.
