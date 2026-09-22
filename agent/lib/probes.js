/**
 * Connector probes inferred from env keys.
 */

const {
  getServiceAccountAccessToken,
  refreshOAuth2AccessToken,
} = require('./googleAccessToken');

const DEFAULT_TIMEOUT_MS = 12000;

function isBlank(value) {
  return value == null || String(value).trim() === '';
}

function isPlaceholder(value) {
  if (isBlank(value)) return true;
  const v = String(value).trim().toLowerCase();
  return (
    v.startsWith('your_') ||
    v.includes('your_') ||
    v.includes('changeme') ||
    v === 'placeholder' ||
    v === 'token' ||
    v.endsWith('_here')
  );
}

function hasReal(env, key) {
  return !isPlaceholder(env[key]);
}

function check(id, name, status, message, detail) {
  const row = { id, name, status, message };
  if (detail) row.detail = detail;
  return row;
}

function truthy(env, key, defaultValue = false) {
  if (env[key] == null || String(env[key]).trim() === '') return defaultValue;
  return String(env[key]).trim().toLowerCase() === 'true';
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const timeout = timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function resolveMongoUri(env) {
  if (String(env.NODE_ENV || '').toLowerCase() === 'production' && hasReal(env, 'MONGODB_URI_PROD')) {
    return { uri: env.MONGODB_URI_PROD, dbName: env.MONGO_DB || undefined, source: 'MONGODB_URI_PROD' };
  }
  if (hasReal(env, 'MONGODB_URI')) {
    return { uri: env.MONGODB_URI, dbName: env.MONGO_DB || undefined, source: 'MONGODB_URI' };
  }
  if (hasReal(env, 'MONGO_URI')) {
    return { uri: env.MONGO_URI, dbName: env.MONGO_DB || undefined, source: 'MONGO_URI' };
  }
  // certificates-node and some older apps
  if (hasReal(env, 'MONGO_URL')) {
    return { uri: env.MONGO_URL, dbName: env.MONGO_DB || undefined, source: 'MONGO_URL' };
  }
  return null;
}

async function probeMongo(env, options = {}) {
  const resolved = resolveMongoUri(env);
  if (!resolved) return null;
  const { uri, dbName } = resolved;
  if (options.mongoPing) {
    try {
      await options.mongoPing({ uri, dbName });
      return check('mongodb', 'MongoDB', 'ok', 'ping ok');
    } catch (err) {
      return check('mongodb', 'MongoDB', 'fail', err.message || String(err), { error: true });
    }
  }
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: DEFAULT_TIMEOUT_MS });
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    await client.close();
    return check('mongodb', 'MongoDB', 'ok', dbName ? `ping ok (${dbName})` : 'ping ok');
  } catch (err) {
    return check('mongodb', 'MongoDB', 'fail', err.message || String(err), { error: true });
  }
}

async function probeHubspot(env, options = {}) {
  if (!hasReal(env, 'HUBSPOT_API_KEY')) return null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const key = env.HUBSPOT_API_KEY;
  try {
    const res = await fetchWithTimeout(
      fetchImpl,
      'https://api.hubapi.com/account-info/v3/details',
      { headers: { Authorization: `Bearer ${key}` } },
      options.timeoutMs
    );
    if (res.ok) {
      return check('hubspot', 'HubSpot', 'ok', 'API key accepted');
    }
    if (res.status === 401 || res.status === 403) {
      return check('hubspot', 'HubSpot', 'fail', `API key rejected (HTTP ${res.status})`);
    }
    return check('hubspot', 'HubSpot', 'warn', `HTTP ${res.status}`);
  } catch (err) {
    return check('hubspot', 'HubSpot', 'fail', err.message || String(err), { error: true });
  }
}

async function probeForecast(env, options = {}) {
  if (!hasReal(env, 'FORECAST_API_KEY')) return null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const key = env.FORECAST_API_KEY;
  try {
    const res = await fetchWithTimeout(
      fetchImpl,
      'https://api.forecast.it/api/v2/persons',
      { headers: { 'X-FORECAST-API-KEY': key, Accept: 'application/json' } },
      options.timeoutMs
    );
    if (res.ok) return check('forecast', 'Forecast', 'ok', 'API key accepted');
    if (res.status === 401 || res.status === 403) {
      return check('forecast', 'Forecast', 'fail', `API key rejected (HTTP ${res.status})`);
    }
    return check('forecast', 'Forecast', 'warn', `HTTP ${res.status}`);
  } catch (err) {
    return check('forecast', 'Forecast', 'fail', err.message || String(err), { error: true });
  }
}

