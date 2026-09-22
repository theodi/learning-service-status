/**
 * Mint Google access tokens for service-account (JWT) or OAuth2 refresh.
 * Uses Node crypto only — no googleapis dependency.
 */

const crypto = require('crypto');

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function normalizePrivateKey(pem) {
  if (!pem) return '';
  return String(pem).replace(/\\n/g, '\n').trim();
}

/**
 * Build a signed service-account JWT assertion.
 * @param {{ clientEmail: string, privateKey: string, scopes: string[], subject?: string|null, lifetimeSec?: number }} opts
 */
function buildServiceAccountAssertion(opts) {
  const now = Math.floor(Date.now() / 1000);
  const lifetime = opts.lifetimeSec || 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: opts.clientEmail,
    scope: Array.isArray(opts.scopes) ? opts.scopes.join(' ') : String(opts.scopes || ''),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + lifetime,
  };
  if (opts.subject) payload.sub = opts.subject;

  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = normalizePrivateKey(opts.privateKey);
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const sig = signer.sign(key);
  return `${unsigned}.${b64url(sig)}`;
}

async function postForm(fetchImpl, url, fields, timeoutMs) {
  const body = new URLSearchParams(fields).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* ignore */
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exchange service-account JWT for an access token.
 */
async function getServiceAccountAccessToken(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const assertion = buildServiceAccountAssertion({
    clientEmail: opts.clientEmail,
    privateKey: opts.privateKey,
    scopes: opts.scopes,
    subject: opts.subject || null,
  });
  const res = await postForm(
    fetchImpl,
    'https://oauth2.googleapis.com/token',
    {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    },
    opts.timeoutMs
  );
  if (!res.ok || !res.json || !res.json.access_token) {
    const err = new Error(
      (res.json && (res.json.error_description || res.json.error)) ||
        `token HTTP ${res.status}`
    );
    err.status = res.status;
    err.body = res.json || res.text;
    throw err;
  }
  return res.json.access_token;
}

/**
 * Refresh a Google OAuth2 access token.
 */
async function refreshOAuth2AccessToken(opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const res = await postForm(
    fetchImpl,
    'https://oauth2.googleapis.com/token',
    {
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
      grant_type: 'refresh_token',
    },
    opts.timeoutMs
  );
  if (!res.ok || !res.json || !res.json.access_token) {
    const err = new Error(
      (res.json && (res.json.error_description || res.json.error)) ||
        `token HTTP ${res.status}`
    );
    err.status = res.status;
    err.body = res.json || res.text;
    throw err;
  }
  return res.json.access_token;
}

module.exports = {
  normalizePrivateKey,
  buildServiceAccountAssertion,
  getServiceAccountAccessToken,
  refreshOAuth2AccessToken,
};
