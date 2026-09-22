/**
 * Build host + app reports for one agent run.
 */

const { buildHostChecks, detectOsInfo, runCmd } = require('./hostChecks');
const { discoverApps } = require('./discoverApps');
const { matchAppProcess } = require('./processMatch');
const { readAppEnv } = require('./readEnvFiles');
const { runConnectorProbes } = require('./probes');
const { npmAuditCheck, resolveNpmBin } = require('./npmAudit');

function check(id, name, status, message, detail) {
  const row = { id, name, status, message };
  if (detail) row.detail = detail;
  return row;
}

function detectNpmVersion(options = {}) {
  if (options.npmVersion) return options.npmVersion;
  const npmBin = options.npmBin || 'npm';
  const r = runCmd(npmBin, ['-v'], options);
  return r.ok ? r.out.split('\n')[0].trim() : null;
}

function progress(options, msg, detail) {
  if (typeof options.onProgress === 'function') {
    options.onProgress(msg, detail || {});
  }
}

/**
 * @param {object} config from readAgentConfig
 * @param {object} [options] injectables for tests; `onProgress(message, detail)` for CLI logging
 */
async function buildAllReports(config, options = {}) {
  const hostId = config.hostId;
  const reportedAt = new Date().toISOString();

  progress(options, 'Checking host (OS, apt, reboot)…', { phase: 'host', hostId });
  const { checks: hostChecks, osInfo } = buildHostChecks(options);
  const hostReport = {
    service: `host:${hostId}`,
    host: hostId,
    reportedAt,
    runtime: {
      os: {
        id: osInfo.id || undefined,
        versionId: osInfo.versionId || undefined,
        prettyName: osInfo.prettyName || undefined,
        platform: osInfo.platform,
        release: osInfo.release,
      },
    },
    checks: hostChecks,
  };
  progress(options, `Host checks done (${hostChecks.length} check(s))`, {
    phase: 'host',
    checks: hostChecks.map((c) => `${c.id}:${c.status}`),
  });

  progress(options, `Scanning for apps in ${config.scanRoots.length} root(s)…`, {
    phase: 'discover',
    roots: config.scanRoots,
  });
  const apps =
    options.apps ||
    discoverApps(config.scanRoots, { maxDepth: config.scanDepth });
  progress(options, `Found ${apps.length} app(s)`, {
    phase: 'discover',
    services: apps.map((a) => a.service),
  });

  const appReports = [];
  const total = apps.length;
  for (let i = 0; i < apps.length; i += 1) {
    const app = apps[i];
    const n = i + 1;
    progress(options, `[${n}/${total}] Checking ${app.service}…`, {
      phase: 'app',
      index: n,
      total,
      service: app.service,
      dir: app.dir,
    });

    progress(options, `[${n}/${total}] ${app.service}: matching process…`, {
      phase: 'app-process',
      service: app.service,
    });
    const proc = matchAppProcess(app.dir, options);
    const checks = [];
    if (proc.matched) {
      checks.push(
        check('process', 'Process', 'ok', `running (pid ${proc.pid})`, proc.detail)
      );
    } else {
      checks.push(
        check('process', 'Process', 'fail', 'no matching node process', proc.detail)
      );
    }

    progress(options, `[${n}/${total}] ${app.service}: reading env + connector probes…`, {
      phase: 'app-probes',
      service: app.service,
    });
    const envMap = options.appEnv || readAppEnv(app.dir);
    const connectors = await runConnectorProbes(envMap, options);
    checks.push(...connectors);

    const report = {
      service: app.service,
      host: hostId,
      reportedAt,
      checks,
    };
    if (app.version) report.version = app.version;

    const nodeVersion = proc.nodeVersion || options.nodeVersion || null;
    const nodeExe = proc.exe || options.nodeExe || null;
    const npmBin = options.npmBin || resolveNpmBin(nodeExe);
    const npmVersion = detectNpmVersion({ ...options, npmBin });
    report.runtime = {};
    if (nodeVersion) {
      report.runtime.node = nodeVersion;
    } else if (!proc.matched) {
      checks.push(
        check('node_version', 'Node version', 'warn', 'unknown (app not running)')
      );
    }
    if (npmVersion) {
      report.runtime.npm = npmVersion;
    }

    if (!app.packageLock) {
      checks.push(
        check('lockfile', 'Lockfile', 'warn', 'package-lock.json missing')
      );
    }

    progress(options, `[${n}/${total}] ${app.service}: npm audit…`, {
      phase: 'app-audit',
      service: app.service,
      npmBin,
    });
    const audit =
      typeof options.npmAuditCheck === 'function'
        ? await options.npmAuditCheck(app, { npmBin, nodeExe })
        : options.npmAuditCheck ||
          (await npmAuditCheck({
            cwd: app.dir,
            npmBin,
            nodeExe,
            timeoutMs: options.auditTimeoutMs,
            spawnFn: options.spawnFn,
          }));
    checks.push(audit);
    progress(
      options,
      `[${n}/${total}] ${app.service}: npm audit → ${audit.status} (${audit.message})`,
      { phase: 'app-audit-done', service: app.service, status: audit.status }
    );

    const worst = checks.some((c) => c.status === 'fail')
      ? 'fail'
      : checks.some((c) => c.status === 'warn')
        ? 'warn'
        : 'ok';
    progress(options, `[${n}/${total}] ${app.service}: done (${checks.length} checks, overall ${worst})`, {
      phase: 'app-done',
      index: n,
      total,
      service: app.service,
      overall: worst,
      process: proc.matched ? `pid ${proc.pid}` : 'not running',
      connectors: connectors.length,
      npm_audit: audit.status,
    });

    appReports.push(report);
  }

  return { hostReport, appReports, apps };
}

module.exports = { buildAllReports, detectOsInfo };
