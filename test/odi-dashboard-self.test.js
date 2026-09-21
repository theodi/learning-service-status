const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  isOdiStaffEmail,
  ensureOdiStaff,
  requireAuthJson,
} = require('../lib/odiStaff');
const {
  sortDashboardRows,
  summarizeFleet,
  withSelfExpected,
} = require('../lib/dashboard');
const { buildDashboardRows } = require('../lib/validateReport');
const {
  npmAuditToCheck,
  checkIngestKey,
  checkExpectedServices,
  checkFleetActivity,
  checkStore,
  buildSelfReport,
} = require('../lib/selfReport');
const {
  evaluateSupportWindow,
  checkNodeRuntime,
  checkOperatingSystem,
} = require('../lib/runtimeSupportChecks');

describe('odiStaff', () => {
  it('accepts @theodi.org emails only', () => {
    assert.equal(isOdiStaffEmail('a@theodi.org'), true);
    assert.equal(isOdiStaffEmail('x@THEODI.ORG'), true);
    assert.equal(isOdiStaffEmail('a@example.com'), false);
    assert.equal(isOdiStaffEmail('a@mail.theodi.org'), false);
  });

  it('ensureOdiStaff calls next for staff', () => {
    let called = false;
    ensureOdiStaff(
      { user: { email: 'staff@theodi.org' } },
      {},
      () => {
        called = true;
      }
    );
    assert.equal(called, true);
  });

  it('ensureOdiStaff rejects non-staff', () => {
    ensureOdiStaff({ user: { email: 'x@example.com' } }, {}, (err) => {
      assert.equal(err.status, 403);
    });
  });

  it('requireAuthJson returns 401 when not authenticated', () => {
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(b) {
        this.body = b;
      },
    };
    requireAuthJson({ isAuthenticated: () => false }, res, () => {
      assert.fail('should not call next');
    });
    assert.equal(res.statusCode, 401);
  });
});

describe('dashboard helpers', () => {
  it('always includes service-status in expected', () => {
    assert.deepEqual(withSelfExpected(['care.theodi.org']), [
      'care.theodi.org',
      'service-status',
    ]);
  });

  it('sorts fail before warn before ok', () => {
    const sorted = sortDashboardRows([
      { service: 'b', overall: 'ok' },
      { service: 'a', overall: 'fail' },
      { service: 'c', overall: 'warn' },
    ]);
    assert.deepEqual(
      sorted.map((r) => r.service),
      ['a', 'c', 'b']
    );
  });

  it('summarizes fleet counts', () => {
    const s = summarizeFleet([
      { overall: 'fail', stale: false },
      { overall: 'warn', stale: true },
      { overall: 'ok', stale: false },
    ]);
    assert.equal(s.fail, 1);
    assert.equal(s.warn, 1);
    assert.equal(s.ok, 1);
    assert.equal(s.stale, 1);
    assert.equal(s.overall, 'fail');
  });

  it('shows many expected services as stale when empty store', () => {
    const rows = buildDashboardRows({
      storeEntries: {},
      expectedServices: withSelfExpected(['care.theodi.org', 'other.app']),
      staleAfterMs: 900000,
      now: new Date(),
    });
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.stale));
  });
});

