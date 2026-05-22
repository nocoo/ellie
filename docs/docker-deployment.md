# Docker Deployment

Ellie deploys to a self-hosted Docker host behind Cloudflare.

## Architecture

```
Browser ──HTTPS──▶ Cloudflare ──HTTPS + mTLS──▶ proxy-caddy ──HTTP──▶ ellie-web (:7031)
                                                              ├─HTTP──▶ ellie-admin (:7032)
                                                              │
                                                              └──HTTPS──▶ Cloudflare Worker ──▶ D1/KV
```

- **Web** (forum): Next.js 16 standalone, Bun runtime, port 7031
- **Admin** (console): Next.js 16 standalone, Bun runtime, port 7032
- **Worker**: Cloudflare Worker (D1 + KV), deployed separately via `bun run worker:deploy`
- **Edge**: Cloudflare proxy + Universal SSL
- **Origin**: Deploy server, shared `proxy-caddy` terminates TLS with Cloudflare Origin Certificate and enforces Authenticated Origin Pulls (mTLS)
- **Image registry**: GitHub Container Registry (GHCR)

## Dockerfile

Single multi-stage `Dockerfile` at repo root, parameterized by `APP` build arg:

```bash
# Build forum web
docker build --build-arg APP=web -t ellie-web .

# Build admin console
docker build --build-arg APP=admin -t ellie-admin .
```

Three stages:
1. **deps** — `bun install --frozen-lockfile` (workspace-aware)
2. **builder** — `bun run build:forum` or `bun run build:admin`, with placeholder env vars only for libs that read env at module-init (next-auth)
3. **runner** — copies `.next/standalone` + `static` + `public`, runs `bun apps/<app>/server.js`

**Real secrets are never baked into the image** — injected at runtime via container environment.

## CI / CD

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| CI | `.github/workflows/ci.yml` | push / PR | Lint + unit + L2 + L3 |
| Release | `.github/workflows/release.yml` | CI succeeds on `main`, or `workflow_dispatch` | Build → push GHCR → deploy to jp2 |

Release steps:
1. Build & push two images to GHCR: `ellie-web:latest` + `:sha`, `ellie-admin:latest` + `:sha`
2. SSH to deploy server: `docker compose pull web admin && docker compose up -d --no-deps web admin`
3. In-container health check: `GET /api/live` on each container
4. External smoke test: `curl https://ellie.hexly.ai/api/live` and `https://ellie-admin.hexly.ai/api/live`

## Server-Side Setup (one-time)

### Prerequisites

- Docker + Docker Compose
- Shared reverse proxy at `/opt/proxy/` (Caddy, occupies ports 80/443)
- Shared Docker network: `docker network create edge`

### App Directory: `/opt/ellie/`

```
/opt/ellie/
├── docker-compose.yml
├── .env.web          # runtime env for forum (chmod 600)
└── .env.admin        # runtime env for admin (chmod 600)
```

### docker-compose.yml

```yaml
services:
  web:
    image: ghcr.io/<owner>/ellie-web:latest
    container_name: ellie-web
    restart: unless-stopped
    env_file: .env.web
    expose:
      - "7031"
    networks:
      - edge

  admin:
    image: ghcr.io/<owner>/ellie-admin:latest
    container_name: ellie-admin
    restart: unless-stopped
    env_file: .env.admin
    expose:
      - "7032"
    networks:
      - edge

networks:
  edge:
    external: true
```

### .env.web

```env
NODE_ENV=production
HOSTNAME=0.0.0.0
PORT=7031
AUTH_URL=https://ellie.hexly.ai
AUTH_SECRET=<generate: openssl rand -base64 32>
WORKER_API_URL=https://ellie.worker.hexly.ai
FORUM_API_KEY=<same as Worker's API_KEY>
NEXT_PUBLIC_CAP_API_ENDPOINT=<cap endpoint>
```

### .env.admin

```env
NODE_ENV=production
HOSTNAME=0.0.0.0
PORT=7032
AUTH_URL=https://ellie-admin.hexly.ai
AUTH_SECRET=<generate: openssl rand -base64 32>
AUTH_GOOGLE_ID=<Google OAuth client ID>
AUTH_GOOGLE_SECRET=<Google OAuth client secret>
ADMIN_EMAILS=<comma-separated admin emails>
WORKER_API_URL=https://ellie.worker.hexly.ai
ADMIN_API_KEY=<same as Worker's ADMIN_API_KEY>
```

### Caddy Site Blocks (add to `/opt/proxy/Caddyfile`)

```caddyfile
ellie.hexly.ai {
    import hexly_tls
    reverse_proxy ellie-web:7031
}

ellie-admin.hexly.ai {
    import hexly_tls
    reverse_proxy ellie-admin:7032
}
```

After editing: `cd /opt/proxy && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`

### Cloudflare DNS

Add two A records pointing to your server's public IP (proxied):
- `ellie.hexly.ai` → server IP
- `ellie-admin.hexly.ai` → server IP

## GitHub Actions Secrets

| Name | Purpose |
|------|---------|
| `VPS_HOST` | Deploy server hostname / IP |
| `VPS_USER` | SSH user |
| `VPS_SSH_KEY` | SSH deploy private key |
| `GHCR_PULL_USER` | GHCR pull account |
| `GHCR_PULL_TOKEN` | PAT with `read:packages` scope |

Image push uses the workflow's built-in `GITHUB_TOKEN` — no extra config needed.

## Rollback

Images are tagged both `:latest` and `:<commit-sha>`. To rollback:

```bash
# On deploy server
cd /opt/ellie
# Edit docker-compose.yml to pin a specific sha, then:
docker compose pull web admin
docker compose up -d --no-deps web admin
```

Or re-trigger Release via `workflow_dispatch` at the desired commit.

## Local Testing

```bash
docker build --build-arg APP=web -t ellie-web:local .
docker run --rm -p 7031:7031 --env-file apps/web/.env.local ellie-web:local
# Visit http://localhost:7031/api/live
```
