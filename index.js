const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const { createStore } = require('./lib/store');
const {
  validateReport,
  parseExpectedServices,
  buildDashboardRows,
  extractIngestKey,
} = require('./lib/validateReport');
const {
  sortDashboardRows,
  summarizeFleet,
  formatAge,
  withSelfExpected,
} = require('./lib/dashboard');
const { requireAuthHtml, requireAuthJson, isOdiStaffEmail } = require('./lib/odiStaff');
const { configurePassport, isGoogleConfigured } = require('./lib/passport');
const { startSelfReporter } = require('./lib/selfReport');
const { enrichReportWithRuntime } = require('./lib/enrichRuntime');
const { renderSimpleMarkdown } = require('./lib/simpleMarkdown');
const { streamClientNodeZip } = require('./lib/clientZip');

const root = __dirname;
const configEnvPath = path.join(root, 'config.env');

function loadEnvFile(fp) {
  if (!fs.existsSync(fp)) return;
  const text = fs.readFileSync(fp, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

loadEnvFile(configEnvPath);

const PORT = parseInt(process.env.PORT || '3090', 10);
const INGEST_KEY = process.env.STATUS_INGEST_KEY || '';
const STALE_AFTER_MS = parseInt(process.env.STALE_AFTER_MS || '900000', 10);
const SELF_INTERVAL_MS = parseInt(process.env.SELF_REPORT_INTERVAL_MS || '300000', 10);
const EXPECTED_SERVICES = withSelfExpected(
  parseExpectedServices(process.env.EXPECTED_SERVICES || '')
);
const STORE_PATH =
  process.env.REPORTS_STORE_PATH || path.join(root, 'data', 'reports.json');
const isProduction = process.env.NODE_ENV === 'production';

const store = createStore(STORE_PATH);
const passport = configurePassport();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(root, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(root, 'public')));
app.use('/client/node', express.static(path.join(root, 'client', 'node')));

if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET is not set — using insecure dev default.');
}

app.use(
  session({
    resave: false,
    saveUninitialized: false,
    secret: process.env.SESSION_SECRET || 'dev-insecure-session-secret',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 12,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.formatAge = formatAge;
  next();
});

function getDashboardPayload() {
  const rows = sortDashboardRows(
    buildDashboardRows({
      storeEntries: store.getAll(),
      expectedServices: EXPECTED_SERVICES,
      staleAfterMs: Number.isFinite(STALE_AFTER_MS) ? STALE_AFTER_MS : 900000,
      now: new Date(),
    })
  );
  const summary = summarizeFleet(rows);
  return { services: rows, summary };
}

app.get('/login', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated() && isOdiStaffEmail(req.user && req.user.email)) {
    return res.redirect('/');
  }
  res.locals.page = { title: 'Sign in — Service status' };
  res.render('pages/login');
});

app.get('/auth/google', (req, res, next) => {
  if (!isGoogleConfigured()) {
    const err = new Error('Google OAuth is not configured (GOOGLE_CLIENT_ID / SECRET / CALLBACK_URL).');
    err.status = 500;
    return next(err);
  }
  return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    if (!isOdiStaffEmail(req.user && req.user.email)) {
      req.logout(() => {
        res.status(403);
        res.locals.page = { title: 'Forbidden' };
        res.locals.statusCode = 403;
        res.locals.errorMessage =
          'Forbidden: service status is limited to @theodi.org accounts.';
        res.render('errors/error');
      });
      return;
    }
    res.redirect('/');
  }
);

app.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.redirect('/login');
    });
  });
});

function publicBaseUrl(req) {
  const fromEnv = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return `${req.protocol}://${req.get('host')}`;
}

app.get('/', requireAuthHtml, (req, res) => {
  const { services, summary } = getDashboardPayload();
  res.locals.page = { title: 'Service status' };
  res.locals.navActive = 'status';
  res.locals.metaRefresh = 0; // JS refresh instead
  res.render('pages/dashboard', { services, summary });
});

