/**
 * Host-level checks: OS, apt, reboot, system node/npm.
 */

const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

function detectOsInfo(options = {}) {
  const releasePath = options.osReleasePath || '/etc/os-release';
  const info = {
    platform: options.platform || process.platform,
    release: options.release || os.release(),
    id: null,
    versionId: null,
    prettyName: null,
  };
  try {
    const text = fs.readFileSync(releasePath, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (!m) continue;
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (m[1] === 'ID') info.id = val;
      if (m[1] === 'VERSION_ID') info.versionId = val;
      if (m[1] === 'PRETTY_NAME') info.prettyName = val;
    }
  } catch {
    info.prettyName = `${info.platform} ${info.release}`;
  }
  return info;
}

function runCmd(cmd, args, options = {}) {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: options.timeoutMs || 30000,
      env: options.env || process.env,
    }).trim();
    return { ok: true, out };
  } catch (err) {
    return {
      ok: false,
      out: (err.stdout && String(err.stdout).trim()) || '',
      error: err.message || String(err),
      code: err.status,
    };
  }
}

function checkRebootRequired(options = {}) {
  const flag = options.rebootFlagPath || '/var/run/reboot-required';
  if (fs.existsSync(flag)) {
    let pkgs = '';
    try {
      pkgs = fs.readFileSync(`${flag}.pkgs`, 'utf8').trim();
    } catch {
      /* optional */
    }
    return {
      id: 'reboot',
      name: 'Reboot required',
      status: 'warn',
      message: pkgs ? `reboot required (${pkgs.split('\n').length} packages)` : 'reboot required',
      detail: { required: true, packages: pkgs || null },
    };
  }
  return {
    id: 'reboot',
    name: 'Reboot required',
    status: 'ok',
    message: 'no reboot required',
    detail: { required: false },
  };
}

function checkApt(options = {}) {
  if (options.aptCheck) return options.aptCheck;
  // Prefer simulation without network when possible
  const sim = runCmd('apt-get', ['-s', 'upgrade'], options);
  if (!sim.ok && sim.code == null) {
    return {
      id: 'apt',
      name: 'apt upgrades',
      status: 'warn',
      message: `apt-get not available: ${sim.error || 'unknown'}`,
      detail: { error: true },
    };
  }
  const text = sim.out || '';
  const upgraded = (text.match(/^(Inst )/gm) || []).length;
  if (upgraded > 0) {
    return {
      id: 'apt',
      name: 'apt upgrades',
      status: 'warn',
      message: `${upgraded} package(s) can be upgraded`,
      detail: { pending: upgraded },
    };
  }
  return {
    id: 'apt',
    name: 'apt upgrades',
    status: 'ok',
    message: 'no pending upgrades (simulated)',
    detail: { pending: 0 },
  };
}

function checkBinaryVersion(name, args, options = {}) {
  const r = runCmd(name, args || ['-v'], options);
  if (!r.ok) {
    return {
      id: name.replace(/[^a-z0-9]+/gi, '_').toLowerCase(),
      name,
      status: 'warn',
      message: `${name} not on PATH`,
      detail: { error: true },
    };
  }
  return {
    id: name.replace(/[^a-z0-9]+/gi, '_').toLowerCase(),
    name,
    status: 'ok',
    message: r.out.split('\n')[0],
    detail: { version: r.out.split('\n')[0] },
  };
}

/**
 * Build host report checks + runtime.os (collector scores OS LTS).
 * Do not emit os_identity / node / npm here — apps get Node+npm LTS; hosts get OS only.
 */
function buildHostChecks(options = {}) {
  const osInfo = options.osInfo || detectOsInfo(options);
  const checks = [checkApt(options), checkRebootRequired(options)];
  return { checks, osInfo };
}

module.exports = {
  detectOsInfo,
  checkRebootRequired,
  checkApt,
  checkBinaryVersion,
  buildHostChecks,
  runCmd,
};
