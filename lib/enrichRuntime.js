/**
 * Enrich a validated report with collector-scored runtime checks.
 * Hosts (service `host:*`): OS LTS only.
 * Apps: Node LTS + npm support window; no OS check.
 */

const {
  OS_ID_TO_PRODUCT,
  checkNodeRuntime,
  checkNpmRuntime,
  checkOperatingSystem,
  detectRuntime,
} = require('./runtimeSupportChecks');

const RUNTIME_CHECK_IDS = new Set(['node_runtime', 'npm_runtime', 'operating_system']);

function isHostReport(report) {
  return String((report && report.service) || '').startsWith('host:');
}

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
 * @param {object} [options] passed through to runtime checkers
 */
async function enrichReportWithRuntime(report, options = {}) {
  if (!report || typeof report !== 'object') return report;

  const originalChecks = Array.isArray(report.checks) ? report.checks : [];
  const appChecks = originalChecks.filter((c) => !RUNTIME_CHECK_IDS.has(c.id));
  const legacyRuntimeChecks = originalChecks.filter((c) => RUNTIME_CHECK_IDS.has(c.id));

  const runtime = report.runtime || {};
  const injected = [];

  if (isHostReport(report)) {
    const osInfo = runtime.os ? runtimeOsToOsInfo(runtime.os) : null;
    if (osInfo) {
      injected.push(await checkOperatingSystem({ ...options, osInfo }));
    } else if (legacyRuntimeChecks.some((c) => c.id === 'operating_system')) {
      injected.push(...legacyRuntimeChecks.filter((c) => c.id === 'operating_system'));
    } else {
      injected.push(
        missingRequiredCheck(
          'operating_system',
          'Operating system',
          'runtime.os not reported (required for host reports)'
        )
      );
    }
    return { ...report, checks: [...injected, ...appChecks] };
  }

  // App reports: Node + npm LTS/support; never inject OS
  const hasNode = Boolean(runtime.node);
  const hasNpm = Boolean(runtime.npm);

  if (hasNode || hasNpm || legacyRuntimeChecks.length) {
    const checkOpts = { ...options };
    if (hasNode) checkOpts.nodeVersion = runtime.node;
    if (hasNpm) checkOpts.npmVersion = runtime.npm;

    const [node, npm] = await Promise.all([
      hasNode ? checkNodeRuntime(checkOpts) : Promise.resolve(null),
      hasNpm ? checkNpmRuntime(checkOpts) : Promise.resolve(null),
    ]);

    if (node) injected.push(node);
    else {
      injected.push(
        missingRequiredCheck(
          'node_runtime',
          'Node.js',
          'runtime.node not reported (required for Node apps)'
        )
      );
    }
    if (npm) injected.push(npm);
    else {
      injected.push(
        missingRequiredCheck(
          'npm_runtime',
          'npm',
          'runtime.npm not reported (required for Node apps)'
        )
      );
    }
  } else {
    injected.push(
      missingRequiredCheck(
        'node_runtime',
        'Node.js',
        'runtime not reported (required for Node apps)'
      ),
      missingRequiredCheck(
        'npm_runtime',
        'npm',
        'runtime.npm not reported (required for Node apps)'
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
  isHostReport,
};
