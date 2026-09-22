# Service status push convention

Language-agnostic convention: a **host agent** on each server discovers apps, runs checks, and **pushes** JSON reports to a central collector. The collector does not scrape monitored apps. Prometheus / metrics scrapes are out of scope.

Public integration docs live on the collector site (`/docs`) — not in a personal IDE skill.

## Auth

### Ingest (`POST /reports`)

Requires a shared secret (not Google):

- `Authorization: Bearer <STATUS_INGEST_KEY>`, or
- `X-Status-Key: <STATUS_INGEST_KEY>`

| Status | Meaning |
|--------|---------|
| 200 | Accepted |
| 400 | Invalid body |
| 401 | Missing or wrong key |
| 403 | Client IP not on the ingest allowlist |

Staff configure an IPv4/IPv6 allowlist on `/configure` (stored in `data/settings.json`). **Localhost** (`127.0.0.1`, `::1`, and IPv4-mapped localhost) is always allowed. An empty allowlist means only localhost may push. When the TCP peer is a **Cloudflare edge** IP or **loopback** (local reverse proxy such as Apache→Node), ingest uses `CF-Connecting-IP` (then `X-Forwarded-For`); otherwise forwarded headers are ignored. Allowlist each pusher’s **real egress IP**, not a Cloudflare edge address. The process binds to `LISTEN_HOST` (default `127.0.0.1`) so trusting loopback peers is safe.

### Dashboard (`GET /`, `GET /configure`, `GET /reports`)

Staff-only. Google OAuth; email host must be `theodi.org` (same rule as CARE admin). Unauthenticated users are sent to `/login`. Pushing does **not** require Google login.

### Public docs

`GET /docs`, `GET /docs/spec`, `GET /docs/agent`, and `GET /client/*` are **public** (no Google, no ingest key). They never expose the ingest key.

## Report body

The host agent POSTs **one report per host** and **one report per discovered app** each run (typically hourly). Upsert key is `service`. All reports include `host` so the dashboard can nest apps under servers.

```json
{
  "service": "care.theodi.org",
  "host": "learndata-1",
  "version": "3.0.0",
  "reportedAt": "2026-09-21T13:00:00.000Z",
  "runtime": {
    "node": "v20.11.1",
    "npm": "10.9.0"
  },
  "checks": [
    {
      "id": "process",
      "name": "Process",
      "status": "ok",
      "message": "running (pid 1234)",
      "detail": {}
    },
    {
      "id": "npm_audit",
      "name": "npm audit",
      "status": "ok",
      "message": "0 vulnerabilities",
      "detail": { "source": "agent", "engine": "npm", "total": 0 }
    }
  ]
}
```

Host machine reports use `service`: `host:<hostId>` (same `host` field) and send `runtime.os` only (no Node/npm).

### Fields

| Field | Required | Notes |
|-------|----------|--------|
| `service` | yes | Stable id. Apps: package name / deployment identity. Hosts: `host:<id>`. Upsert key. |
| `host` | yes | Stable server id (hostname or configured `hostId`). Used to nest apps on the dashboard. |
| `version` | no | App version string. |
| `reportedAt` | no | ISO-8601 when the agent built the report. Collector also stores `receivedAt`. |
| `instance` | no | Optional extra instance label. |
| `runtime` | **yes (Node apps / hosts)** | Apps: `node` + `npm`. Hosts: `os`. Collector scores LTS from these. |
| `dependencies` | no | Deprecated. Previously used for collector-side Arborist audit; agents now run `npm audit` locally. |
| `checks` | yes | Agent-owned probes (process, connectors, **`npm_audit`**, apt/reboot on host reports). |

JSON body limit for ingest is **1mb** (lockfiles are no longer required).

### `runtime` object

| Field | Required | Notes |
|-------|----------|--------|
| `node` | for apps | Node version of the running process when known. |
| `npm` | for apps | npm version (prefer the binary next to the app’s Node). |
| `os` | for hosts | Object: `id`, `versionId`, `prettyName`. Not required on apps. |

### `dependencies` object (deprecated)

Optional legacy field. Collector ignores it for scoring.

### Check object

| Field | Required | Notes |
|-------|----------|--------|
| `id` | yes | Stable slug within the service (`process`, `mongodb`, `apt`, `npm_audit`, …). |
| `name` | yes | Human label. |
| `status` | yes | One of `ok`, `warn`, `fail`. |
| `message` | yes | Short human-readable outcome. |
| `detail` | no | Arbitrary JSON. |

## Host agent (preferred integration)

Run one agent per server (typically as root via systemd). Configure with **`config.json`** (`statusReportUrl`, `statusReportKey`, `hostId`, `scanRoots` array). Legacy `config.env` works if JSON is absent.

The agent:

1. Checks the machine (OS, apt upgrades, reboot-required).
2. Scans `scanRoots` for Node apps (`package.json`).
3. For each app: process up?, Node/npm versions (using the app’s Node binary when known), **`npm audit --json` in the app directory**, connectors inferred from the app’s `config.env` / `.env`.
4. POSTs host + app reports to this collector (~hourly).

See `/docs/agent` and the `agent/` package in this repository.

Apps should **not** embed their own status reporters.

## Collector-side scoring

| Report kind | Collector injects |
|-------------|-------------------|
| Host (`service` `host:<id>`) | `operating_system` (LTS from `runtime.os`). No Node/npm LTS, no `npm_audit`. |
| App | `node_runtime` (LTS), `npm_runtime` (major vs latest on registry). Preserves agent `npm_audit`. No OS check. |

## Stale detection

The collector tracks the last accepted report per `service`. If nothing is received within `STALE_AFTER_MS` (default **2 hours**, for hourly agents), the dashboard shows a warning such as “no report received”.

Configure `EXPECTED_SERVICES` (comma-separated) so hosts and apps that never phone home still appear as stale (e.g. `host:learndata-1,care.theodi.org`).

## Dashboard

Rows are grouped by `host`. Each host section shows the machine report (`host:<id>`) and nested app reports.
