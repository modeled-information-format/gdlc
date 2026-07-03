---
id: 980aba66-b9a7-4f87-9ead-ca59ab690acd
type: semantic
created: 2026-07-03T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-03T00:00:00Z
title: Gates
diataxis_type: reference
---
# Gates

Each gate is a thin, SHA-pinned caller of a `modeled-information-format/.github`
central reusable. The scanning gates normalize on SARIF and surface in the
**Security** tab; deploy-gating verdicts become attestations.

| Gate | Tool | Scans | Fail mode | Release predicate |
| --- | --- | --- | --- | --- |
| SAST | CodeQL (`languages: actions`) | This repo's **own workflows** | soft (Security tab) | `sast/v1` |
| SCA | OSV-Scanner | Both plugins' `mcp-server/` dependencies | soft (Security tab) | `sca/v1` |
| License / misconfig | Trivy | Repo + bundled assets | soft (Security tab) | `iac-license/v1` |
| ShellCheck | ShellCheck | Hook scripts | soft (Security tab) | `shellcheck/v1` |
| Semgrep | Semgrep | MCP / source | soft (Security tab) | `semgrep/v1` |
| Secrets | Gitleaks + TruffleHog | Repo history + tree | **hard** on verified live secrets (TruffleHog) | `secrets/v1` |
| Manifest review | manifest-review | `marketplace.json` + plugin manifests | **hard** | `manifest/v1` |
| Scorecard | OpenSSF Scorecard | Repo posture | soft (Security tab) | — (repo-level signal) |
| Manifest validation | `claude plugin validate` | Catalog + plugin manifests (canonical) | **hard** | — |
| Catalog admission | `catalog-admission` (custom, fail-closed) | SHA-pins, reserved-name, manifest resolution, attestation re-verify | **hard** | — |

> **CodeQL has no HCL or plugin extractor.** SAST therefore analyzes only this
> repo's own GitHub Actions workflow YAML — itself a real supply-chain attack
> surface — *not* the plugin payloads. Plugin shell, source, and manifests are
> covered by ShellCheck, Semgrep, secret scanning, and manifest-review.

**Manifest-review** asserts the marketplace-integrity invariants: every
external plugin source is SHA-pinned, the marketplace `name` is not a
reserved name, and required manifest fields are present.

**Attestation model.** Each plugin tarball carries SLSA build provenance
(`actions/attest-build-provenance`) and a CycloneDX SBOM (Syft +
`actions/attest-sbom`). Each gate verdict is seam-signed by the central
`reusable-attest-scan.yml` under the predicate namespace
`https://modeled-information-format.github.io/attestations/<gate>/v1`. The
`marketplace.json` catalog (a blob, not an OCI image) is signed with **cosign
keyless** (Sigstore Fulcio/Rekor) and verified with `cosign verify-blob`. The
release is fail-closed: nothing publishes unless every attestation verifies.
