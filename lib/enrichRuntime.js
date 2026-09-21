/**
 * Enrich a validated report: score Node/OS LTS on the collector from `runtime`,
 * and ensure required Node gaps (runtime / npm_audit) are visible on the dashboard.
 */

const {
  OS_ID_TO_PRODUCT,
  checkNodeRuntime,
  checkOperatingSystem,
  detectRuntime,
} = require('./runtimeSupportChecks');

const RUNTIME_CHECK_IDS = new Set(['node_runtime', 'operating_system']);

/**
 * Map SPEC runtime.os → detectOsInfo-shaped object for checkOperatingSystem.
 */
function runtimeOsToOsInfo(os) {
  if (!os || typeof os !== 'object') return null;
  const id = (os.id || '').toLowerCase();
  const product =
    os.product ||
    OS_ID_TO_PRODUCT[id] ||
    (id && OS_ID_TO_PRODUCT[id.replace(/[^a-z0-9-]/g, '')]) ||
    null;
  const cycle = os.versionId || os.cycle || null;
  const prettyName =
    os.prettyName ||
    `${os.id || product || os.platform || 'os'} ${cycle || ''}`.trim();
  return {
    product: product || null,
    cycle: cycle || null,
    prettyName,
    platform: os.platform || 'linux',
    release: os.release || '',
    id: id || undefined,
  };
}

function missingRequiredCheck(id, name, message) {
  return {
    id,
    name,
    status: 'warn',
    message,
    detail: { required: true, missing: true },
  };
}

/**
 * @param {object} report validated report
 * @param {object} [options] passed through to checkNodeRuntime / checkOperatingSystem
 * @returns {Promise<object>} report with runtime checks injected when applicable
 */
async function enrichReportWithRuntime(report, options = {}) {
  if (!report || typeof report !== 'object') return report;

  const originalChecks = Array.isArray(report.checks) ? report.checks : [];
  const appChecks = originalChecks.filter((c) => !RUNTIME_CHECK_IDS.has(c.id));
  const legacyRuntimeChecks = originalChecks.filter((c) => RUNTIME_CHECK_IDS.has(c.id));

  const runtime = report.runtime;
  const hasNode = Boolean(runtime && runtime.node);
  const osInfo = runtime && runtime.os ? runtimeOsToOsInfo(runtime.os) : null;
  const hasOs = Boolean(osInfo);
  const hasRuntime = hasNode || hasOs;

  const injected = [];

  if (hasRuntime) {
    const checkOpts = { ...options };
    if (hasNode) checkOpts.nodeVersion = runtime.node;
    if (osInfo) checkOpts.osInfo = osInfo;

    const [node, operatingSystem] = await Promise.all([
      hasNode ? checkNodeRuntime(checkOpts) : Promise.resolve(null),
      osInfo ? checkOperatingSystem(checkOpts) : Promise.resolve(null),
    ]);
    if (node) injected.push(node);
    else {
      injected.push(
        missingRequiredCheck(
          'node_runtime',
          'Node.js',
          'runtime.node not reported (required for Node services)'
        )
      );
    }
    if (operatingSystem) injected.push(operatingSystem);
    else {
      injected.push(
        missingRequiredCheck(
          'operating_system',
          'Operating system',
          'runtime.os not reported (required for Node services)'
        )
      );
    }
  } else if (legacyRuntimeChecks.length) {
    injected.push(...legacyRuntimeChecks);
  } else {
    injected.push(
      missingRequiredCheck(
        'node_runtime',
        'Node.js',
        'runtime not reported (required for Node services)'
      ),
      missingRequiredCheck(
        'operating_system',
        'Operating system',
        'runtime not reported (required for Node services)'
      )
    );
  }

  const hasNpmAudit = appChecks.some((c) => c.id === 'npm_audit');
  if (!hasNpmAudit) {
    appChecks.push(
      missingRequiredCheck(
        'npm_audit',
        'npm audit',
        'npm_audit check not reported (required for Node services)'
      )
    );
  }

  return {
    ...report,
    checks: [...injected, ...appChecks],
  };
}

module.exports = {
  RUNTIME_CHECK_IDS,
  runtimeOsToOsInfo,
  enrichReportWithRuntime,
  detectRuntime,
  missingRequiredCheck,
};
