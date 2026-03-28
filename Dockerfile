# ─────────────────────────────────────────────────────────────────────────────
# Chessstack — SvelteKit application
#
# Multi-stage build. Three stages keep the final image small:
#
#   Stage 0 (seeds)   — downloads compressed database dumps from the
#                        GitHub Release so every build environment (CI,
#                        Railway, local) is self-sufficient.
#
#   Stage 1 (builder) — installs all dependencies and runs `vite build`.
#                        Uses Alpine for fast installs.
#
#   Stage 2 (runner)  — copies only what is needed to run the app: the
#                        compiled build output, the production node_modules,
#                        the database migration files, seed data, and the
#                        Stockfish binary.
#
# No native compilation is needed — postgres.js (the PostgreSQL driver) is
# pure JavaScript, so no build tools (python, make, g++) are required.
# ─────────────────────────────────────────────────────────────────────────────


# ── Stage 0: Seed data ───────────────────────────────────────────────────────
# Downloads compressed database dumps from the GitHub Release.
# These get COPY'd into the final image for auto-seeding on first boot.
# Cached by Docker — only re-downloads when DATA_RELEASE changes.
FROM alpine:3.20 AS seeds

RUN apk add --no-cache curl

ARG GITHUB_REPO=pvttwinkle/chessstack
ARG DATA_RELEASE=data-v1.0

WORKDIR /seeds
RUN for f in chessmont-moves-dump.sql.gz puzzles-dump.sql.gz celebrity-moves-dump.sql.gz lichess-moves-dump.sql.gz; do \
      echo "Downloading $f..." && \
      curl -fSL -o "$f" \
        "https://github.com/${GITHUB_REPO}/releases/download/${DATA_RELEASE}/$f"; \
    done


# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first. Docker caches each layer — if package.json and
# package-lock.json have not changed, the `npm ci` layer is served from cache
# on subsequent builds, saving several minutes.
COPY package.json package-lock.json ./

# npm ci = clean install from the exact versions in package-lock.json.
# Preferred over `npm install` in CI/CD and Docker builds for reproducibility.
RUN npm ci

# Copy the rest of the source. This happens after npm ci so that changing a
# source file does not invalidate the node_modules cache layer.
COPY . .

# Build the SvelteKit app. With adapter-node, the output lands in /app/build.
# build/index.js is the Node.js HTTP server entrypoint.
RUN npm run build

# Remove devDependencies in-place so we can copy a leaner node_modules to the
# runner stage. Production deps only (postgres, drizzle-orm, bcryptjs, etc.).
RUN npm prune --omit=dev


# ── Stage 2: Production runtime ───────────────────────────────────────────────
# Debian bookworm-slim instead of Alpine because Stockfish is not available in
# Alpine's package repos. Debian's bookworm (stable) ships Stockfish 15 in its
# main repo. bookworm-slim strips out docs and locales to stay reasonably small.
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Install Stockfish (the chess engine), wget (needed for the healthcheck), and
# postgresql-client (psql — used to restore seed data on first boot).
# --no-install-recommends keeps the install lean.
# rm -rf removes the package index after install to reduce the layer size.
RUN apt-get update && \
    apt-get install -y --no-install-recommends stockfish wget postgresql-client && \
    rm -rf /var/lib/apt/lists/*

# Copy the pruned production node_modules from the builder stage.
COPY --from=builder /app/node_modules ./node_modules

# Copy the compiled SvelteKit app.
COPY --from=builder /app/build ./build

# Copy the Drizzle migration files. The app runs these automatically on startup
# to create tables on first run and apply new migrations on upgrades.
COPY --from=builder /app/drizzle ./drizzle

# Copy package.json. Node.js needs it to understand this is an ES module
# project ("type": "module" in package.json).
COPY --from=builder /app/package.json ./

# Copy the compressed database seed dumps from the seeds stage. On first boot,
# the app checks if the masters, puzzle, players, and stars tables are empty
# and restores these via psql.
COPY --from=seeds /seeds/ ./data/

# Remove system npm — the app is already built and doesn't need a package
# manager at runtime. This also eliminates CVEs in npm's bundled dependencies
# (tar, minimatch, glob) that are outside our control.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Tell Node.js and SvelteKit this is a production environment.
ENV NODE_ENV=production

# The port the Node.js HTTP server listens on. adapter-node reads this env var.
# Must match the port mapping in docker-compose.yml.
ENV PORT=3000

# Document the port — does not actually publish it (docker-compose does that).
EXPOSE 3000

# Health check — Docker polls this to know whether the container is healthy.
# Waits 30s for the app to start, then checks every 30s.
# The /api/health endpoint returns 200 + JSON and requires no authentication.
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

# Run as the non-root "node" user (uid 1000) that ships with the node:alpine image.
# The copied files are owned by root, but Node.js only needs read access.
USER node

# Start the Node.js server. build/index.js is generated by adapter-node.
CMD ["node", "build/index.js"]
