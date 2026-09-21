/**
 * Cloudflare published edge ranges — only these peers may supply
 * CF-Connecting-IP / X-Forwarded-For for ingest IP detection.
 * Source: https://www.cloudflare.com/ips-v4/ and /ips-v6/ (refresh periodically).
 */

const net = require('net');

/** @type {string[]} */
const CLOUDFLARE_CIDRS_V4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

/** @type {string[]} */
const CLOUDFLARE_CIDRS_V6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = ((n << 8) + o) >>> 0;
  }
  return n;
}

function parseIpv4Cidr(cidr) {
  const [base, bitsRaw] = cidr.split('/');
  const bits = parseInt(bitsRaw, 10);
  const baseInt = ipv4ToInt(base);
  if (baseInt == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: baseInt & mask, mask };
}

function expandIpv6(ip) {
  const lower = ip.toLowerCase();
  const sides = lower.split('::');
  if (sides.length > 2) return null;
  let head = sides[0] ? sides[0].split(':') : [];
  let tail = sides.length === 2 && sides[1] ? sides[1].split(':') : [];
  if (sides.length === 1) {
    head = lower.split(':');
    tail = [];
  }
  const missing = 8 - (head.length + tail.length);
  if (missing < 0) return null;
  const full = [...head, ...Array(missing).fill('0'), ...tail];
  if (full.length !== 8) return null;
  const out = [];
  for (const h of full) {
    if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
    out.push(parseInt(h, 16));
  }
  return out;
}

function ipv6ToBigInt(ip) {
  const parts = expandIpv6(ip);
  if (!parts) return null;
  let n = 0n;
  for (const p of parts) {
    n = (n << 16n) + BigInt(p);
  }
  return n;
}

function parseIpv6Cidr(cidr) {
  const [base, bitsRaw] = cidr.split('/');
  const bits = parseInt(bitsRaw, 10);
  const baseInt = ipv6ToBigInt(base);
  if (baseInt == null || !Number.isInteger(bits) || bits < 0 || bits > 128) return null;
  const mask =
    bits === 0 ? 0n : bits === 128 ? (1n << 128n) - 1n : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return { base: baseInt & mask, mask };
}

const V4_PARSED = CLOUDFLARE_CIDRS_V4.map(parseIpv4Cidr).filter(Boolean);
const V6_PARSED = CLOUDFLARE_CIDRS_V6.map(parseIpv6Cidr).filter(Boolean);

/**
 * @param {string} ip normalized IPv4 or IPv6
 */
function isCloudflareIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const kind = net.isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    if (n == null) return false;
    return V4_PARSED.some((c) => (n & c.mask) === c.base);
  }
  if (kind === 6) {
    // IPv4-mapped handled by caller via normalizeIp first
    const n = ipv6ToBigInt(ip);
    if (n == null) return false;
    return V6_PARSED.some((c) => (n & c.mask) === c.base);
  }
  return false;
}

module.exports = {
  CLOUDFLARE_CIDRS_V4,
  CLOUDFLARE_CIDRS_V6,
  isCloudflareIp,
  ipv4ToInt,
  ipv6ToBigInt,
};
