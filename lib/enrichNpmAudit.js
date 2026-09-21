/**
 * Collector-side npm audit from report.dependencies (packageJson + packageLock).
 * Uses @npmcli/arborist in-process (no `npm` binary / no install).
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Arborist } = require('@npmcli/arborist');
const { npmAuditToCheck } = require('./npmAuditScore');

const AUDIT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
/** @type {Map<string, { at: number, check: object }>} */
const auditCache = new Map();

function missingRequiredCheck(id, name, message) {
  return {
    id,
    name,
    status: 'warn',
    message,
    detail: { required: true, missing: true },
  };
}

function clearNpmAuditCache() {
  auditCache.clear();
}

function hashDependencies(deps) {
  const payload = JSON.stringify({
    packageJson: deps.packageJson,
    packageLock: deps.packageLock,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function writeJsonFile(fp, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  fs.writeFileSync(fp, text, 'utf8');
}

/**
 * Run Arborist audit against package.json + lockfile already written in cwd.
 * @param {string} cwd
 * @param {object} [options]
 * @param {typeof Arborist} [options.ArboristClass]
 * @param {(cwd: string, options?: object) => Promise<object>} [options.auditFn]
 */
async function runNpmAuditInDir(cwd, options = {}) {
  const timeoutMs = options.timeoutMs || 60000;
  const detail = { source: 'collector', engine: 'arborist' };

  if (typeof options.auditFn === 'function') {
    try {
      const json = await options.auditFn(cwd, options);
      return npmAuditToCheck(json, null, detail);
    } catch (err) {
      return npmAuditToCheck(null, err, detail);
    }
  }

  const ArboristClass = options.ArboristClass || Arborist;

  const auditPromise = (async () => {
    const arb = new ArboristClass({ path: cwd });
    const report = await arb.audit({ fix: false });
    if (report && report.error) {
      throw report.error;
    }
    return report && typeof report.toJSON === 'function' ? report.toJSON() : null;
  })();

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const json = await Promise.race([auditPromise, timeoutPromise]);
    return npmAuditToCheck(json, null, detail);
  } catch (err) {
    return npmAuditToCheck(null, err, detail);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} dependencies
 * @param {object} [options]
 */
async function auditDependencies(dependencies, options = {}) {
  const packageJson = dependencies && dependencies.packageJson;
  const packageLock = dependencies && dependencies.packageLock;
  if (!packageJson || !packageLock) {
    return missingRequiredCheck(
      'npm_audit',
      'npm audit',
      'dependencies.packageJson and dependencies.packageLock are required (collector runs npm audit)'
    );
  }

  const cacheKey = hashDependencies({ packageJson, packageLock });
  const ttl = options.cacheTtlMs != null ? options.cacheTtlMs : AUDIT_CACHE_TTL_MS;
  if (options.useCache !== false) {
    const hit = auditCache.get(cacheKey);
    if (hit && Date.now() - hit.at < ttl) {
      return { ...hit.check, detail: { ...(hit.check.detail || {}), cached: true } };
    }
  }

  if (options.auditCheck) {
    const check = options.auditCheck;
    if (options.useCache !== false) {
      auditCache.set(cacheKey, { at: Date.now(), check });
    }
    return check;
  }

  const tmpRoot = options.tmpDir || os.tmpdir();
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'ss-npm-audit-'));
  try {
    writeJsonFile(path.join(dir, 'package.json'), packageJson);
    writeJsonFile(path.join(dir, 'package-lock.json'), packageLock);
    const check = await runNpmAuditInDir(dir, options);
    if (options.useCache !== false && check && !check.detail?.error) {
      auditCache.set(cacheKey, { at: Date.now(), check });
    }
    return check;
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {object} report
 * @param {object} [options]
 */
async function enrichReportWithNpmAudit(report, options = {}) {
  if (!report || typeof report !== 'object') return report;

  const checks = Array.isArray(report.checks) ? [...report.checks] : [];
  const withoutAudit = checks.filter((c) => c.id !== 'npm_audit');
  const legacyAudit = checks.find((c) => c.id === 'npm_audit');

  const deps = report.dependencies;
  const hasDeps =
    deps &&
    typeof deps === 'object' &&
    deps.packageJson &&
    deps.packageLock;

  let auditCheck;
  if (hasDeps) {
    auditCheck = await auditDependencies(deps, options);
  } else if (legacyAudit) {
    auditCheck = legacyAudit;
  } else {
    auditCheck = missingRequiredCheck(
      'npm_audit',
      'npm audit',
      'dependencies not reported (send packageJson + packageLock; collector runs npm audit)'
    );
  }

  return {
    ...report,
    checks: [...withoutAudit, auditCheck],
  };
}

module.exports = {
  AUDIT_CACHE_TTL_MS,
  clearNpmAuditCache,
  hashDependencies,
  auditDependencies,
  enrichReportWithNpmAudit,
  runNpmAuditInDir,
  npmAuditToCheck,
};
