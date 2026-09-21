/**
 * Build and upsert a self health report for service-status into the local store.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectRuntime } = require('./runtimeSupportChecks');
const { enrichReportWithRuntime } = require('./enrichRuntime');

const SERVICE_ID = 'service-status';

function npmAuditToCheck(auditJson, error) {
  const id = 'npm_audit';
  const name = 'npm audit';
  if (error) {
    return {
      id,
      name,
      status: 'warn',
      message: `npm audit could not run: ${error.message || String(error)}`,
      detail: { error: true },
    };
  }
  if (!auditJson || typeof auditJson !== 'object') {
    return {
      id,
      name,
      status: 'warn',
      message: 'npm audit returned no JSON',
      detail: {},
    };
  }

  const meta =
    auditJson.metadata && auditJson.metadata.vulnerabilities
      ? auditJson.metadata.vulnerabilities
      : null;
  const vulns = meta || {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total:
      typeof auditJson.vulnerabilities === 'object'
        ? Object.keys(auditJson.vulnerabilities || {}).length
        : 0,
  };

  const critical = Number(vulns.critical) || 0;
  const high = Number(vulns.high) || 0;
  const moderate = Number(vulns.moderate) || 0;
  const low = Number(vulns.low) || 0;
  const info = Number(vulns.info) || 0;
  const total = Number(vulns.total) || critical + high + moderate + low + info;
  const detail = { critical, high, moderate, low, info, total };

  if (critical > 0 || high > 0) {
    return {
      id,
      name,
      status: 'fail',
      message: `${total} vulnerabilit${total === 1 ? 'y' : 'ies'} (${critical} critical, ${high} high)`,
      detail,
    };
  }
  if (moderate > 0 || low > 0 || total > 0) {
    return {
      id,
      name,
      status: 'warn',
      message: `${total} vulnerabilit${total === 1 ? 'y' : 'ies'} (${moderate} moderate, ${low} low)`,
      detail,
    };
  }
  return {
    id,
    name,
    status: 'ok',
    message: '0 vulnerabilities',
    detail,
  };
}

function runNpmAuditCheck(opts = {}) {
  const cwd = opts.cwd || path.join(__dirname, '..');
  const timeoutMs = opts.timeoutMs || 60000;
  const spawnFn = opts.spawnFn || spawn;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (check) => {
      if (settled) return;
      settled = true;
      resolve(check);
    };

    let stdout = '';
    let child;
    try {
      child = spawnFn('npm', ['audit', '--json'], {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      finish(npmAuditToCheck(null, err));
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      finish(npmAuditToCheck(null, new Error(`timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      finish(npmAuditToCheck(null, err));
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        finish(npmAuditToCheck(stdout ? JSON.parse(stdout) : null, null));
      } catch (err) {
        finish(npmAuditToCheck(null, err));
      }
    });
  });
}

function checkProcess() {
  const uptimeSec = Math.round(process.uptime());
  return {
    id: 'process',
    name: 'Process',
    status: 'ok',
    message: `up ${uptimeSec}s`,
    detail: { uptimeSec },
  };
}

function checkIngestKey(ingestKey) {
  if (!ingestKey || !String(ingestKey).trim()) {
    return {
      id: 'ingest_key',
      name: 'Ingest key',
      status: 'fail',
      message: 'STATUS_INGEST_KEY is not configured — clients cannot push',
    };
  }
  return {
    id: 'ingest_key',
    name: 'Ingest key',
    status: 'ok',
    message: 'STATUS_INGEST_KEY is set',
  };
}

function checkStore(storePath) {
  try {
    const dir = path.dirname(storePath);
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
    if (fs.existsSync(storePath)) {
      JSON.parse(fs.readFileSync(storePath, 'utf8') || '{}');
    }
    return {
      id: 'store',
      name: 'Report store',
      status: 'ok',
      message: `writable (${path.basename(storePath)})`,
    };
  } catch (err) {
    return {
      id: 'store',
      name: 'Report store',
      status: 'fail',
      message: err.message || String(err),
    };
  }
}

function checkExpectedServices(expectedServices) {
  const n = (expectedServices || []).length;
  if (n === 0) {
    return {
      id: 'expected_services',
      name: 'Expected services',
      status: 'warn',
      message: 'EXPECTED_SERVICES is empty — dashboard may only show pushers',
    };
  }
  return {
    id: 'expected_services',
    name: 'Expected services',
    status: 'ok',
    message: `${n} service${n === 1 ? '' : 's'} configured`,
    detail: { services: expectedServices },
  };
}

/**
 * Warn if no non-self reports received within the stale window.
 */
