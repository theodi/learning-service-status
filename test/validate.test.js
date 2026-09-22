const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateReport,
  buildDashboardRows,
  parseExpectedServices,
  worstStatus,
} = require('../lib/validateReport');
const { groupRowsByHost } = require('../lib/dashboard');

describe('validateReport', () => {
  it('accepts a minimal valid report', () => {
    const out = validateReport({
      service: 'care.theodi.org',
      host: 'learndata-1',
      checks: [{ id: 'mongo', name: 'MongoDB', status: 'ok', message: 'connected' }],
    });
    assert.equal(out.ok, true);
    assert.equal(out.report.service, 'care.theodi.org');
    assert.equal(out.report.host, 'learndata-1');
    assert.equal(out.report.checks.length, 1);
  });

  it('rejects missing service', () => {
    const out = validateReport({ host: 'h', checks: [] });
    assert.equal(out.ok, false);
  });

  it('rejects missing host', () => {
    const out = validateReport({
      service: 'x',
      checks: [{ id: 'a', name: 'A', status: 'ok', message: 'y' }],
    });
    assert.equal(out.ok, false);
    assert.match(out.error, /host/);
  });

  it('rejects bad status', () => {
    const out = validateReport({
      service: 'x',
      host: 'h',
      checks: [{ id: 'a', name: 'A', status: 'pass', message: 'no' }],
    });
    assert.equal(out.ok, false);
  });

  it('accepts runtime versions', () => {
    const out = validateReport({
      service: 'example',
      host: 'h',
      runtime: {
        node: 'v22.11.0',
        os: { id: 'ubuntu', versionId: '24.04', prettyName: 'Ubuntu 24.04 LTS' },
      },
      checks: [],
    });
    assert.equal(out.ok, true);
    assert.equal(out.report.runtime.node, 'v22.11.0');
    assert.equal(out.report.runtime.os.id, 'ubuntu');
  });

  it('rejects bad runtime.os', () => {
    const out = validateReport({
      service: 'x',
      host: 'h',
      runtime: { os: 'ubuntu' },
      checks: [],
    });
    assert.equal(out.ok, false);
  });

  it('accepts dependencies as objects', () => {
    const out = validateReport({
      service: 'example',
      host: 'h',
      dependencies: {
        packageJson: { name: 'example', version: '1.0.0' },
        packageLock: { lockfileVersion: 3, packages: {} },
      },
      checks: [],
    });
    assert.equal(out.ok, true);
    assert.equal(out.report.dependencies.packageLock.lockfileVersion, 3);
  });

  it('accepts dependencies as JSON strings', () => {
    const out = validateReport({
      service: 'example',
      host: 'h',
      dependencies: {
        packageJson: JSON.stringify({ name: 'example' }),
        packageLock: JSON.stringify({ lockfileVersion: 3 }),
      },
      checks: [],
    });
    assert.equal(out.ok, true);
    assert.equal(out.report.dependencies.packageJson.name, 'example');
  });

  it('rejects bad dependencies shape', () => {
    const out = validateReport({
      service: 'x',
      host: 'h',
      dependencies: 'nope',
      checks: [],
    });
    assert.equal(out.ok, false);
  });
});

describe('buildDashboardRows', () => {
  it('shows expected services with no report as stale warn', () => {
    const rows = buildDashboardRows({
      storeEntries: {},
      expectedServices: ['care.theodi.org'],
      staleAfterMs: 7200000,
      now: new Date('2026-09-21T12:00:00.000Z'),
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].stale, true);
    assert.equal(rows[0].overall, 'warn');
    assert.match(rows[0].checks[0].message, /no report received/);
  });

  it('marks old reports stale', () => {
    const rows = buildDashboardRows({
      storeEntries: {
        'care.theodi.org': {
          receivedAt: '2026-09-21T09:00:00.000Z',
          report: {
            service: 'care.theodi.org',
            host: 'learndata-1',
            checks: [{ id: 'mongo', name: 'MongoDB', status: 'ok', message: 'ok' }],
          },
        },
      },
      expectedServices: ['care.theodi.org'],
      staleAfterMs: 7200000,
      now: new Date('2026-09-21T12:00:00.000Z'),
    });
    assert.equal(rows[0].stale, true);
    assert.equal(rows[0].host, 'learndata-1');
    assert.equal(rows[0].overall, 'warn');
  });

  it('keeps fresh reports ok', () => {
    const rows = buildDashboardRows({
      storeEntries: {
        'care.theodi.org': {
          receivedAt: '2026-09-21T11:55:00.000Z',
          report: {
            service: 'care.theodi.org',
            host: 'learndata-1',
            version: '3.0.0',
            checks: [{ id: 'mongo', name: 'MongoDB', status: 'ok', message: 'ok' }],
          },
        },
      },
      expectedServices: ['care.theodi.org'],
      staleAfterMs: 7200000,
      now: new Date('2026-09-21T12:00:00.000Z'),
    });
    assert.equal(rows[0].stale, false);
    assert.equal(rows[0].overall, 'ok');
    assert.equal(rows[0].version, '3.0.0');
    assert.equal(rows[0].host, 'learndata-1');
  });
});

describe('groupRowsByHost', () => {
  it('nests apps under host', () => {
    const groups = groupRowsByHost([
      {
        service: 'host:learndata-1',
        host: 'learndata-1',
        overall: 'ok',
        stale: false,
        checks: [],
      },
      {
        service: 'care.theodi.org',
        host: 'learndata-1',
        overall: 'warn',
        stale: false,
        checks: [],
      },
      {
        service: 'other.app',
        host: 'learndata-2',
        overall: 'ok',
        stale: false,
        checks: [],
      },
    ]);
    assert.equal(groups.length, 2);
    const g1 = groups.find((g) => g.host === 'learndata-1');
    assert.ok(g1.hostRow);
    assert.equal(g1.apps.length, 1);
    assert.equal(g1.apps[0].service, 'care.theodi.org');
    assert.equal(g1.overall, 'warn');
  });
});

describe('helpers', () => {
  it('parses expected services', () => {
    assert.deepEqual(parseExpectedServices(' a, b ,c '), ['a', 'b', 'c']);
  });

  it('worstStatus prefers fail', () => {
    assert.equal(worstStatus(['ok', 'warn', 'fail']), 'fail');
    assert.equal(worstStatus(['ok', 'warn']), 'warn');
    assert.equal(worstStatus(['ok']), 'ok');
  });
});