describe('selfReport', () => {
  it('maps npm audit high vulns to fail', () => {
    const check = npmAuditToCheck({
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 },
      },
    });
    assert.equal(check.status, 'fail');
  });

  it('fails when ingest key missing', () => {
    assert.equal(checkIngestKey('').status, 'fail');
    assert.equal(checkIngestKey('secret').status, 'ok');
  });

  it('warns when expected services empty', () => {
    assert.equal(checkExpectedServices([]).status, 'warn');
    assert.equal(checkExpectedServices(['a']).status, 'ok');
  });

  it('warns when no external fleet activity', () => {
    const check = checkFleetActivity(
      { 'service-status': { receivedAt: new Date().toISOString() } },
      900000,
      Date.now()
    );
    assert.equal(check.status, 'warn');
  });

  it('checks store writability', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-store-'));
    const storePath = path.join(dir, 'reports.json');
    const check = checkStore(storePath);
    assert.equal(check.status, 'ok');
  });

  it('builds a self report with runtime and lockfiles (audit on enrich)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-self-'));
    const storePath = path.join(dir, 'reports.json');
    const now = new Date('2026-09-21T12:00:00.000Z');
    const report = await buildSelfReport({
      storePath,
      ingestKey: 'k',
      expectedServices: ['care.theodi.org', 'service-status'],
      staleAfterMs: 900000,
      storeEntries: {},
      dependencies: {
        packageJson: { name: 'service-status', version: '1.0.0' },
        packageLock: { lockfileVersion: 3, packages: {} },
      },
      packageJson: { version: '1.0.0' },
      instance: 'test',
      nowMs: now.getTime(),
      now,
      nodeVersion: 'v22.23.2',
      osInfo: {
        product: 'ubuntu',
        cycle: '24.04',
        prettyName: 'Ubuntu 24.04.1 LTS',
        platform: 'linux',
        release: '6.8.0',
        id: 'ubuntu',
      },
    });
    assert.equal(report.service, 'service-status');
    assert.ok(report.runtime);
    assert.equal(report.runtime.node, 'v22.23.2');
    assert.ok(report.dependencies);
    assert.equal(report.dependencies.packageLock.lockfileVersion, 3);
    assert.ok(!report.checks.some((c) => c.id === 'node_runtime'));
    assert.ok(!report.checks.some((c) => c.id === 'npm_audit'));
    assert.ok(report.checks.some((c) => c.id === 'process'));

    const { enrichReportWithRuntime } = require('../lib/enrichRuntime');
    const { enrichReportWithNpmAudit } = require('../lib/enrichNpmAudit');
    let enriched = await enrichReportWithRuntime(report, {
      now,
      nodeCycles: [
        { cycle: '22', lts: '2024-10-29', eol: '2027-04-30', latest: '22.23.2' },
      ],
      osCycles: [{ cycle: '24.04', lts: true, eol: '2029-04-25' }],
    });
    enriched = await enrichReportWithNpmAudit(enriched, {
      useCache: false,
      auditCheck: {
        id: 'npm_audit',
        name: 'npm audit',
        status: 'ok',
        message: '0 vulnerabilities',
        detail: { source: 'collector' },
      },
    });
    assert.ok(enriched.checks.some((c) => c.id === 'node_runtime' && c.status === 'ok'));
    assert.ok(enriched.checks.some((c) => c.id === 'operating_system' && c.status === 'ok'));
    assert.ok(
      enriched.checks.some(
        (c) => c.id === 'npm_audit' && c.status === 'ok' && c.detail.source === 'collector'
      )
    );
  });
});

describe('runtimeSupportChecks', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');
  const nodeCycles = [
    { cycle: '25', lts: false, eol: '2026-06-01', latest: '25.9.0' },
    { cycle: '22', lts: '2024-10-29', eol: '2027-04-30', latest: '22.23.2' },
    { cycle: '20', lts: '2023-10-24', eol: '2026-04-30', latest: '20.20.2' },
  ];
  const ubuntuCycles = [
    { cycle: '24.04', lts: true, eol: '2029-04-25' },
    { cycle: '22.04', lts: true, eol: '2027-04-01' },
    { cycle: '20.04', lts: true, eol: '2025-05-31' },
    { cycle: '25.04', lts: false, eol: '2026-01-01' },
  ];

  it('marks active LTS Node ok, nearing EOL warn, past EOL fail', async () => {
    assert.equal(
      (await checkNodeRuntime({ nodeVersion: 'v22.23.2', nodeCycles, now })).status,
      'ok'
    );
    assert.equal(
      evaluateSupportWindow({
        isLts: true,
        eol: '2027-04-30',
        label: 'Node v22',
        now: new Date('2027-02-01T00:00:00.000Z'),
      }).status,
      'warn'
    );
    assert.equal(
      (await checkNodeRuntime({ nodeVersion: 'v20.20.2', nodeCycles, now })).status,
      'fail'
    );
  });

  it('fails non-LTS Node releases', async () => {
    assert.equal(
      (await checkNodeRuntime({ nodeVersion: 'v25.0.0', nodeCycles, now })).status,
      'fail'
    );
  });

  it('marks Ubuntu LTS ok / warn / fail and non-LTS fail', async () => {
    assert.equal(
      (
        await checkOperatingSystem({
          osInfo: {
            product: 'ubuntu',
            cycle: '22.04',
            prettyName: 'Ubuntu 22.04.3 LTS',
            platform: 'linux',
            release: '6.8',
          },
          osCycles: ubuntuCycles,
          now,
        })
      ).status,
      'ok'
    );
    assert.equal(
      evaluateSupportWindow({
        isLts: true,
        eol: '2027-04-01',
        label: 'Ubuntu 22.04',
        now: new Date('2027-02-01T00:00:00.000Z'),
      }).status,
      'warn'
    );
    assert.equal(
      (
        await checkOperatingSystem({
          osInfo: {
            product: 'ubuntu',
            cycle: '20.04',
            prettyName: 'Ubuntu 20.04.6 LTS',
            platform: 'linux',
            release: '5.15',
          },
          osCycles: ubuntuCycles,
          now,
        })
      ).status,
      'fail'
    );
    assert.equal(
      (
        await checkOperatingSystem({
          osInfo: {
            product: 'ubuntu',
            cycle: '25.04',
            prettyName: 'Ubuntu 25.04',
            platform: 'linux',
            release: '6.8',
          },
          osCycles: ubuntuCycles,
          now,
        })
      ).status,
      'fail'
    );
  });
});
