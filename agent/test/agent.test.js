const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { discoverApps } = require('../lib/discoverApps');
const { matchAppProcess } = require('../lib/processMatch');
const { parseEnvText, readAppEnv } = require('../lib/readEnvFiles');
const { runConnectorProbes, presenceChecks } = require('../lib/probes');
const { buildAllReports } = require('../lib/buildReports');
const { checkRebootRequired } = require('../lib/hostChecks');

describe('discoverApps', () => {
  it('finds package.json under roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-disc-'));
    const appDir = path.join(root, 'my-app');
    fs.mkdirSync(appDir);
    fs.writeFileSync(
      path.join(appDir, 'package.json'),
      JSON.stringify({ name: 'my-app', version: '1.2.3' })
    );
    fs.writeFileSync(
      path.join(appDir, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: {} })
    );
    const apps = discoverApps([root], { maxDepth: 3 });
    assert.equal(apps.length, 1);
    assert.equal(apps[0].service, 'my-app');
    assert.equal(apps[0].version, '1.2.3');
    assert.ok(apps[0].packageLock);
  });
});

describe('processMatch', () => {
  it('matches cwd to app dir', () => {
    const appDir = '/var/www/care.theodi.org';
    const out = matchAppProcess(appDir, {
      processes: [
        {
          pid: 42,
          cmdline: 'node server.js',
          cwd: appDir,
          exe: '/usr/bin/node',
        },
      ],
    });
    assert.equal(out.matched, true);
    assert.equal(out.pid, 42);
  });

  it('returns unmatched when no process', () => {
    const out = matchAppProcess('/nope', { processes: [] });
    assert.equal(out.matched, false);
  });
});

describe('env + probes', () => {
  it('parses env text', () => {
    const env = parseEnvText('FOO=bar\n# c\nBAZ="qux"\n');
    assert.equal(env.FOO, 'bar');
    assert.equal(env.BAZ, 'qux');
  });

  it('presence checks for oauth keys', () => {
    const checks = presenceChecks({
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
    });
    assert.ok(checks.some((c) => c.id === 'google_oauth' && c.status === 'ok'));
  });

  it('probes hubspot with mocked fetch', async () => {
    const checks = await runConnectorProbes(
      { HUBSPOT_API_KEY: 'real-key-not-placeholder' },
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          async text() {
            return '{}';
          },
        }),
      }
    );
    assert.equal(checks[0].id, 'hubspot');
    assert.equal(checks[0].status, 'ok');
  });

  it('probes forecast with mocked fetch', async () => {
    const { probeForecast } = require('../lib/probes');
    const check = await probeForecast(
      { FORECAST_API_KEY: 'forecast-key-abc' },
      {
        fetchImpl: async (url, opts) => {
          assert.match(url, /forecast\.it/);
          assert.equal(opts.headers['X-FORECAST-API-KEY'], 'forecast-key-abc');
          return { ok: true, status: 200, async text() { return '[]'; } };
        },
      }
    );
    assert.equal(check.id, 'forecast');
    assert.equal(check.status, 'ok');
  });

  it('probes moodle and rejects invalidtoken', async () => {
    const { probeMoodle } = require('../lib/probes');
    const check = await probeMoodle(
      {
        MOODLE_URI: 'https://moodle.example.org/webservice/rest/server.php',
        MOODLE_TOKEN: 'bad-token-xyz',
      },
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          async text() {
            return '{"exception":"moodle_exception","errorcode":"invalidtoken","message":"Invalid token"}';
          },
        }),
      }
    );
    assert.equal(check.id, 'moodle');
    assert.equal(check.status, 'fail');
  });

  it('resolves MONGODB_URI for mongo probe', async () => {
    const { resolveMongoUri, probeMongo } = require('../lib/probes');
    assert.equal(resolveMongoUri({ MONGODB_URI: 'mongodb://localhost/x' }).source, 'MONGODB_URI');
    assert.equal(resolveMongoUri({ MONGO_URL: 'mongodb://localhost/certs' }).source, 'MONGO_URL');
    const check = await probeMongo(
      { MONGODB_URI: 'mongodb://localhost/x' },
      {
        mongoPing: async () => {},
      }
    );
    assert.equal(check.status, 'ok');
  });

  it('probes email oauth2 via refresh + gmail profile', async () => {
    const { probeEmail } = require('../lib/probes');
    let step = 0;
    const check = await probeEmail(
      {
        EMAIL_USE_OAUTH2: 'true',
        EMAIL_USER: 'training@theodi.org',
        GOOGLE_CLIENT_ID: 'cid',
        GOOGLE_CLIENT_SECRET: 'csecret',
        GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh-token-value',
      },
      {
        fetchImpl: async (url) => {
          step += 1;
          if (String(url).includes('oauth2.googleapis.com/token')) {
            return {
              ok: true,
              status: 200,
              async text() {
                return JSON.stringify({ access_token: 'atok' });
              },
            };
          }
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({ emailAddress: 'training@theodi.org' });
            },
          };
        },
      }
    );
    assert.equal(check.id, 'email');
    assert.equal(check.status, 'ok');
    assert.equal(check.detail.mode, 'oauth2');
    assert.ok(step >= 2);
  });
});

