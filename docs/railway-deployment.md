# Railway Deployment Guide

This document describes how to deploy the ellie monorepo to Railway.

## Architecture

The monorepo contains two deployable Next.js apps:

| App | Directory | Purpose |
|-----|-----------|---------|
| `web` | `apps/web` | Forum frontend |
| `admin` | `apps/admin` | Admin console |

Both apps are deployed as separate Railway services within a single project, using Docker for consistent builds.

## Prerequisites

- Railway CLI installed and logged in (`railway login`)
- GitHub repository connected to Railway
- Custom domains configured in DNS (optional)

## Project Structure

```
ellie/
├── Dockerfile.web          # Docker build for web
├── Dockerfile.admin        # Docker build for admin
├── apps/
│   ├── web/
│   │   ├── railway.toml    # Railway config for web
│   │   └── src/app/api/live/route.ts  # Health check
│   └── admin/
│       ├── railway.toml    # Railway config for admin
│       └── src/app/api/live/route.ts  # Health check
└── packages/               # Shared workspace packages
```

## Configuration Files

### Dockerfile Pattern (Dockerfile.web / Dockerfile.admin)

Both Dockerfiles follow the same pattern:

```dockerfile
# --- Stage 1: Install dependencies ---
FROM oven/bun:1 AS deps
WORKDIR /app

# Copy ALL workspace package.json files for bun lockfile resolution
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
COPY apps/admin/package.json ./apps/admin/
COPY apps/worker/package.json ./apps/worker/
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
COPY packages/repositories/package.json ./packages/repositories/
COPY packages/ui/package.json ./packages/ui/
COPY packages/cli/package.json ./packages/cli/
COPY packages/db/package.json ./packages/db/
COPY packages/migrate/package.json ./packages/migrate/

RUN bun install --frozen-lockfile

# --- Stage 2: Build ---
FROM oven/bun:1 AS builder
WORKDIR /app

COPY . .
COPY --from=deps /app/node_modules ./node_modules

# Re-run install to link workspace packages
RUN bun install --frozen-lockfile

# Dummy env vars for Next.js static generation (replaced at runtime)
ENV WORKER_API_URL=http://placeholder
ENV AUTH_SECRET=placeholder
# ... other required build-time env vars

RUN bun run build:forum   # or build:admin

# --- Stage 3: Runtime ---
FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
# PORT is injected by Railway

# Copy standalone build
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
RUN mkdir -p ./apps/web/public

CMD ["bun", "apps/web/server.js"]
```

### Next.js Config

Both apps require `output: "standalone"` in `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  output: "standalone",
  // ... other config
};
```

### Railway Config (railway.toml)

Each app has its own `railway.toml` in its directory:

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile.web"  # or Dockerfile.admin

[deploy]
healthcheckPath = "/api/live"
healthcheckTimeout = 300
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

### Health Check Endpoint

Each app has `/api/live` endpoint at `src/app/api/live/route.ts`:

```typescript
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}
```

## Deployment Steps

### 1. Create Railway Project

```bash
railway init --name <project-name>
```

### 2. Create Services

In Railway Dashboard:
1. Add two services, both connected to the same GitHub repo
2. For each service, set **Config File Path** in Settings → Source:
   - web service: `/apps/web/railway.toml`
   - admin service: `/apps/admin/railway.toml`
3. Leave **Root Directory** empty (uses repo root for Docker context)

### 3. Configure Environment Variables

```bash
# Web service
railway variable set --service "<web-service-name>" \
  "AUTH_URL=https://<web-domain>" \
  "AUTH_SECRET=<secret>" \
  "WORKER_API_URL=https://<worker-url>" \
  "FORUM_API_KEY=<api-key>" \
  "NEXT_PUBLIC_CAP_API_ENDPOINT=<captcha-endpoint>"

# Admin service
railway variable set --service "<admin-service-name>" \
  "AUTH_URL=https://<admin-domain>" \
  "AUTH_SECRET=<secret>" \
  "AUTH_GOOGLE_ID=<google-oauth-id>" \
  "AUTH_GOOGLE_SECRET=<google-oauth-secret>" \
  "ADMIN_EMAILS=<allowed-emails>" \
  "WORKER_API_URL=https://<worker-url>" \
  "ADMIN_API_KEY=<admin-api-key>"
```

### 4. Generate Domains

```bash
railway domain --service "<web-service-name>"
railway domain --service "<admin-service-name>"
```

Or add custom domains in Dashboard → Service → Settings → Networking.

### 5. Deploy

Deployments are triggered automatically on git push. Manual redeploy:

```bash
railway service redeploy --service "<service-name>"
```

## Key Learnings

### Bun Monorepo in Docker

- **All** workspace `package.json` files must be copied before `bun install`
- Lockfile validation requires complete workspace structure
- Run `bun install` twice: once for deps caching, once after copying source for workspace linking

### Railway Specifics

- Railway injects `PORT` env var - don't hardcode it in Dockerfile
- Set `HOSTNAME=0.0.0.0` for external access
- Use `/api/live` for health checks instead of `/` (faster, no SSR)
- Config File Path setting tells Railway where to find `railway.toml`
- Root Directory should be empty when using Dockerfiles that need full repo context

### Next.js Standalone

- Requires `output: "standalone"` in next.config.ts
- Standalone output structure: `.next/standalone/apps/<app>/server.js`
- Static files must be copied separately: `.next/static`
- Public directory may not exist - handle gracefully with `mkdir -p`

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `workspace:* failed to resolve` | Missing package.json in Docker | Copy all workspace package.json files |
| `lockfile had changes` | Incomplete workspace in Docker | Ensure all package.json files match lockfile |
| `next: command not found` | node_modules not linked | Run `bun install` after copying source |
| Health check fails | Wrong port or path | Use `HOSTNAME=0.0.0.0`, check `/api/live` exists |
| `public: not found` | No public directory | Use `mkdir -p` instead of COPY |

## Monitoring

Check deployment status:
```bash
railway service status --all --json
```

View logs:
```bash
railway logs --service "<service-name>"
```
