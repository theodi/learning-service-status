#!/usr/bin/env node
/**
 * ODI host status agent — discover apps, check host + apps, push to collector.
 *
 *   node bin/odi-status-agent.js --once
 *   node bin/odi-status-agent.js          # loop on INTERVAL_MS
 */

const { readAgentConfig } = require('../lib/config');
const { buildAllReports } = require('../lib/buildReports');
const { pushAllReports } = require('../lib/push');

function parseArgs(argv) {
  const out = { once: false, configPath: null, quiet: false };
  for (const a of argv.slice(2)) {
    if (a === '--once') out.once = true;
    else if (a === '--quiet' || a === '-q') out.quiet = true;
    else if (a.startsWith('--config=')) out.configPath = a.slice(9);
  }
  return out;
}

function makeLogger(quiet) {
  return (msg) => {
    if (!quiet) console.log(`[agent] ${msg}`);
  };
}

function pct(done, total) {
  if (!total) return '100%';
  return `${Math.round((done / total) * 100)}%`;
}

async function runOnce(config, options = {}) {
  const log = options.log || makeLogger(options.quiet);
  const started = Date.now();

  if (!config.enabled && !options.force) {
    console.warn('[agent] disabled: set statusReportUrl and statusReportKey in config.json');
    return { ok: false, skipped: true };
  }

  log(`Starting scan host=${config.hostId}`);
  log(`Collector: ${config.url}`);
  if (!config.scanRoots.length) {
    console.warn('[agent] scanRoots is empty — only host report will be sent');
  } else {
    log(`Scan roots (${config.scanRoots.length}):`);
    for (const root of config.scanRoots) {
      log(`  • ${root}`);
    }
  }

  const onProgress = (msg) => log(msg);

  const { hostReport, appReports } = await buildAllReports(config, {
    ...options,
    onProgress,
  });
  const reports = [hostReport, ...appReports];
  const buildMs = Date.now() - started;
  log(
    `Built ${reports.length} report(s): 1 host + ${appReports.length} app(s) in ${(buildMs / 1000).toFixed(1)}s`
  );

  log(`Pushing ${reports.length} report(s)…`);
  const results = await pushAllReports(reports, {
    url: config.url,
    key: config.key,
    fetchImpl: options.fetchImpl,
    onProgress,
  });

  let ok = 0;
  let fail = 0;
  for (const r of results) {
    if (r.ok) ok += 1;
    else fail += 1;
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  log(`Finished in ${elapsed}s — pushed ${ok}/${reports.length} (${pct(ok, reports.length)})${fail ? `, ${fail} failed` : ''}`);
  if (fail) {
    for (const r of results) {
      if (!r.ok) {
        console.warn(`[agent]   ✗ ${r.service || '?'}: ${r.error || r.reason || r.status}`);
      }
    }
  }

  return { ok: fail === 0, pushed: ok, failed: fail, results };
}

async function main() {
  const args = parseArgs(process.argv);
  const config = readAgentConfig({
    configPath: args.configPath || undefined,
  });
  const log = makeLogger(args.quiet);
  log(`Config: ${config.configPath}`);

  if (args.once) {
    const out = await runOnce(config, { quiet: args.quiet });
    process.exit(out.ok || out.skipped ? 0 : 1);
  }

  console.log(
    `[agent] starting loop every ${config.intervalMs}ms host=${config.hostId} roots=${config.scanRoots.join(',') || '(none)'}`
  );
  const tick = async () => {
    try {
      await runOnce(config, { quiet: args.quiet });
    } catch (err) {
      console.warn('[agent] run failed:', err.message || err);
    }
  };
  await tick();
  setInterval(tick, config.intervalMs);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runOnce, parseArgs, main };
