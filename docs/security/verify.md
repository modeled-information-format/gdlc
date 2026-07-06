---
id: 6e56db6b-fd07-4f17-ae5f-4b8617581178
type: procedural
created: 2026-07-03T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-03T00:00:00Z
title: Verify a release
diataxis_type: how-to
---

This is a narrative walkthrough of the same commands in
[SECURITY.md](../../SECURITY.md#verify-a-plugin-release). Run it whenever you
install a `gdlc` release, or before approving a PR that adds or re-pins a
cataloged plugin.

## 1. Download the release tarball

```bash
gh release download v0.1.0 --repo modeled-information-format/gdlc \
  --pattern 'gdlc-*.tar.gz'
```

## 2. Verify SLSA provenance and the SBOM

```bash
TARBALL="gdlc-0.1.0.tar.gz"
REPO="modeled-information-format/gdlc"

gh attestation verify "$TARBALL" --repo "$REPO" \
  --predicate-type https://slsa.dev/provenance/v1

gh attestation verify "$TARBALL" --repo "$REPO" \
  --predicate-type https://cyclonedx.org/bom
```

Both should print `✓ Verification succeeded!`. If either fails, stop — do not
install the tarball.

## 3. Verify each seam-signed gate verdict

```bash
SEAM="modeled-information-format/.github/.github/workflows/reusable-attest-scan.yml"

for pt in shellcheck semgrep secrets manifest sast sca iac-license; do
  echo "=== ${pt} ==="
  gh attestation verify "$TARBALL" --owner modeled-information-format \
    --signer-workflow "$SEAM" \
    --predicate-type "https://modeled-information-format.github.io/attestations/${pt}/v1"
done
```

Each predicate's body carries the actual verdict — a passing signature proves
the gate *ran and recorded a result bound to this exact tarball digest*, not
that the result was clean. Read the predicate if you need the verdict itself,
not just proof it was recorded.

## 4. Verify the catalog signature

```bash
cosign verify-blob .claude-plugin/marketplace.json \
  --bundle marketplace.json.cosign.bundle \
  --certificate-identity-regexp '^https://github\.com/modeled-information-format/\.github/\.github/workflows/reusable-cosign-sign\.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## 5. What to do on failure

Treat any verification failure — a non-zero exit from `gh attestation verify`
or `cosign verify-blob` — as a supply-chain integrity breach. Do not install
or use the artifact; open a security advisory (see [SECURITY.md](../../SECURITY.md#reporting-a-vulnerability))
instead of a public issue.
