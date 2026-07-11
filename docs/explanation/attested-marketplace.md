---
id: e1f20b1b-694f-4e8a-9ce2-251c6c507224
type: semantic
created: 2026-07-03T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-03T00:00:00Z
title: Why an attested marketplace
diataxis_type: explanation
---

A Claude Code plugin is executable trust. When you install one, its commands,
hooks, skills, and any bundled MCP servers run inside your environment —
reading your files, shaping your prompts, invoking tools on your behalf. The
promise made for binaries and IaC modules — *the thing you verified is the
thing that runs* — has to hold here too, because a plugin's blast radius is
your whole session.

The trouble is that a marketplace is, by default, a list of pointers. A
`marketplace.json` names plugins and where to fetch them; Claude Code resolves
and installs them on demand. Nothing in that loop, on its own, proves that the
plugin you install is the plugin that was reviewed, or that it hasn't changed
since. This repo closes that gap by making the distribution path attested:
content is pinned, scanned, signed, and admitted to the catalog only when its
attestations verify.

## The MCP / plugin supply-chain threat

Plugins inherit the Model Context Protocol's threat model and add the
marketplace's own.

- **Code execution on install/use.** Hooks run shell. MCP servers run
  processes. Skills and commands steer an agent that already has tool access.
  A malicious or compromised plugin is not data you can sandbox away — it is
  code that runs.
- **Mutable sources.** A plugin referenced by a tag or branch can have its
  content swapped after review without the reference changing. The fetch is
  trusted; there is no content lockfile by default.
- **Catalog tampering.** If the catalog itself can be altered or
  impersonated, an attacker redirects installs regardless of how careful each
  plugin author was.

### Rug-pulls

The sharpest version of the mutable-source risk is the **rug-pull**: a plugin
(or its dependency) is published and reviewed in a benign state, gathers
trust and installs, and is then quietly updated to a malicious version behind
the same name or a moved tag. Consumers who track the moving reference pull
the malicious update automatically. The defense is to make the *reviewed
content* the unit of distribution — pin to an immutable digest, and treat any
new digest as a new artifact that must earn admission again. A SHA-pinned,
signed catalog turns a rug-pull from a silent swap into a visible,
re-verifiable change.

## The three pillars

This marketplace is built on the same three-pillar pattern as its sibling
`claude-code-plugins` catalog.

1. **Attestation & signing.** Every plugin tarball carries SLSA build
   provenance (built by this repo's workflow from a named commit) and a
   CycloneDX SBOM, both bound to the artifact digest. Each deploy-gating gate
   verdict is seam-signed into a digest-bound in-toto attestation under
   `https://modeled-information-format.github.io/attestations/<gate>/v1`. The
   `marketplace.json` catalog blob is cosign-signed keyless. All of it
   re-verifies from a clean workstation with `gh attestation verify` and
   `cosign verify-blob` — no long-lived keys.
2. **Layered scanning.** No single scanner sees everything, so the gates
   layer: SAST (CodeQL over the workflows), SCA (OSV over both plugins'
   `mcp-server/` dependencies), Trivy (license + misconfig), ShellCheck (hook
   scripts), Semgrep (MCP source), secret scanning (Gitleaks + TruffleHog, the
   latter hard-failing on verified live secrets), and manifest-review. Each
   covers a class the others miss; each is **risk-reducing, not
   risk-eliminating**, and the layering is the point.
3. **Marketplace integrity.** The catalog is itself a gated, signed artifact.
   manifest-review fails closed unless every external plugin source is
   SHA-pinned, the marketplace `name` is not a reserved name, and required
   fields are present; `claude plugin validate` is the canonical structural
   check; and the signed catalog lets a consumer prove they fetched the
   published list, not an impersonation.

## Why catalog admission, not install-time enforcement

The natural place to enforce "only verified plugins run" is the installer:
refuse to install a plugin whose attestations don't verify. Claude Code does
**not** do this yet — there is no install-time signature or attestation check
(tracked upstream as
[anthropics/claude-code#30727](https://github.com/anthropics/claude-code/issues/30727)).
A marketplace that staked its guarantee on install-time blocking would be
claiming an enforcement it does not have.

So the enforceable seam is moved earlier, to **catalog admission**. A plugin
SHA enters `marketplace.json` only after its attestations verify in CI; the
cataloged content is pinned to an immutable digest; the catalog blob is
signed; and the exact consumer-side verification commands ship with every
release. The unit of trust becomes the *admitted catalog entry*, gated at
merge, rather than the install action.

This is the right seam even once install-time verification lands upstream.
Admission is where a human review and a fail-closed CI check coincide — the
moment a new plugin or a new version is actually being accepted into the
trusted set. Install-time blocking, when it arrives, will be a second,
complementary enforcement point at the consumer's edge; it does not replace
the need to gate what gets cataloged in the first place.

## The dependency chain, and where it's real

`github-pull-requests` declares a same-marketplace `dependencies` edge on
`github-sdlc-planning` — a real, live-verified mechanism (semver git-tag
resolution, transitive enable/disable, `range-conflict`/`dependency-unsatisfied`
errors), not a documentation-only claim. `github-sdlc-planning` in turn
declares a cross-marketplace dependency on `mif-docs@modeled-information-format`,
gated by this catalog's own `allowCrossMarketplaceDependenciesOn` allowlist.
`catalog-admission` exercises the admission-time half of both edges: it
resolves the same-marketplace dependency for real, and it enforces that the
cross-marketplace entry's `marketplace` field is on the allowlist. It does
not itself parse or validate the `version` range string — that resolution
(semver-range-to-git-tag matching, `range-conflict`/`dependency-unsatisfied`
errors) is Claude Code's own install-time behavior, and this repo's test
suite does not currently exercise it directly.
