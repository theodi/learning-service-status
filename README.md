# Service status collector

Central push collector and ODI-staff dashboard for the [service status convention](./SPEC.md).

**Public integration:** [`/docs`](http://localhost:3090/docs) (agent playbook, SPEC, downloadable Node client). Staff sign-in is only for the dashboard and Configure (ingest key).

Services POST self-describing check reports with an ingest key. The collector scores **Node.js / OS LTS** from `runtime` and audits uploaded lockfiles (`dependencies`) **in-process** with `@npmcli/arborist` (no system `npm` binary). Staff (`@theodi.org`) view the fleet after Google sign-in.

## Quick start

```bash
cp config.env.example config.env
# set STATUS_INGEST_KEY, SESSION_SECRET, Google OAuth, EXPECTED_SERVICES
npm install
npm start
# open http://localhost:3090/docs  (public)
# open http://localhost:3090 → Sign in with Google (dashboard)
```

Google Cloud OAuth client: authorised redirect URI must match `GOOGLE_CALLBACK_URL` (e.g. `http://localhost:3090/auth/google/callback`).

## Env

| Variable | Purpose |
|----------|---------|
| `PORT` | Listen port (default `3090`) |
| `STATUS_INGEST_KEY` | Shared secret for `POST /reports` |
| `STALE_AFTER_MS` | Stale threshold (default 15 minutes) |
| `EXPECTED_SERVICES` | Comma-separated service ids always shown |
| `SELF_REPORT_INTERVAL_MS` | How often this app upserts its own report |
| `REPORTS_STORE_PATH` | JSON persistence path |
| `SETTINGS_STORE_PATH` | Allowlist settings path (default `./data/settings.json`) |
| `SESSION_SECRET` | Express session secret |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_CALLBACK_URL` | OAuth callback URL |
| `PUBLIC_BASE_URL` | Optional canonical origin shown in the dashboard configure panel |

## API / routes

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /reports` | ingest key | Client push (collector enriches LTS + npm audit from lockfiles; JSON body up to 5mb) |
| `GET /` | Google + `@theodi.org` | Dashboard |
| `GET /configure` | Google + `@theodi.org` | Ingest URL + key + IP allowlist |
| `GET /settings` | Google + `@theodi.org` | JSON settings (allowlist) |
| `PUT /settings` | Google + `@theodi.org` | Update allowlist `{ "allowedIps": [...] }` |
| `GET /reports` | Google + `@theodi.org` | JSON for UI refresh |
| `GET /docs` | public | Integration guide |
| `GET /docs/agent` | public | Agent playbook |
| `GET /docs/spec` | public | Rendered SPEC |
| `GET /client/node/*` | public | Browse sample client |
| `GET /client/odi-status-node.zip` | public | Download sample client |
| `GET /login` | public | Sign-in page |
| `GET /auth/google` | public | Start OAuth |
| `POST /logout` | session | Logout |

```bash
# Client push (no Google) — runtime scored on the collector
curl -X POST http://localhost:3090/reports \
  -H "Authorization: Bearer $STATUS_INGEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{"service":"example","runtime":{"node":"v22.11.0","os":{"id":"ubuntu","versionId":"24.04","prettyName":"Ubuntu 24.04 LTS"}},"checks":[{"id":"up","name":"Up","status":"ok","message":"yes"}]}'

# Self-report once
npm run report-status
```

No Prometheus / scrape endpoints.
