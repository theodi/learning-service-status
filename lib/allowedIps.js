/**
 * Ingest IP allowlist helpers. Localhost is always allowed.
 */

const net = require('net');

const LOCALHOST_NORMALIZED = new Set(['127.0.0.1', '::1']);

/**
 * Normalize remote address for comparison (IPv4-mapped IPv6, brackets, case).
 */
function normalizeIp(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  if (s.startsWith('[') && s.endsWith(']')) {
    s = s.slice(1, -1);
  }
  // Strip optional zone id (fe80::1%eth0)
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  // IPv4-mapped IPv6 → IPv4
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  if (net.isIPv6(s)) return s.toLowerCase();
  return s;
}

function isLocalhost(ip) {
  const n = normalizeIp(ip);
  return LOCALHOST_NORMALIZED.has(n);
}

/**
 * Validate a single IP string for the allowlist (exact address, not CIDR).
 * @returns {{ ok: true, ip: string } | { ok: false, error: string }}
 */
function parseAllowlistEntry(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'empty address' };
  }
  if (trimmed.includes('/')) {
    return { ok: false, error: 'CIDR ranges are not supported; use a single IPv4 or IPv6 address' };
  }
  const n = normalizeIp(trimmed);
  if (!net.isIP(n)) {
    return { ok: false, error: `invalid IP: ${trimmed}` };
  }
  if (isLocalhost(n)) {
    return { ok: false, error: 'localhost is always allowed; no need to add it' };
  }
  return { ok: true, ip: n };
}

/**
 * Normalize and validate a list of allowlist entries.
 * @returns {{ ok: true, ips: string[] } | { ok: false, error: string }}
 */
function normalizeAllowlist(ips) {
  if (!Array.isArray(ips)) {
    return { ok: false, error: 'allowedIps must be an array' };
  }
  const out = [];
  for (let i = 0; i < ips.length; i += 1) {
    const parsed = parseAllowlistEntry(ips[i]);
    if (!parsed.ok) {
      return { ok: false, error: `allowedIps[${i}]: ${parsed.error}` };
    }
    out.push(parsed.ip);
  }
  return { ok: true, ips: [...new Set(out)] };
}

/**
 * @param {string} clientIp
 * @param {string[]} allowedIps configured extras (localhost always ok)
 */
function isIpAllowed(clientIp, allowedIps) {
  const n = normalizeIp(clientIp);
  if (!n) return false;
  if (isLocalhost(n)) return true;
  const set = new Set((allowedIps || []).map(normalizeIp));
  return set.has(n);
}

/**
 * Best-effort client IP from Express request (respects trust proxy when set).
 */
function requestClientIp(req) {
  if (req.ip) return normalizeIp(req.ip);
  const raw = (req.socket && req.socket.remoteAddress) || '';
  return normalizeIp(raw);
}

module.exports = {
  normalizeIp,
  isLocalhost,
  parseAllowlistEntry,
  normalizeAllowlist,
  isIpAllowed,
  requestClientIp,
  LOCALHOST_NORMALIZED,
};
