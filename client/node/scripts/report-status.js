#!/usr/bin/env node
/**
 * One-shot push: node scripts/report-status.js
 * Requires STATUS_REPORT_URL, STATUS_REPORT_KEY, and --service=id
 *
 * Sends runtime by default. Optional: --local-audit to include a client-side npm_audit check.
 * Note: prefer the host agent; collector no longer audits lockfiles.
 *
 * Usage from an app that copied this client:
 *   node lib/odi-status/scripts/report-status.js --service=my-app --version=1.0.0
 */

const path = require('path');
const { reportOnce, npmAuditCheck } = require('..');

function parseArgs(argv) {
  const out = { service: null, version: null, localAudit: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--service=')) out.service = arg.slice(10);
    else if (arg.startsWith('--version=')) out.version = arg.slice(10);
    else if (arg === '--local-audit') out.localAudit = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const service = args.service || process.env.STATUS_REPORT_SERVICE;
  if (!service) {
    console.error('Pass --service=my-service-id or set STATUS_REPORT_SERVICE');
    process.exit(1);
  }

  const version =
    args.version ||
    (() => {
      try {
        return require(path.join(process.cwd(), 'package.json')).version;
      } catch {
        return undefined;
      }
    })();

  const result = await reportOnce({
    force: true,
    service,
    version,
    cwd: process.cwd(),
    getChecks: async () => {
      if (!args.localAudit) return [];
      return [await npmAuditCheck({ cwd: process.cwd() })];
    },
  });

  if (result.skipped) {
    console.error('Skipped:', result.reason);
    process.exit(1);
  }
  if (!result.ok) {
    console.error('Push failed:', result.error || result.status);
    process.exit(1);
  }
  console.log('Pushed', service);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
