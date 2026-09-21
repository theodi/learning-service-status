/**
 * Build and upsert a self health report for service-status into the local store.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectRuntime } = require('./runtimeSupportChecks');
const { enrichReportWithRuntime } = require('./enrichRuntime');
const { enrichReportWithNpmAudit } = require('./enrichNpmAudit');
const { npmAuditToCheck } = require('./npmAuditScore');
const { readDependencies } = require('./readDependencies');

const SERVICE_ID = 'service-status';

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

  let dependencies = options.dependencies || null;
  if (!dependencies && options.includeDependencies !== false) {
    dependencies =
      readDependencies({
        cwd: options.cwd || path.join(__dirname, '..'),
      }) || null;
  }

  // Prefer collector-side audit via dependencies; optional legacy inject for tests
  if (options.npmAuditCheck) {
    checks.push(options.npmAuditCheck);
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
  if (dependencies) {
    report.dependencies = dependencies;
  }
  return report;
}

/**
 * Build report, enrich LTS + npm audit, and upsert into store.
 */
async function upsertSelfReport(store, options = {}) {
  const report = await buildSelfReport({
    ...options,
    storeEntries: store.getAll(),
  });
  let enriched = await enrichReportWithRuntime(report, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.runtimeTimeoutMs,
    nodeVersion: options.nodeVersion,
    nodeCycles: options.nodeCycles,
    osInfo: options.osInfo,
    osCycles: options.osCycles,
    now: options.now || (options.nowMs != null ? new Date(options.nowMs) : undefined),
  });
  enriched = await enrichReportWithNpmAudit(enriched, {
    timeoutMs: options.npmAuditTimeoutMs,
    auditCheck: options.npmAuditCheck,
    auditFn: options.npmAuditFn,
    useCache: options.npmAuditUseCache,
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