async function probeMoodle(env, options = {}) {
  if (!hasReal(env, 'MOODLE_URI') || !hasReal(env, 'MOODLE_TOKEN')) {
    const any = hasReal(env, 'MOODLE_URI') || hasReal(env, 'MOODLE_TOKEN') || hasReal(env, 'MOODLE_ROOT');
    if (!any) return null;
    return check('moodle', 'Moodle', 'warn', 'incomplete configuration (need MOODLE_URI + MOODLE_TOKEN)');
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const base = String(env.MOODLE_URI).replace(/\?.*$/, '');
  const url = new URL(base);
  url.searchParams.set('wstoken', env.MOODLE_TOKEN);
  url.searchParams.set('wsfunction', 'core_course_get_courses');
  url.searchParams.set('moodlewsrestformat', 'json');
  try {
    const res = await fetchWithTimeout(fetchImpl, url.toString(), {}, options.timeoutMs);
    const text = typeof res.text === 'function' ? await res.text() : '';
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* ignore */
    }
    if (typeof text === 'string' && /invalidtoken/i.test(text)) {
      return check('moodle', 'Moodle', 'fail', 'token rejected (invalidtoken)');
    }
    if (body && body.exception) {
      const msg = body.message || body.errorcode || body.exception;
      const failAuth = /invalidtoken|accessexception|nopermission/i.test(String(msg));
      return check('moodle', 'Moodle', failAuth ? 'fail' : 'warn', String(msg));
    }
    if (res.ok && Array.isArray(body)) {
      return check('moodle', 'Moodle', 'ok', `token accepted (${body.length} courses)`);
    }
    if (res.ok) return check('moodle', 'Moodle', 'ok', 'token accepted');
    if (res.status === 401 || res.status === 403) {
      return check('moodle', 'Moodle', 'fail', `HTTP ${res.status}`);
    }
    return check('moodle', 'Moodle', 'warn', `HTTP ${res.status}`);
  } catch (err) {
    return check('moodle', 'Moodle', 'fail', err.message || String(err), { error: true });
  }
}

function resolveAi(env) {
  const provider = (env.AI_PROVIDER || '').trim().toLowerCase();
  const key =
    env.AI_API_KEY ||
    env.OPENAI_API_KEY ||
    env.ANTHROPIC_API_KEY ||
    env.GOOGLE_API_KEY ||
    env.GEMINI_API_KEY ||
    '';
  if (isPlaceholder(key)) return null;
  let p = provider;
  if (!p) {
    if (env.ANTHROPIC_API_KEY && !isPlaceholder(env.ANTHROPIC_API_KEY)) p = 'anthropic';
    else if (env.GOOGLE_API_KEY || env.GEMINI_API_KEY) p = 'google';
    else p = 'openai';
  }
  return { provider: p, key };
}

