# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# HRMS API -- production image for Cloud Run.
#
# Alpine is safe here despite `bcrypt` being a native module: bcrypt 6 ships a
# prebuilt `bcrypt.musl.node` via prebuildify, so nothing is compiled and no
# python/make/g++ toolchain is needed in the image. If bcrypt is ever replaced
# with a module lacking musl prebuilds, this needs a build stage with
# `apk add --no-cache python3 make g++` -- or a switch to the Debian slim tag.
# ---------------------------------------------------------------------------

# --------------------------------------------------------------- dependencies
FROM node:22-alpine AS deps

WORKDIR /app

# Manifests before source, so this layer is only rebuilt when a dependency
# actually changes. Editing a controller then reuses the cached install.
COPY package.json package-lock.json ./

# `ci` not `install`: it installs exactly the lockfile, fails if the manifest
# and lock disagree, and never silently upgrades a transitive dependency
# between a tested build and a deployed one.
RUN npm ci --omit=dev && npm cache clean --force

# -------------------------------------------------------------------- runtime
FROM node:22-alpine AS runtime

# Cloud Run injects PORT and the app reads it; 8080 is the default both sides
# agree on. NODE_ENV=production is what turns on Express's production paths and
# the JSON logger.
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

# Rotated log FILES are pointless on Cloud Run -- the disk is in-memory and
# dies with the instance. stdout goes to Cloud Logging instead.
ENV LOG_TO_FILE=false

# Absolute, and inside the writable app tree. Left at its default this resolves
# to `/attachments` (the image root), which the non-root user below cannot
# write to. See PHASE 15 in DEPLOYMENT.md: this path is EPHEMERAL and is not
# where employee documents should ultimately live.
ENV ATTACHMENTS_DIR=/app/data/attachments \
    UPLOAD_DIR=/app/data/uploads

WORKDIR /app

# Directories the app writes to at runtime, owned by the user that runs it.
# `node` (uid 1000) ships with the image; running as root is an unnecessary
# escalation path in a container that only serves HTTP.
RUN mkdir -p /app/data/attachments /app/data/uploads \
 && chown -R node:node /app

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

USER node

# Documentation only -- Cloud Run routes to $PORT regardless of EXPOSE.
EXPOSE 8080

# `node server.js` directly, not `npm start`: npm would sit between Cloud Run
# and the process as PID 1 and swallow the SIGTERM that server.js needs to
# drain in-flight requests and close MongoDB cleanly.
CMD ["node", "server.js"]
