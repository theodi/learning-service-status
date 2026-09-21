/**
 * Map `npm audit --json` output to a SPEC check.
 */

function npmAuditToCheck(auditJson, error, extraDetail) {
  const id = 'npm_audit';
  const name = 'npm audit';
  const baseDetail = extraDetail && typeof extraDetail === 'object' ? { ...extraDetail } : {};

  if (error) {
    return {
      id,
      name,
      status: 'warn',
      message: `npm audit could not run: ${error.message || String(error)}`,
      detail: { ...baseDetail, error: true },
    };
  }
  if (!auditJson || typeof auditJson !== 'object') {
    return {
      id,
      name,
      status: 'warn',
      message: 'npm audit returned no JSON',
      detail: { ...baseDetail },
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
  const detail = { ...baseDetail, critical, high, moderate, low, info, total };

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

module.exports = { npmAuditToCheck };