async function probeAi(env, options = {}) {
  const ai = resolveAi(env);
  if (!ai) return null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const id = `ai_${ai.provider}`.replace(/[^a-z0-9_]/gi, '_');
  const name = `AI (${ai.provider})`;
  try {
    let url;
    const headers = {};
    if (ai.provider === 'anthropic') {
      url = `${(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/models`;
      headers['x-api-key'] = ai.key;
      headers['anthropic-version'] = '2023-06-01';
    } else if (ai.provider === 'google' || ai.provider === 'gemini') {
      const base = (env.GOOGLE_AI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(
        /\/$/,
        ''
      );
      url = `${base}/v1beta/models?key=${encodeURIComponent(ai.key)}`;
    } else {
      const base = (env.AI_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
        /\/$/,
        ''
      );
      url = `${base}/models`;
      if (env.AZURE_OPENAI === 'true' || env.AI_OPENAI_USE_API_KEY_HEADER === 'true') {
        headers['api-key'] = ai.key;
      } else {
        headers.Authorization = `Bearer ${ai.key}`;
      }
    }
    const res = await fetchWithTimeout(fetchImpl, url, { headers }, options.timeoutMs);
    if (res.ok) return check(id, name, 'ok', 'API key accepted');
    if (res.status === 401 || res.status === 403) {
      return check(id, name, 'fail', `API key rejected (HTTP ${res.status})`);
    }
    return check(id, name, 'warn', `HTTP ${res.status}`);
  } catch (err) {
    return check(id, name, 'fail', err.message || String(err), { error: true });
  }
}

async function probeGmailInbox(env, options = {}) {
  const sa = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = env.GOOGLE_PRIVATE_KEY;
  const subject = env.INBOX_IMPERSONATE_USER || env.EMAIL_USER;
  if (!hasReal(env, 'GOOGLE_SERVICE_ACCOUNT_EMAIL') && !hasReal(env, 'GOOGLE_PRIVATE_KEY')) {
    return null;
  }
  // Only probe inbox when impersonation target looks configured (learning-orchestrator pattern)
  if (!hasReal(env, 'INBOX_IMPERSONATE_USER') && !hasReal(env, 'EMAIL_USER') && !hasReal(env, 'INBOX_GROUP_EMAIL')) {
    return null;
  }
  if (!hasReal(env, 'GOOGLE_SERVICE_ACCOUNT_EMAIL') || !hasReal(env, 'GOOGLE_PRIVATE_KEY') || isPlaceholder(subject)) {
    return check('gmail_inbox', 'Gmail inbox', 'warn', 'incomplete service-account / impersonation config');
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  try {
    const token =
      options.gmailAccessToken ||
      (await getServiceAccountAccessToken({
        clientEmail: sa,
        privateKey: key,
        scopes: ['https://mail.google.com/'],
        subject,
        fetchImpl,
        timeoutMs: options.timeoutMs,
      }));
    const res = await fetchWithTimeout(
      fetchImpl,
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers: { Authorization: `Bearer ${token}` } },
      options.timeoutMs
    );
    if (res.ok) return check('gmail_inbox', 'Gmail inbox', 'ok', `credentials accepted (${subject})`);
    if (res.status === 401 || res.status === 403) {
      return check('gmail_inbox', 'Gmail inbox', 'fail', `credentials rejected (HTTP ${res.status})`);
    }
    return check('gmail_inbox', 'Gmail inbox', 'warn', `HTTP ${res.status}`);
  } catch (err) {
    const status = err.status;
    if (status === 401 || status === 403) {
      return check('gmail_inbox', 'Gmail inbox', 'fail', err.message || `HTTP ${status}`);
    }
    return check('gmail_inbox', 'Gmail inbox', 'fail', err.message || String(err), { error: true });
  }
}

async function probeGoogleCalendar(env, options = {}) {
  if (!hasReal(env, 'GOOGLE_SERVICE_ACCOUNT_EMAIL') && !hasReal(env, 'GOOGLE_PRIVATE_KEY') && !hasReal(env, 'GOOGLE_CALENDAR_ID')) {
    return null;
  }
  if (!hasReal(env, 'GOOGLE_SERVICE_ACCOUNT_EMAIL') || !hasReal(env, 'GOOGLE_PRIVATE_KEY')) {
    if (hasReal(env, 'GOOGLE_CALENDAR_ID') || hasReal(env, 'GOOGLE_CALENDAR_IMPERSONATE_USER')) {
      return check('google_calendar', 'Google Calendar', 'warn', 'incomplete service-account config');
    }
    return null;
  }
  const calendarId = env.GOOGLE_CALENDAR_ID || 'primary';
  const subject = hasReal(env, 'GOOGLE_CALENDAR_IMPERSONATE_USER')
    ? env.GOOGLE_CALENDAR_IMPERSONATE_USER
    : null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  try {
    const token =
      options.calendarAccessToken ||
      (await getServiceAccountAccessToken({
        clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        privateKey: env.GOOGLE_PRIVATE_KEY,
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events',
        ],
        subject,
        fetchImpl,
        timeoutMs: options.timeoutMs,
      }));
    const res = await fetchWithTimeout(
      fetchImpl,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
      options.timeoutMs
    );
    if (res.ok) {
      return check('google_calendar', 'Google Calendar', 'ok', `credentials accepted (${calendarId})`);
    }
    if (res.status === 401 || res.status === 403) {
      return check('google_calendar', 'Google Calendar', 'fail', `credentials rejected (HTTP ${res.status})`);
    }
    if (res.status === 404) {
      return check('google_calendar', 'Google Calendar', 'fail', `calendar not found (${calendarId})`);
    }
    return check('google_calendar', 'Google Calendar', 'warn', `HTTP ${res.status}`);
  } catch (err) {
    const status = err.status;
    if (status === 401 || status === 403) {
      return check('google_calendar', 'Google Calendar', 'fail', err.message || `HTTP ${status}`);
    }
    return check('google_calendar', 'Google Calendar', 'fail', err.message || String(err), {
      error: true,
    });
  }
}

/**
 * Email send path: service account, OAuth2 refresh, or SMTP presence.
 */