app.get('/configure', requireAuthHtml, (req, res) => {
  const base = publicBaseUrl(req);
  res.locals.page = { title: 'Configure — Service status' };
  res.locals.navActive = 'configure';
  res.render('pages/configure', {
    clientConfig: {
      reportUrl: `${base}/reports`,
      ingestKey: INGEST_KEY,
    },
  });
});

app.get('/docs', (req, res) => {
  res.locals.page = { title: 'Integrate — Service status' };
  res.locals.navActive = 'docs';
  res.render('pages/docs');
});

app.get('/docs/spec', (req, res) => {
  const specPath = path.join(root, 'SPEC.md');
  const md = fs.readFileSync(specPath, 'utf8');
  res.locals.page = { title: 'SPEC — Service status' };
  res.locals.navActive = 'docs';
  res.render('pages/docs-spec', { specHtml: renderSimpleMarkdown(md) });
});

app.get('/docs/agent', (req, res) => {
  res.locals.page = { title: 'Agent playbook — Service status' };
  res.locals.navActive = 'docs';
  res.render('pages/docs-agent');
});

app.get('/client/odi-status-node.zip', (req, res) => {
  streamClientNodeZip(res, path.join(root, 'client', 'node'));
});

app.get('/reports', requireAuthJson, (req, res) => {
  const { services, summary } = getDashboardPayload();
  res.json({ services, summary });
});

app.post('/reports', async (req, res) => {
  if (!INGEST_KEY) {
    return res.status(500).json({ error: 'STATUS_INGEST_KEY is not configured on the collector' });
  }
  const provided = extractIngestKey(req);
  if (!provided || provided !== INGEST_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const validated = validateReport(req.body);
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  let report;
  try {
    report = await enrichReportWithRuntime(validated.report);
  } catch (err) {
    console.warn('[ingest] runtime enrichment failed:', err.message || err);
    report = validated.report;
  }

  const receivedAt = new Date().toISOString();
  if (!report.reportedAt) {
    report.reportedAt = receivedAt;
  }
  store.upsert(report.service, report, receivedAt);
  return res.status(200).json({ ok: true, service: report.service, receivedAt });
});

app.use((req, res) => {
  const accept = req.get('Accept') || '';
  if (accept.includes('application/json')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404);
  res.locals.page = { title: 'Not found' };
  res.locals.statusCode = 404;
  res.locals.errorMessage = 'Not found';
  return res.render('errors/error');
});

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  console.error('[error]', err.message);
  const accept = req.get('Accept') || '';
  if (accept.includes('application/json')) {
    return res.status(status).json({ error: err.message || 'Error' });
  }
  res.status(status);
  res.locals.page = { title: 'Error' };
  res.locals.statusCode = status;
  res.locals.errorMessage = err.message || 'Internal Server Error';
  return res.render('errors/error');
});

if (!INGEST_KEY) {
  console.warn('WARNING: STATUS_INGEST_KEY is not set — POST /reports will return 500 until configured.');
}

startSelfReporter(store, {
  storePath: STORE_PATH,
  expectedServices: EXPECTED_SERVICES,
  staleAfterMs: Number.isFinite(STALE_AFTER_MS) ? STALE_AFTER_MS : 900000,
  ingestKey: INGEST_KEY,
  intervalMs: Number.isFinite(SELF_INTERVAL_MS) && SELF_INTERVAL_MS >= 30000 ? SELF_INTERVAL_MS : 300000,
});

app.listen(PORT, () => {
  console.log(`service-status listening on http://localhost:${PORT}`);
  console.log(`  expected: ${EXPECTED_SERVICES.join(', ')}`);
  console.log(`  stale after: ${STALE_AFTER_MS}ms`);
  console.log(`  store: ${STORE_PATH}`);
});

module.exports = { app, store };
