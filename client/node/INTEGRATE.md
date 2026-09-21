# Integrate service-status (Node)

Agent checklist for ODI Node apps. Full docs: collector `/docs` and `/docs/agent`.

## Goal

Push self-describing health checks to the central collector. Do **not** invent a public pull `/status` for dashboards.

## Required on every Node service

1. **`runtime.node` + `runtime.os`** — sample client sends these automatically; collector scores LTS.
2. **`dependencies`** — `package.json` + `package-lock.json` contents (read from disk). Collector audits lockfiles in-process (Arborist). **No `npm` binary needed** in the app (www-data safe).
3. **External integrations** — every dependency that can fail outside the process (DB, email, HubSpot, AI, Django/upstream APIs, queues, storage, payments, OAuth, …). Prefer a real probe over “env var is set”.

## Steps

1. **Download** `/client/odi-status-node.zip` (or copy `/client/node/`) into the app, e.g. `lib/odi-status/`.
2. **Wire** after `app.listen` (or equivalent):

```js
const { startStatusReporter } = require('./lib/odi-status');
const pkg = require('../package.json');

startStatusReporter({
  service: 'my-service-id', // stable id
  version: pkg.version,
  cwd: __dirname + '/..', // so package-lock.json is found
  getChecks: async () => {
    const checks = [];
    // External integrations used by THIS app (examples — keep only what applies):
    // checks.push(await checkMongo());
    // checks.push(await checkEmail());
    // checks.push(await checkHubspot());
    return checks;
  },
});
```

3. **Env** (from staff Configure page — never hardcode the key in the repo):

```env
STATUS_REPORT_URL=https://<collector>/reports
STATUS_REPORT_KEY=<ingest-key>
STATUS_REPORT_INTERVAL_MS=300000
```

If URL or key unset → reporter is a no-op.

4. **Runtime + lockfiles**: leave defaults on. Do not call endoflife.date or `npm audit` in the app.

5. **Extend**: return `{ id, name, status, message, detail? }` from `getChecks`. Status must be `ok|warn|fail`.

6. **CLI** (optional): `node lib/odi-status/scripts/report-status.js --service=my-service-id`

7. **Accept**: HTTP 200; dashboard shows `node_runtime`, `operating_system`, `npm_audit` (collector-scored), and this app’s integration checks.

## Anti-patterns

- Google auth on `POST /reports`
- Crashing the app when the collector is down
- Scraping Prometheus as a substitute for this push
- Putting `STATUS_REPORT_KEY` in public docs or git
- Omitting `runtime` or `dependencies` (lockfiles)
- Requiring `npm` in the app process for audit
- Only checking that an API key env var exists without probing the provider
