# Service status push convention

Language-agnostic convention: each service runs its own checks and **pushes** a JSON report to a central collector. The collector does not scrape monitored apps. Prometheus / metrics scrapes are out of scope.

Public integration docs and the downloadable Node sample client live on the collector site (`/docs`, `/client`) — not in a personal IDE skill.

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

Staff configure an IPv4/IPv6 allowlist on `/configure` (stored in `data/settings.json`). **Localhost** (`127.0.0.1`, `::1`, and IPv4-mapped localhost) is always allowed. An empty allowlist means only localhost may push. Set `TRUST_PROXY=1` behind a reverse proxy so the client IP is taken from `X-Forwarded-For`.

### Dashboard (`GET /`, `GET /configure`, `GET /reports`)

Staff-only. Google OAuth; email host must be `theodi.org` (same rule as CARE admin). Unauthenticated users are sent to `/login`. Pushing does **not** require Google login.

### Public docs

`GET /docs`, `GET /docs/spec`, `GET /docs/agent`, and `GET /client/*` are **public** (no Google, no ingest key). They never expose the ingest key.

## Report body

```json
{
  "service": "care.theodi.org",
  "version": "3.0.0",
  "reportedAt": "2026-09-21T13:00:00.000Z",
  "instance": "optional-host-or-env",
  "runtime": {
    "node": "v20.11.1",
    "os": {
      "id": "ubuntu",
      "versionId": "22.04",
      "prettyName": "Ubuntu 22.04.4 LTS"
    }
  },
  "checks": [
    {
      "id": "mongo",
      "name": "MongoDB",
      "status": "ok",
      "message": "connected (care)",
      "detail": {}
    },
    {
      "id": "npm_audit",
      "name": "npm audit",
      "status": "ok",
      "message": "0 vulnerabilities",
      "detail": { "total": 0 }
    }
  ]
}
```

### Fields

| Field | Required | Notes |
|-------|----------|--------|
| `service` | yes | Stable id (package name / deployment identity). Used as the upsert key. |
| `version` | no | App version string. |
| `reportedAt` | no | ISO-8601 when the client built the report. Collector also stores `receivedAt`. |
| `instance` | no | Host, region, or process id when useful. |
| `runtime` | **yes (Node)** | Raw versions only. Must include `node` and `os`. Collector scores LTS/EOL and injects `node_runtime` / `operating_system`. |
| `checks` | yes | App-owned tests. For Node services **must** include `npm_audit`. |

### `runtime` object (required on Node services)

| Field | Required | Notes |
|-------|----------|--------|
| `node` | yes | Node version string (e.g. `v20.11.1` or `20.11.1`). |
| `os` | yes | Object: `id` (os-release `ID`), `versionId` (`VERSION_ID`), `prettyName` (`PRETTY_NAME`). Optional `product` / `platform` / `release` help the collector. |

### Check object

| Field | Required | Notes |
|-------|----------|--------|
| `id` | yes | Stable slug within the service (`mongo`, `npm_audit`, …). |
| `name` | yes | Human label. |
| `status` | yes | One of `ok`, `warn`, `fail`. |
| `message` | yes | Short human-readable outcome. |
| `detail` | no | Arbitrary JSON for machine consumers (counts, codes). |

## Required checks (every Node service)

| Requirement | How |
|-------------|-----|
| Node version | `runtime.node` → collector injects `node_runtime` |
| OS version | `runtime.os` → collector injects `operating_system` |
| Dependency audit | `checks[]` entry with `id: "npm_audit"` (sample client: `npmAuditCheck()`) |

If a Node report is missing `runtime` pieces or `npm_audit`, the collector still accepts the push but injects **warn** placeholders so the dashboard shows the gap.

## What else to check (app-owned)

Anything where an **external dependency or integration** can break the app should have a check. Prefer a real probe (ping, auth call, send test, list resources) over “env var is set”.

Examples (include those that apply to **this** service):

| Example `id` | What to verify |
|--------------|----------------|
| `mongo` / `postgres` / `mysql` / `redis` | Database reachable with the app’s credentials |
| `django` / `upstream_api` | Dependent HTTP/API services respond |
| `email` / `smtp` / `sendgrid` / `mailgun` | Mail provider configured and usable (API key valid / SMTP handshake) |
| `hubspot` | HubSpot API key works (e.g. lightweight authenticated request) |
| `openai` / `anthropic` / `ai` | AI provider API key works (cheap no-op or models list) |
| `stripe` / `payment` | Payment provider credentials valid |
| `s3` / `gcs` / `storage` | Object storage reachable with configured credentials |
| `queue` / `rabbit` / `sqs` | Message broker connectivity |
| `oauth_google` / `oauth_*` | OAuth client config present and token endpoint reachable when testable |

Rule of thumb: if the app needs an **API key, secret, or network hop** to a third party or shared infrastructure, add a check. Do not invent checks for libraries that are purely in-process with no external dependency.

## Collector-side Node / OS LTS

The collector evaluates Node and OS support using [endoflife.date](https://endoflife.date) (cached in-process):

| Check id | Source | Pass rule |
|----------|--------|-----------|
| `node_runtime` | `runtime.node` | Active **LTS** with &gt;6 months to EOL → `ok`; LTS with ≤6 months → `warn`; non-LTS / EOL / unknown → `fail` |
| `operating_system` | `runtime.os` | Same LTS window; unknown platform → `warn` |

If the EOL API is unreachable, the collector emits `warn` with the version still in `message` / `detail`.

**Compatibility:** If `runtime` is omitted but the client already sent `node_runtime` / `operating_system` checks (legacy), those checks are kept. Prefer sending `runtime` and omitting those check ids.

## Stale detection

The collector tracks the last accepted report per `service`. If nothing is received within `STALE_AFTER_MS` (default 15 minutes), the dashboard shows a warning such as “no report received”.

Configure `EXPECTED_SERVICES` (comma-separated) so services that never phone home still appear as stale. The collector always includes itself as `service-status`.

## Collector self-reporting

The collector upserts its own report (`service`: `service-status`) on an interval (`SELF_REPORT_INTERVAL_MS`), including process uptime, `runtime` (scored on ingest/self-upsert), ingest key presence, store writability, expected-services config, fleet activity, and `npm audit`. One-shot: `npm run report-status`.

## Client guidance

- Gate the reporter on env (`STATUS_REPORT_URL` + `STATUS_REPORT_KEY`); if unset, do nothing.
- Never crash the app if the collector is down; log a warning.
- Do **not** expose a public status URI as the monitoring plane (local k8s `/health` for orchestration is fine separately).
- Prefer push over inventing a pull-only monitoring API.
- **Required:** `runtime` (node + os) and `npm_audit`, plus probes for every external integration the app depends on.
- Use the public sample client: `/client/node/` or `/client/odi-status-node.zip`.

## Reference client

Downloadable Node sample on this collector: `/docs` and `/client/odi-status-node.zip`. CARE may still push as a fleet member; new integrations should follow the sample client, not copy CARE internals.
