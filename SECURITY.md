# Security Policy

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Report security issues using the
[GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
feature for this repository (Security → Advisories → "Report a vulnerability"),
or by emailing the maintainer directly.

We will respond within 72 hours and coordinate a fix and disclosure timeline.

---

## Where enforcement lives

Claude Code does **not** verify plugin signatures or attestations at install
time yet (tracked upstream:
[anthropics/claude-code#30727](https://github.com/anthropics/claude-code/issues/30727)).
This marketplace therefore cannot rely on the installer to refuse an
unverified plugin. Enforcement lives at four points instead:

1. **Catalog admission** — a plugin SHA enters `marketplace.json` only after
   its attestations verify in CI (fail-closed at merge).
2. **SHA-pinned catalog** — external plugin sources (currently `mif-docs`) are
   pinned to a 40-char `sha`, so cataloged content is immutable.
3. **Cosign-signed catalog** — the `marketplace.json` blob is keyless-signed,
   so a consumer can prove the catalog they fetched is the one this repo
   published.
4. **Documented consumer verification** — the commands below let any consumer
   re-check a release from a clean workstation before trusting it.

Native install-time, install-blocking verification is the missing piece — a
flagged upstream gap, not a property this marketplace can yet enforce.

> **Every gate is risk-reducing, not risk-eliminating.** A passing
> verification proves a gate *ran and recorded a verdict* bound to the subject
> digest. It does not certify the plugin is benign.

---

## Verify a plugin release

Each release is a tarball signed with GitHub's Sigstore-backed (keyless, OIDC)
attestation infrastructure. Anyone can re-verify from a clean workstation —
there are no long-lived signing keys.

### Prerequisites

- [GitHub CLI](https://cli.github.com/) `gh` ≥ 2.49.0, authenticated
  (`gh auth login`)
- [`cosign`](https://github.com/sigstore/cosign) (for the catalog signature)

Set the variables once. **Substitute the real tarball filename.**

```bash
TARBALL="gdlc-0.1.0.tar.gz"   # the downloaded release tarball
REPO="modeled-information-format/gdlc"
SEAM="modeled-information-format/.github/.github/workflows/reusable-attest-scan.yml"
```

### 1. SLSA build provenance + CycloneDX SBOM

These are produced by this repo's own release workflow, so they verify with
`--repo`:

```bash
gh attestation verify "$TARBALL" --repo "$REPO" \
  --predicate-type https://slsa.dev/provenance/v1

gh attestation verify "$TARBALL" --repo "$REPO" \
  --predicate-type https://cyclonedx.org/bom
```

### 2. Seam-signed gate verdicts

The artifact-characterizing gates are each signed by the central attestation
seam (`reusable-attest-scan.yml`). Under SLSA Build L3 the Fulcio signer
identity is that central workflow, so `--owner`/`--repo` alone is **not**
sufficient — pin `--signer-workflow`, one predicate per command:

```bash
for pt in shellcheck semgrep secrets manifest sast sca iac-license; do
  gh attestation verify "$TARBALL" --owner modeled-information-format \
    --signer-workflow "$SEAM" \
    --predicate-type "https://modeled-information-format.github.io/attestations/${pt}/v1"
done
```

---

## Verify the catalog signature

The `marketplace.json` catalog is a blob (not an OCI image), signed with
**cosign keyless** (Sigstore Fulcio/Rekor). Verify the downloaded catalog
against its detached bundle:

```bash
cosign verify-blob .claude-plugin/marketplace.json \
  --bundle marketplace.json.cosign.bundle \
  --certificate-identity-regexp '^https://github\.com/modeled-information-format/\.github/\.github/workflows/reusable-cosign-sign\.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The `--certificate-identity-regexp` pins the **signer workflow** — keyless
signing binds the Fulcio certificate to the central `reusable-cosign-sign.yml`
in `modeled-information-format/.github` (the workflow that ran the signing
job), not to this repo — and `--certificate-oidc-issuer` pins the OIDC issuer
to GitHub Actions. A signature that verifies under any other identity or
issuer is not this catalog.

---

## What a passing verification looks like

```
Loaded digest sha256:abc123... for file://gdlc-0.1.0.tar.gz
Loaded 1 attestation from GitHub API
✓ Verification succeeded!
```

A failed verification exits non-zero. **Treat any verification failure as a
supply-chain integrity breach — do not install or use the artifact.**

> **Signed ≠ passed.** A passing verification proves the gate *ran and
> recorded a verdict* bound to the subject digest. Read the predicate body for
> the verdict itself.

---

## What the attestations prove

| Attestation | Predicate type | Signer | What it proves |
| --- | --- | --- | --- |
| SLSA build provenance | `https://slsa.dev/provenance/v1` | this repo's release workflow | The tarball was built by this repo from a specific commit, untampered after signing |
| CycloneDX SBOM | `https://cyclonedx.org/bom` | this repo's release workflow | The tarball is bound to a CycloneDX bill of materials |
| ShellCheck | `.../attestations/shellcheck/v1` | seam (`reusable-attest-scan.yml`) | ShellCheck ran over hook scripts and recorded a verdict |
| Semgrep | `.../attestations/semgrep/v1` | seam | Semgrep ran over MCP / source and recorded a verdict |
| Secrets | `.../attestations/secrets/v1` | seam | Gitleaks + TruffleHog ran and recorded a verdict |
| Manifest review | `.../attestations/manifest/v1` | seam | Manifests passed integrity review (SHA-pins, non-reserved name, required fields) |
| SAST | `.../attestations/sast/v1` | seam | CodeQL ran over this repo's workflows and recorded a verdict |
| SCA | `.../attestations/sca/v1` | seam | OSV ran over both plugins' `mcp-server/` dependencies and recorded a verdict |
| License / misconfig | `.../attestations/iac-license/v1` | seam | Trivy ran (misconfig + license) and recorded a verdict |
| Catalog signature | cosign keyless blob signature | this repo's signing workflow | The `marketplace.json` catalog blob is the one this repo published |

Attestations are stored in the GitHub Attestations API and signed via
Sigstore's keyless infrastructure (Fulcio CA + Rekor transparency log). They
cannot be forged without control of the repository's GitHub Actions OIDC
token.

For a narrative walkthrough of consumer verification, see
[docs/security/verify.md](docs/security/verify.md).

---

## Supply-chain security posture

- Every GitHub Action is pinned to a full 40-character commit SHA — never a
  mutable tag or branch. The `pin-check` CI job enforces this on every push
  and PR and is a required status check.
- Every external plugin source in `marketplace.json` (currently `mif-docs`) is
  pinned to a 40-char `sha`; the **manifest-review** gate fails closed if any
  is not.
- The release pipeline is fail-closed: every attestation must verify before a
  plugin SHA is admitted to the catalog and before a release publishes. There
  is no path from build to publish that bypasses verification.
