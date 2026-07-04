# Base images are pinned by digest (OpenSSF Scorecard: Pinned-Dependencies).
# The :tag is kept alongside the digest for human readability; Dependabot's
# docker ecosystem keeps the digest fresh. Refresh with:
#   docker buildx imagetools inspect <image> --format '{{.Manifest.Digest}}'
FROM cgr.dev/chainguard/node:latest-dev@sha256:cb5ca16a7d09b83cbcb0fcedd2e26ef30bc22b011e2ab372684c7d612c64c66b AS builder
WORKDIR /app

# Manifests copied first so `npm ci` lands in its own layer, invalidated only
# when dependencies change, not on every source edit.
COPY package*.json ./
COPY tsconfig*.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Runtime stage: cgr.dev/chainguard/node's non-dev tag is distroless (Node
# binary only, no shell/npm/package manager) for minimal attack surface —
# same reasoning as this org's Rust images (Chainguard rebuilds from source
# continuously against Wolfi, unlike Debian-based distroless images that
# inherit whatever CVEs sit unpatched in Debian's stable branch). The
# esbuild bundle in dist/index.js is already self-contained (zero runtime
# npm dependencies, per this repo's own convention), so node_modules is
# never copied into this stage at all.
FROM cgr.dev/chainguard/node:latest@sha256:5280e63c3d2c81366056926b79f27f70e4adbd3a03a5b45c53503eac2b722b3f
WORKDIR /app
COPY --from=builder --chown=node:node /app/dist/index.js ./dist/index.js

# Chainguard's node image ships a non-root "node" user (uid 65532) by
# default, but the USER instruction is still explicit here so the
# non-root posture is visible in the Dockerfile itself, not only inferred
# from the base image (Trivy DS-0002).
USER node

# Minimal liveness check for a stdio-only server with no HTTP endpoint:
# confirms the node runtime itself starts and runs cleanly, not deeper
# MCP-protocol health (Trivy DS-0026).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["node", "-e", "process.exit(0)"]

ENTRYPOINT ["node", "dist/index.js"]
