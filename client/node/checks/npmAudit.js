/**
 * Map `npm audit --json` → SPEC check. Never throws.
 */

const { spawn } = require('child_process');
const path = require('path');

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

function npmAuditCheck(opts = {}) {
  const cwd = opts.cwd || process.cwd();
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

module.exports = { npmAuditCheck, npmAuditToCheck };
