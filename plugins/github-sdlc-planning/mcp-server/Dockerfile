# Base images are pinned by digest (OpenSSF Scorecard: Pinned-Dependencies).
# The :tag is kept alongside the digest for human readability; Dependabot's
# docker ecosystem keeps the digest fresh. Refresh with:
#   docker buildx imagetools inspect <image> --format '{{.Manifest.Digest}}'
#
# Issue #147: this package.json depends on
# "@github-sdlc-plugins/singleflight-cache": "file:../../../packages/singleflight-cache" —
# a monorepo-relative path three levels above this Dockerfile's own
# directory. `npm ci` needs that target to actually exist wherever it
# resolves to, so the build context is the repo root (docker-publish.yml's
# `context: .` + `file:` pointing back at this Dockerfile), and the builder
# stage mirrors the same repo-relative directory layout the `file:` spec
# expects, rather than the single flattened /app this image used before
# that dependency existed.
FROM cgr.dev/chainguard/node:latest-dev@sha256:cb5ca16a7d09b83cbcb0fcedd2e26ef30bc22b011e2ab372684c7d612c64c66b AS builder
WORKDIR /repo

# The shared package's committed dist/ is copied whole (not just its
# package.json) because esbuild's bundle step below reads its compiled
# output directly to inline it — this package is never built inside the
# container, only consumed as already-built.
COPY packages/singleflight-cache ./packages/singleflight-cache

WORKDIR /repo/plugins/github-sdlc-planning/mcp-server

# Manifests copied first so `npm ci` lands in its own layer, invalidated only
# when dependencies change, not on every source edit.
COPY plugins/github-sdlc-planning/mcp-server/package*.json ./
COPY plugins/github-sdlc-planning/mcp-server/tsconfig*.json ./
RUN npm ci

COPY plugins/github-sdlc-planning/mcp-server/src ./src
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
COPY --from=builder --chown=node:node /repo/plugins/github-sdlc-planning/mcp-server/dist/index.js ./dist/index.js

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
