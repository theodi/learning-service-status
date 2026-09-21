#!/usr/bin/env node
/**
 * One-shot self health report upsert into the local store.
 */
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const configEnvPath = path.join(root, 'config.env');

function loadEnvFile(fp) {
  if (!fs.existsSync(fp)) return;
  const text = fs.readFileSync(fp, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(configEnvPath);

const { createStore } = require('../lib/store');
const { parseExpectedServices } = require('../lib/validateReport');
const { withSelfExpected } = require('../lib/dashboard');
const { upsertSelfReport } = require('../lib/selfReport');

async function main() {
  const storePath =
    process.env.REPORTS_STORE_PATH || path.join(root, 'data', 'reports.json');
  const store = createStore(storePath);
  const expected = withSelfExpected(parseExpectedServices(process.env.EXPECTED_SERVICES || ''));
  const staleAfterMs = parseInt(process.env.STALE_AFTER_MS || '900000', 10);

  const { report } = await upsertSelfReport(store, {
    storePath,
    expectedServices: expected,
    staleAfterMs: Number.isFinite(staleAfterMs) ? staleAfterMs : 900000,
    ingestKey: process.env.STATUS_INGEST_KEY,
  });

  console.log(`Self-report upserted: ${report.service} v${report.version}`);
  for (const c of report.checks) {
    console.log(`[${c.status}] ${c.name}: ${c.message}`);
  }
  const failed = report.checks.some((c) => c.status === 'fail');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