async function probeEmail(env, options = {}) {
  const useSa = truthy(env, 'EMAIL_USE_SERVICE_ACCOUNT', false);
  const useOauth = !useSa && truthy(env, 'EMAIL_USE_OAUTH2', true);
  const hasSmtp = hasReal(env, 'SMTP_HOST');
  const hasEmailHints =
    hasReal(env, 'EMAIL_FROM') ||
    hasReal(env, 'EMAIL_USER') ||
    hasReal(env, 'GOOGLE_OAUTH_REFRESH_TOKEN') ||
    hasSmtp ||
    env.EMAIL_USE_OAUTH2 != null ||
    env.EMAIL_USE_SERVICE_ACCOUNT != null;

  if (!hasEmailHints && !useSa) return null;

  if (useSa) {
    // Same SA as inbox — covered by gmail_inbox when configured; still report email mode.
    if (!hasReal(env, 'GOOGLE_SERVICE_ACCOUNT_EMAIL') || !hasReal(env, 'GOOGLE_PRIVATE_KEY') || !hasReal(env, 'EMAIL_USER')) {
      return check('email', 'Email send', 'warn', 'service-account mode incomplete');
    }
    // If inbox probe already validated SA, still confirm email subject is set.
    return check('email', 'Email send', 'ok', `service-account mode (${env.EMAIL_USER})`, {
      mode: 'service_account',
    });
  }

  if (useOauth) {
    const need = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN', 'EMAIL_USER'];
    const missing = need.filter((k) => !hasReal(env, k));
    if (missing.length === need.length && !hasEmailHints) return null;
    if (missing.length) {
      return check('email', 'Email send', 'warn', `OAuth2 incomplete (missing ${missing.join(', ')})`, {
        mode: 'oauth2',
      });
    }
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    try {
      const token =
        options.emailAccessToken ||
        (await refreshOAuth2AccessToken({
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN,
          fetchImpl,
          timeoutMs: options.timeoutMs,
        }));
      const res = await fetchWithTimeout(
        fetchImpl,
        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        { headers: { Authorization: `Bearer ${token}` } },
        options.timeoutMs
      );
      if (res.ok) {
        return check('email', 'Email send', 'ok', `OAuth2 credentials accepted (${env.EMAIL_USER})`, {
          mode: 'oauth2',
        });
      }
      if (res.status === 401 || res.status === 403) {
        return check('email', 'Email send', 'fail', `OAuth2 rejected (HTTP ${res.status})`, {
          mode: 'oauth2',
        });
      }
      return check('email', 'Email send', 'warn', `OAuth2 HTTP ${res.status}`, { mode: 'oauth2' });
    } catch (err) {
      return check('email', 'Email send', 'fail', err.message || String(err), {
        mode: 'oauth2',
        error: true,
      });
    }
  }

  if (hasSmtp) {
    const authOk = hasReal(env, 'SMTP_USER') && hasReal(env, 'SMTP_PASS');
    return check(
      'email',
      'Email send',
      authOk ? 'ok' : 'warn',
      authOk ? `SMTP configured (${env.SMTP_HOST})` : 'SMTP host set but credentials incomplete',
      { mode: 'smtp', host: env.SMTP_HOST }
    );
  }

  return check('email', 'Email send', 'warn', 'no email send method configured');
}

function presenceChecks(env) {
  const out = [];
  const pairs = [
    ['google_oauth', 'Google OAuth', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']],
    ['django_oauth', 'Django OAuth', ['DJANGO_CLIENT_ID', 'DJANGO_CLIENT_SECRET']],
    ['session', 'Session', ['SESSION_SECRET']],
    ['webhook_api_key', 'Webhook API key', ['WEBHOOK_API_KEY']],
  ];
  for (const [id, name, keys] of pairs) {
    const present = keys.every((k) => hasReal(env, k));
    const anyKey = keys.some((k) => env[k] != null && String(env[k]).trim() !== '');
    if (!anyKey) continue;
    out.push(
      check(
        id,
        name,
        present ? 'ok' : 'warn',
        present ? 'configured' : 'incomplete configuration'
      )
    );
  }
  return out;
}

/**
 * Run all inferred probes for an app env map.
 */
async function runConnectorProbes(env, options = {}) {
  const e = env || {};
  const checks = [];
  const runners = [
    probeMongo,
    probeHubspot,
    probeForecast,
    probeMoodle,
    probeAi,
    probeGmailInbox,
    probeGoogleCalendar,
    probeEmail,
  ];
  for (const fn of runners) {
    const result = await fn(e, options);
    if (result) checks.push(result);
  }
  checks.push(...presenceChecks(e));
  return checks;
}

module.exports = {
  isBlank,
  isPlaceholder,
  hasReal,
  resolveMongoUri,
  probeMongo,
  probeHubspot,
  probeForecast,
  probeMoodle,
  probeAi,
  probeGmailInbox,
  probeGoogleCalendar,
  probeEmail,
  presenceChecks,
  runConnectorProbes,
  resolveAi,
};
