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
COPY --from=builder /app/dist/index.js ./dist/index.js

ENTRYPOINT ["node", "dist/index.js"]
