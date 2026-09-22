# Service status collector

Central push collector and ODI-staff dashboard for the [service status convention](./SPEC.md).

**Public integration:** [`/docs`](http://localhost:3090/docs). Staff sign-in is for the dashboard and Configure only.

A **host agent** on each server discovers apps and POSTs host + app reports (with required `host` for nesting). The agent runs **`npm audit`** in each app directory; the collector scores **Node.js / OS LTS**. Staff (`@theodi.org`) view the fleet after Google sign-in.

## Quick start

```bash
cp config.env.example config.env
# set STATUS_INGEST_KEY, SESSION_SECRET, Google OAuth, EXPECTED_SERVICES
npm install
npm start
# open http://localhost:3090/docs  (public)
# open http://localhost:3090 → Sign in with Google (dashboard)
```

Host agent (separate process on each server):

```bash
cd agent && cp config.json.example config.json && npm install && npm run once
```

## Env

| Variable | Purpose |
|----------|---------|
| `PORT` | Listen port (default `3090`) |
| `LISTEN_HOST` | Bind address (default `127.0.0.1`) |
| `STATUS_INGEST_KEY` | Shared secret for `POST /reports` |
| `STALE_AFTER_MS` | Stale threshold (default **2 hours**) |
| `EXPECTED_SERVICES` | Comma-separated ids (e.g. `host:learndata-1,care.theodi.org`) |
| `REPORTS_STORE_PATH` | JSON persistence path |
| `SETTINGS_STORE_PATH` | Allowlist settings path |
| `SESSION_SECRET` | Express session secret |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_CALLBACK_URL` | OAuth callback URL |
| `PUBLIC_BASE_URL` | Optional canonical origin for Configure |

## API / routes

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /reports` | ingest key | Host agent push (LTS enrich; body up to 1mb) |
| `GET /` | Google + `@theodi.org` | Dashboard (grouped by host) |
| `GET /configure` | Google + `@theodi.org` | Ingest URL + key + IP allowlist |
| `GET /settings` | Google + `@theodi.org` | JSON allowlist |
| `PUT /settings` | Google + `@theodi.org` | Update allowlist |
| `GET /reports` | Google + `@theodi.org` | JSON for UI refresh |
| `GET /docs` | public | Integration guide |
| `GET /docs/agent` | public | Host agent playbook |
| `GET /docs/spec` | public | Rendered SPEC |

See [agent/README.md](./agent/README.md) for systemd timer and scan roots.