describe('hostChecks', () => {
  it('reboot check when flag missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-reboot-'));
    const check = checkRebootRequired({ rebootFlagPath: path.join(dir, 'reboot-required') });
    assert.equal(check.status, 'ok');
  });

  it('reboot check when flag present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-reboot-'));
    const flag = path.join(dir, 'reboot-required');
    fs.writeFileSync(flag, '');
    const check = checkRebootRequired({ rebootFlagPath: flag });
    assert.equal(check.status, 'warn');
  });
});

describe('buildAllReports', () => {
  it('builds host + app reports with host field', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-build-'));
    const appDir = path.join(root, 'demo');
    fs.mkdirSync(appDir);
    fs.writeFileSync(
      path.join(appDir, 'package.json'),
      JSON.stringify({ name: 'demo-app', version: '0.1.0' })
    );
    fs.writeFileSync(
      path.join(appDir, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: {} })
    );
    fs.writeFileSync(path.join(appDir, 'config.env'), 'SESSION_SECRET=abc123notplaceholder\n');

    const { hostReport, appReports } = await buildAllReports(
      { hostId: 'testhost', scanRoots: [root], scanDepth: 3 },
      {
        osInfo: {
          id: 'ubuntu',
          versionId: '24.04',
          prettyName: 'Ubuntu 24.04',
          platform: 'linux',
          release: '6.8',
        },
        aptCheck: {
          id: 'apt',
          name: 'apt upgrades',
          status: 'ok',
          message: '0 pending',
        },
        processes: [],
        rebootFlagPath: path.join(root, 'no-reboot'),
        npmVersion: '10.9.0',
        npmAuditCheck: {
          id: 'npm_audit',
          name: 'npm audit',
          status: 'ok',
          message: '0 vulnerabilities',
          detail: { source: 'agent', engine: 'npm', total: 0 },
        },
      }
    );

    assert.equal(hostReport.service, 'host:testhost');
    assert.equal(hostReport.host, 'testhost');
    assert.ok(hostReport.checks.some((c) => c.id === 'apt'));
    assert.ok(!hostReport.checks.some((c) => c.id === 'os_identity'));
    assert.ok(!hostReport.checks.some((c) => c.id === 'node'));
    assert.equal(appReports.length, 1);
    assert.equal(appReports[0].service, 'demo-app');
    assert.equal(appReports[0].host, 'testhost');
    assert.equal(appReports[0].runtime.npm, '10.9.0');
    assert.ok(!appReports[0].runtime.os);
    assert.ok(!appReports[0].dependencies);
    assert.ok(appReports[0].checks.some((c) => c.id === 'process' && c.status === 'fail'));
    assert.ok(appReports[0].checks.some((c) => c.id === 'session'));
    assert.ok(
      appReports[0].checks.some(
        (c) => c.id === 'npm_audit' && c.status === 'ok' && c.detail.source === 'agent'
      )
    );
  });
});

describe('npmAudit', () => {
  it('maps high vulns to fail', () => {
    const { npmAuditToCheck } = require('../lib/npmAudit');
    const check = npmAuditToCheck({
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
      },
    });
    assert.equal(check.status, 'fail');
  });

  it('resolveNpmBin prefers sibling of node exe', () => {
    const { resolveNpmBin } = require('../lib/npmAudit');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-npmbin-'));
    const nodeExe = path.join(dir, 'node');
    const npmPath = path.join(dir, 'npm');
    fs.writeFileSync(nodeExe, '');
    fs.writeFileSync(npmPath, '');
    assert.equal(resolveNpmBin(nodeExe), npmPath);
    assert.equal(resolveNpmBin(null), 'npm');
  });
});

describe('readAgentConfig', () => {
  it('loads scanRoots array from config.json', () => {
    const { readAgentConfig } = require('../lib/config');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-cfg-'));
    const fp = path.join(dir, 'config.json');
    fs.writeFileSync(
      fp,
      JSON.stringify({
        statusReportUrl: 'http://example/reports',
        statusReportKey: 'k',
        hostId: 'h1',
        scanRoots: ['/a', '/b/c'],
        scanDepth: 2,
      })
    );
    const cfg = readAgentConfig({ configPath: fp });
    assert.equal(cfg.hostId, 'h1');
    assert.deepEqual(cfg.scanRoots, ['/a', '/b/c']);
    assert.equal(cfg.scanDepth, 2);
    assert.equal(cfg.enabled, true);
  });

  it('falls back to config.env and parses multiline SCAN_ROOTS', () => {
    const { readAgentConfig, parseScanRoots } = require('../lib/config');
    assert.deepEqual(parseScanRoots('/a,/b\n/c'), ['/a', '/b', '/c']);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-cfgenv-'));
    const fp = path.join(dir, 'config.env');
    fs.writeFileSync(
      fp,
      'STATUS_REPORT_URL=http://x/reports\nSTATUS_REPORT_KEY=k\nHOST_ID=h2\nSCAN_ROOTS=/one,/two\n'
    );
    const cfg = readAgentConfig({ configPath: fp, env: {} });
    assert.equal(cfg.hostId, 'h2');
    assert.deepEqual(cfg.scanRoots, ['/one', '/two']);
  });

  it('prefers config.json over config.env in same dir', () => {
    const { resolveConfigPath } = require('../lib/config');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-pref-'));
    fs.writeFileSync(path.join(dir, 'config.env'), 'HOST_ID=env\n');
    fs.writeFileSync(path.join(dir, 'config.json'), '{"hostId":"json","scanRoots":[]}');
    assert.equal(resolveConfigPath({ configDir: dir }), path.join(dir, 'config.json'));
  });
});