function checkFleetActivity(storeEntries, staleAfterMs, nowMs) {
  const entries = storeEntries || {};
  let latestExternal = null;
  for (const [service, entry] of Object.entries(entries)) {
    if (service === SERVICE_ID) continue;
    if (!entry || !entry.receivedAt) continue;
    const t = Date.parse(entry.receivedAt);
    if (!Number.isFinite(t)) continue;
    if (latestExternal == null || t > latestExternal) latestExternal = t;
  }
  if (latestExternal == null) {
    return {
      id: 'fleet_activity',
      name: 'Fleet activity',
      status: 'warn',
      message: 'no external service reports received yet',
    };
  }
  const age = nowMs - latestExternal;
  if (age > staleAfterMs) {
    return {
      id: 'fleet_activity',
      name: 'Fleet activity',
      status: 'warn',
      message: `no external report for ${Math.round(age / 1000)}s`,
      detail: { ageMs: age },
    };
  }
  return {
    id: 'fleet_activity',
    name: 'Fleet activity',
    status: 'ok',
    message: `last external report ${Math.round(age / 1000)}s ago`,
    detail: { ageMs: age },
  };
}

/**
 * @returns {Promise<object>} SPEC report for service-status
 */
async function buildSelfReport(options = {}) {
  const pkg = options.packageJson || require('../package.json');
  const env = options.env || process.env;
  const storePath = options.storePath;
  const expectedServices = options.expectedServices || [];
  const staleAfterMs = options.staleAfterMs || 900000;
  const storeEntries = options.storeEntries || {};
  const nowMs = options.nowMs != null ? options.nowMs : Date.now();

  const checks = [
    checkProcess(),
    checkIngestKey(options.ingestKey != null ? options.ingestKey : env.STATUS_INGEST_KEY),
    checkStore(storePath),
    checkExpectedServices(expectedServices),
    checkFleetActivity(storeEntries, staleAfterMs, nowMs),
  ];

  let runtime = options.runtime || null;
  if (!runtime && options.includeRuntimeSupport !== false) {
    runtime = detectRuntime({
      nodeVersion: options.nodeVersion,
      osInfo: options.osInfo,
      osReleasePath: options.osReleasePath,
      platform: options.platform,
      release: options.release,
      macOsVersion: options.macOsVersion,
    });
  }

  if (options.npmAuditCheck) {
    checks.push(options.npmAuditCheck);
  } else if (options.includeNpmAudit !== false) {
    checks.push(
      await runNpmAuditCheck({
        cwd: options.cwd,
        timeoutMs: options.npmAuditTimeoutMs,
        spawnFn: options.spawnFn,
      })
    );
  }

  const report = {
    service: SERVICE_ID,
    version: pkg.version,
    reportedAt: new Date(nowMs).toISOString(),
    instance: options.instance || env.HOSTNAME || os.hostname(),
    checks,
  };
  if (runtime) {
    report.runtime = runtime;
  }
  return report;
}

/**
 * Build report, enrich LTS checks, and upsert into store.
 */
async function upsertSelfReport(store, options = {}) {
  const report = await buildSelfReport({
    ...options,
    storeEntries: store.getAll(),
  });
  const enriched = await enrichReportWithRuntime(report, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.runtimeTimeoutMs,
    nodeVersion: options.nodeVersion,
    nodeCycles: options.nodeCycles,
    osInfo: options.osInfo,
    osCycles: options.osCycles,
    now: options.now || (options.nowMs != null ? new Date(options.nowMs) : undefined),
  });
  const receivedAt = new Date().toISOString();
  store.upsert(SERVICE_ID, enriched, receivedAt);
  return { report: enriched, receivedAt };
}

const DEFAULT_SELF_INTERVAL_MS = 5 * 60 * 1000;

function startSelfReporter(store, options = {}) {
  const intervalMs = options.intervalMs || DEFAULT_SELF_INTERVAL_MS;
  const startupDelayMs = options.startupDelayMs != null ? options.startupDelayMs : 3000;

  let timer = null;
  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await upsertSelfReport(store, options);
      console.log('[selfReport] upserted service-status');
    } catch (err) {
      console.warn('[selfReport] failed:', err.message || err);
    } finally {
      inFlight = false;
    }
  };

  const startup = setTimeout(() => {
    tick();
    timer = setInterval(tick, intervalMs);
    if (timer.unref) timer.unref();
  }, startupDelayMs);
  if (startup.unref) startup.unref();

  console.log(`[selfReport] enabled every ${intervalMs}ms (first in ${startupDelayMs}ms)`);

  return {
    stop() {
      stopped = true;
      clearTimeout(startup);
      if (timer) clearInterval(timer);
    },
  };
}

module.exports = {
  SERVICE_ID,
  npmAuditToCheck,
  runNpmAuditCheck,
  checkProcess,
  checkIngestKey,
  checkStore,
  checkExpectedServices,
  checkFleetActivity,
  buildSelfReport,
  upsertSelfReport,
  startSelfReporter,
  DEFAULT_SELF_INTERVAL_MS,
};
