const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { enrichReportWithRuntime, runtimeOsToOsInfo } = require('../lib/enrichRuntime');
const { enrichReportWithNpmAudit, npmAuditToCheck } = require('../lib/enrichNpmAudit');
const { clearEolCache } = require('../lib/runtimeSupportChecks');
const { createStore } = require('../lib/store');
const { validateReport } = require('../lib/validateReport');

describe('enrichReportWithRuntime', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');
  const nodeCycles = [
    { cycle: '22', lts: '2024-10-29', eol: '2027-04-30', latest: '22.23.2' },
    { cycle: '25', lts: false, eol: '2026-06-01', latest: '25.9.0' },
  ];
  const osCycles = [
    { cycle: '24.04', lts: true, eol: '2029-04-25' },
    { cycle: '25.04', lts: false, eol: '2026-01-01' },
  ];

  it('maps runtime.os to osInfo', () => {
    const info = runtimeOsToOsInfo({
      id: 'ubuntu',
      versionId: '24.04',
      prettyName: 'Ubuntu 24.04 LTS',
    });
    assert.equal(info.product, 'ubuntu');
    assert.equal(info.cycle, '24.04');
  });

  it('injects node_runtime and npm_runtime for apps (no OS)', async () => {
    const enriched = await enrichReportWithRuntime(
      {
        service: 'demo',
        host: 'h',
        runtime: {
          node: 'v22.23.2',
          npm: '10.9.0',
          os: { id: 'ubuntu', versionId: '24.04', prettyName: 'Ubuntu 24.04 LTS' },
        },
        checks: [
          { id: 'npm_audit', name: 'npm audit', status: 'ok', message: '0 vulnerabilities' },
          { id: 'up', name: 'Up', status: 'ok', message: 'yes' },
        ],
      },
      { now, nodeCycles, osCycles, npmLatestMajor: 10 }
    );
    assert.equal(enriched.checks[0].id, 'node_runtime');
    assert.equal(enriched.checks[0].status, 'ok');
    assert.equal(enriched.checks[1].id, 'npm_runtime');
    assert.equal(enriched.checks[1].status, 'ok');
    assert.ok(!enriched.checks.some((c) => c.id === 'operating_system'));
    assert.ok(enriched.checks.some((c) => c.id === 'up'));
  });

  it('injects only operating_system for host reports', async () => {
    const enriched = await enrichReportWithRuntime(
      {
        service: 'host:learndata-1',
        host: 'learndata-1',
        runtime: {
          os: { id: 'ubuntu', versionId: '24.04', prettyName: 'Ubuntu 24.04 LTS' },
        },
        checks: [{ id: 'apt', name: 'apt upgrades', status: 'ok', message: '0 pending' }],
      },
      { now, osCycles }
    );
    assert.ok(enriched.checks.some((c) => c.id === 'operating_system' && c.status === 'ok'));
    assert.ok(!enriched.checks.some((c) => c.id === 'node_runtime'));
    assert.ok(!enriched.checks.some((c) => c.id === 'npm_runtime'));
    assert.ok(enriched.checks.some((c) => c.id === 'apt'));
  });

  it('replaces legacy runtime checks when runtime is present', async () => {
    const enriched = await enrichReportWithRuntime(
      {
        service: 'demo',
        host: 'h',
        runtime: { node: 'v25.0.0', npm: '9.0.0' },
        checks: [
          { id: 'node_runtime', name: 'Node.js', status: 'ok', message: 'stale client claim' },
          { id: 'npm_audit', name: 'npm audit', status: 'ok', message: '0 vulnerabilities' },
          { id: 'up', name: 'Up', status: 'ok', message: 'yes' },
        ],
      },
      { now, nodeCycles, npmLatestMajor: 10 }
    );
    const node = enriched.checks.find((c) => c.id === 'node_runtime');
    assert.equal(node.status, 'fail');
    assert.ok(!node.message.includes('stale client claim'));
    assert.ok(enriched.checks.some((c) => c.id === 'up'));
    assert.ok(enriched.checks.some((c) => c.id === 'npm_runtime' && c.status === 'warn'));
    assert.ok(!enriched.checks.some((c) => c.id === 'operating_system'));
  });

  it('keeps legacy runtime checks when runtime omitted', async () => {
    const enriched = await enrichReportWithRuntime({
      service: 'demo',
      host: 'h',
      checks: [
        { id: 'node_runtime', name: 'Node.js', status: 'warn', message: 'legacy' },
        { id: 'npm_runtime', name: 'npm', status: 'warn', message: 'legacy npm' },
        { id: 'npm_audit', name: 'npm audit', status: 'ok', message: '0 vulnerabilities' },
        { id: 'up', name: 'Up', status: 'ok', message: 'yes' },
      ],
    });
    assert.equal(enriched.checks[0].id, 'node_runtime');
    assert.equal(enriched.checks[0].status, 'warn');
    assert.ok(enriched.checks.some((c) => c.id === 'npm_runtime'));
  });

  it('warns when runtime is missing on apps (no OS placeholder)', async () => {
    const enriched = await enrichReportWithRuntime({
      service: 'demo',
      host: 'h',
      checks: [{ id: 'up', name: 'Up', status: 'ok', message: 'yes' }],
    });
    assert.ok(
      enriched.checks.some(
        (c) => c.id === 'node_runtime' && c.status === 'warn' && /required/.test(c.message)
      )
    );
    assert.ok(
      enriched.checks.some(
        (c) => c.id === 'npm_runtime' && c.status === 'warn' && /required/.test(c.message)
      )
    );
    assert.ok(!enriched.checks.some((c) => c.id === 'operating_system'));
    assert.ok(!enriched.checks.some((c) => c.id === 'npm_audit'));
  });

  it('strips incoming operating_system from app reports', async () => {
    const enriched = await enrichReportWithRuntime(
      {
        service: 'demo',
        host: 'h',
        runtime: { node: 'v22.23.2', npm: '10.9.0' },
        checks: [
          {
            id: 'operating_system',
            name: 'Operating system',
            status: 'warn',
            message: 'runtime.os not reported (required for Node services)',
          },
          { id: 'up', name: 'Up', status: 'ok', message: 'yes' },
        ],
      },
      {
        now: new Date('2026-09-21T12:00:00.000Z'),
        nodeCycles: [
          { cycle: '22', lts: '2024-10-29', eol: '2027-04-30', latest: '22.23.2' },
        ],
        npmLatestMajor: 10,
      }
    );
    assert.ok(!enriched.checks.some((c) => c.id === 'operating_system'));
    assert.ok(enriched.checks.some((c) => c.id === 'node_runtime'));
    assert.ok(enriched.checks.some((c) => c.id === 'up'));
  });
});

