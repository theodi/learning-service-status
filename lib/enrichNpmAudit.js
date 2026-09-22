/**
 * Ensure app reports include an npm_audit check from the host agent.
 * Collector no longer runs npm audit (Arborist) — Node/npm may differ per app.
 */

const { npmAuditToCheck } = require('./npmAuditScore');

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
 * @param {object} report
 * @param {object} [options]
 */
async function enrichReportWithNpmAudit(report, options = {}) {
  if (!report || typeof report !== 'object') return report;

  // Host machine reports never get npm audit
  if (String(report.service || '').startsWith('host:')) {
    const checks = Array.isArray(report.checks)
      ? report.checks.filter((c) => c.id !== 'npm_audit')
      : [];
    return { ...report, checks };
  }

  const checks = Array.isArray(report.checks) ? [...report.checks] : [];
  const withoutAudit = checks.filter((c) => c.id !== 'npm_audit');
  const agentAudit = checks.find((c) => c.id === 'npm_audit');

  let auditCheck;
  if (options.auditCheck) {
    // Test / override inject
    auditCheck = options.auditCheck;
  } else if (agentAudit) {
    auditCheck = agentAudit;
  } else {
    auditCheck = missingRequiredCheck(
      'npm_audit',
      'npm audit',
      'npm_audit not reported (host agent should run npm audit in the app directory)'
    );
  }

  return {
    ...report,
    checks: [...withoutAudit, auditCheck],
  };
}

module.exports = {
  enrichReportWithNpmAudit,
  npmAuditToCheck,
};
