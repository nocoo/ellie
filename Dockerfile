# Ellie — unified multi-stage Dockerfile
# Usage:
#   docker build --build-arg APP=web  -t ellie-web .
#   docker build --build-arg APP=admin -t ellie-admin .

ARG APP=web
ARG BUN_STABLE_IMAGE=oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
# Bun 1.3.14 can crash after a Next.js 16.3 build when next-swc workers exit.
# The fix is only in canary until the next stable release (oven-sh/bun#36866).
ARG BUN_BUILD_IMAGE=oven/bun:canary@sha256:dd2479e914bd3ec71f26e6498d84efabd2d13581387c47d76a39814d89f03eb1

# ── Stage 1: Dependencies ──────────────────────────────────────────
FROM ${BUN_STABLE_IMAGE} AS deps
WORKDIR /app

# Copy all package.json files for workspace resolution
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
COPY apps/admin/package.json ./apps/admin/
COPY apps/worker/package.json ./apps/worker/
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
COPY packages/test-mocks/package.json ./packages/test-mocks/
COPY packages/ui/package.json ./packages/ui/
COPY packages/cli/package.json ./packages/cli/
COPY packages/db/package.json ./packages/db/
COPY packages/migrate/package.json ./packages/migrate/

RUN bun install --frozen-lockfile

# ── Stage 2: Build ─────────────────────────────────────────────────
FROM ${BUN_BUILD_IMAGE} AS build-runtime

FROM ${BUN_STABLE_IMAGE} AS builder
ARG APP
WORKDIR /app

COPY . .
COPY --from=deps /app/node_modules ./node_modules

# Re-run install to link workspace packages properly
RUN bun install --frozen-lockfile

# Keep dependency resolution on stable Bun so the frozen 1.3 lockfile remains
# unchanged; use the fixed runtime only while Next.js executes its build.
COPY --from=build-runtime /usr/local/bin/bun /usr/local/bin/bun

# Fail fast if APP is not web or admin
RUN case "$APP" in web|admin) ;; *) echo "ERROR: APP must be 'web' or 'admin', got '$APP'" >&2; exit 1;; esac

# Build-time placeholders only for libs that read env at module-init
# (next-auth). Real secrets are injected at runtime via container env.
ENV WORKER_API_URL=http://placeholder
ENV FORUM_API_KEY=placeholder
ENV ADMIN_API_KEY=placeholder
ENV AUTH_SECRET=placeholder
ENV AUTH_GOOGLE_ID=placeholder
ENV AUTH_GOOGLE_SECRET=placeholder

# NEXT_PUBLIC_* variables must be inlined at build time — Next.js bakes them
# into the client bundle. Setting them only at runtime leaves SSR Node seeing
# the value while the browser bundle sees an empty string, which produces a
# hydration mismatch (React #418) and hides client-side widgets like CAPTCHA.
ARG NEXT_PUBLIC_CAP_API_ENDPOINT=""
ENV NEXT_PUBLIC_CAP_API_ENDPOINT=${NEXT_PUBLIC_CAP_API_ENDPOINT}

RUN if [ "$APP" = "admin" ]; then \
      bun run build:admin; \
    else \
      bun run build:forum; \
    fi

# ── Stage 3: Runner ────────────────────────────────────────────────
FROM ${BUN_STABLE_IMAGE} AS runner
ARG APP
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# Copy standalone build
COPY --from=builder /app/apps/${APP}/.next/standalone ./
COPY --from=builder /app/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=builder /app/apps/${APP}/public ./apps/${APP}/public

# web listens on 7031, admin on 7032
EXPOSE 7031 7032

# Bake the app path into an env var so CMD can reference it at runtime
ENV APP_PATH=apps/${APP}/server.js
CMD ["sh", "-c", "bun $APP_PATH"]