describe('enrichReportWithNpmAudit', () => {
  it('scores audit JSON via npmAuditToCheck', () => {
    const fail = npmAuditToCheck({
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 },
      },
    });
    assert.equal(fail.status, 'fail');
    const ok = npmAuditToCheck({
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
      },
    });
    assert.equal(ok.status, 'ok');
  });

  it('preserves agent npm_audit check', async () => {
    const enriched = await enrichReportWithNpmAudit({
      service: 'demo',
      checks: [
        { id: 'up', name: 'Up', status: 'ok', message: 'yes' },
        {
          id: 'npm_audit',
          name: 'npm audit',
          status: 'ok',
          message: '0 vulnerabilities',
          detail: { source: 'agent', engine: 'npm', total: 0 },
        },
      ],
    });
    const audit = enriched.checks.find((c) => c.id === 'npm_audit');
    assert.ok(audit);
    assert.equal(audit.status, 'ok');
    assert.equal(audit.detail.source, 'agent');
    assert.ok(enriched.checks.some((c) => c.id === 'up'));
  });

  it('does not run collector audit from dependencies', async () => {
    const enriched = await enrichReportWithNpmAudit({
      service: 'demo',
      dependencies: {
        packageJson: { name: 'demo', version: '1.0.0' },
        packageLock: { lockfileVersion: 3, packages: { '': {} } },
      },
      checks: [{ id: 'up', name: 'Up', status: 'ok', message: 'yes' }],
    });
    const audit = enriched.checks.find((c) => c.id === 'npm_audit');
    assert.equal(audit.status, 'warn');
    assert.match(audit.message, /host agent should run npm audit/);
    assert.ok(!audit.detail?.engine);
  });

  it('skips npm_audit entirely for host reports', async () => {
    const enriched = await enrichReportWithNpmAudit({
      service: 'host:x',
      host: 'x',
      checks: [{ id: 'apt', name: 'apt', status: 'ok', message: 'ok' }],
    });
    assert.ok(!enriched.checks.some((c) => c.id === 'npm_audit'));
    assert.ok(enriched.checks.some((c) => c.id === 'apt'));
  });

  it('warns when npm_audit missing', async () => {
    const enriched = await enrichReportWithNpmAudit({
      service: 'demo',
      checks: [{ id: 'up', name: 'Up', status: 'ok', message: 'yes' }],
    });
    assert.ok(
      enriched.checks.some(
        (c) => c.id === 'npm_audit' && c.status === 'warn' && /npm_audit not reported/.test(c.message)
      )
    );
  });

  it('preserves legacy client npm_audit', async () => {
    const enriched = await enrichReportWithNpmAudit({
      service: 'demo',
      checks: [
        {
          id: 'npm_audit',
          name: 'npm audit',
          status: 'fail',
          message: '1 high',
          detail: { high: 1 },
        },
      ],
    });
    const audit = enriched.checks.find((c) => c.id === 'npm_audit');
    assert.equal(audit.status, 'fail');
    assert.equal(audit.message, '1 high');
  });
});

describe('public docs and client routes', () => {
  let server;
  let baseUrl;
  let prevKey;
  let storePath;

  before(async () => {
    prevKey = process.env.STATUS_INGEST_KEY;
    process.env.STATUS_INGEST_KEY = 'test-ingest-key';
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session';
    storePath = path.join(os.tmpdir(), `ss-reports-${process.pid}.json`);
    process.env.REPORTS_STORE_PATH = storePath;

    // Load app after env is set — index.js starts listening; we need a test harness.
    // Use a minimal express mount of the same public routes instead of requiring index.js
    // (index listens on PORT). Spin a tiny server for docs + enrich ingest logic.
    const express = require('express');
    const expressLayouts = require('express-ejs-layouts');
    const { renderSimpleMarkdown } = require('../lib/simpleMarkdown');
    const { streamClientNodeZip } = require('../lib/clientZip');
    const { enrichReportWithRuntime } = require('../lib/enrichRuntime');
    const { enrichReportWithNpmAudit } = require('../lib/enrichNpmAudit');
    const { extractIngestKey } = require('../lib/validateReport');

    const root = path.join(__dirname, '..');
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(root, 'views'));
    app.use(expressLayouts);
    app.set('layout', 'layout');
    app.use(express.json({ limit: '1mb' }));
    app.use((req, res, next) => {
      res.locals.user = null;
      res.locals.formatAge = () => '';
      next();
    });
    app.use('/client/node', express.static(path.join(root, 'client', 'node')));

    const store = createStore(storePath);

    app.get('/docs', (req, res) => {
      res.locals.page = { title: 'Docs' };
      res.render('pages/docs');
    });
    app.get('/docs/spec', (req, res) => {
      const md = fs.readFileSync(path.join(root, 'SPEC.md'), 'utf8');
      res.locals.page = { title: 'SPEC' };
      res.render('pages/docs-spec', { specHtml: renderSimpleMarkdown(md) });
    });
    app.get('/docs/agent', (req, res) => {
      res.locals.page = { title: 'Agent' };
      res.render('pages/docs-agent');
    });
    app.get('/client/odi-status-node.zip', (req, res) => {
      streamClientNodeZip(res, path.join(root, 'client', 'node'));
    });
    app.post('/reports', async (req, res) => {
      const key = extractIngestKey(req);
      if (key !== 'test-ingest-key') return res.status(401).json({ error: 'Unauthorized' });
      const validated = validateReport(req.body);
      if (!validated.ok) return res.status(400).json({ error: validated.error });
      let report = await enrichReportWithRuntime(validated.report, {
        now: new Date('2026-09-21T12:00:00.000Z'),
        nodeCycles: [
          { cycle: '22', lts: '2024-10-29', eol: '2027-04-30', latest: '22.23.2' },
        ],
        osCycles: [{ cycle: '24.04', lts: true, eol: '2029-04-25' }],
        npmLatestMajor: 10,
      });
      report = await enrichReportWithNpmAudit(report);
      const receivedAt = new Date().toISOString();
      store.upsert(report.service, report, receivedAt);
      res.json({ ok: true, service: report.service, receivedAt, checks: report.checks });
    });

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(() => {
    if (server) server.close();
    if (prevKey === undefined) delete process.env.STATUS_INGEST_KEY;
    else process.env.STATUS_INGEST_KEY = prevKey;
    try {
      fs.unlinkSync(storePath);
    } catch {
      /* ignore */
    }
    clearEolCache();
  });

  function get(pathname) {
    return new Promise((resolve, reject) => {
      http
        .get(`${baseUrl}${pathname}`, (res) => {
          let body = '';
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
        })
        .on('error', reject);
    });
  }

  function postJson(pathname, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(
        `${baseUrl}${pathname}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            ...headers,
          },
        },
        (res) => {
          let text = '';
          res.on('data', (c) => {
            text += c;
          });
          res.on('end', () => {
            let json = null;
            try {
              json = JSON.parse(text);
            } catch {
              /* ignore */
            }
            resolve({ status: res.statusCode, body: text, json });
          });
        }
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  it('GET /docs is public 200', async () => {
    const res = await get('/docs');
    assert.equal(res.status, 200);
    assert.match(res.body, /Integrate service status/);
  });

  it('GET /docs/agent is public 200', async () => {
    const res = await get('/docs/agent');
    assert.equal(res.status, 200);
    assert.match(res.body, /Agent playbook/);
  });

  it('GET /docs/spec is public 200', async () => {
    const res = await get('/docs/spec');
    assert.equal(res.status, 200);
    assert.match(res.body, /Service status push convention/);
  });

  it('GET /client/node/INTEGRATE.md is public 200', async () => {
    const res = await get('/client/node/INTEGRATE.md');
    assert.equal(res.status, 200);
    assert.match(res.body, /Integrate service-status/);
  });

  it('GET /client/odi-status-node.zip returns zip', async () => {
    const res = await get('/client/odi-status-node.zip');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'] || '', /zip/);
    assert.ok(res.body.length > 100);
  });

  it('POST /reports preserves agent npm_audit and enriches runtime', async () => {
    const res = await postJson(
      '/reports',
      {
        service: 'enrich-demo',
        host: 'test-host',
        runtime: {
          node: 'v22.23.2',
          npm: '10.9.0',
        },
        checks: [
          { id: 'up', name: 'Up', status: 'ok', message: 'yes' },
          {
            id: 'npm_audit',
            name: 'npm audit',
            status: 'ok',
            message: '0 vulnerabilities',
            detail: { source: 'agent', engine: 'npm', total: 0 },
          },
        ],
      },
      { Authorization: 'Bearer test-ingest-key' }
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    const ids = res.json.checks.map((c) => c.id);
    assert.ok(ids.includes('node_runtime'));
    assert.ok(ids.includes('npm_runtime'));
    assert.ok(!ids.includes('operating_system'));
    assert.ok(ids.includes('up'));
    assert.ok(ids.includes('npm_audit'));
    assert.equal(res.json.checks.find((c) => c.id === 'node_runtime').status, 'ok');
    assert.equal(res.json.checks.find((c) => c.id === 'npm_runtime').status, 'ok');
    assert.equal(res.json.checks.find((c) => c.id === 'npm_audit').detail.source, 'agent');
  });
});
