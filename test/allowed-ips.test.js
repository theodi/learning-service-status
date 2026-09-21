const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeIp,
  isLocalhost,
  isIpAllowed,
  parseAllowlistEntry,
  normalizeAllowlist,
  requestClientIp,
  expressTrustProxy,
  isCloudflareIp,
} = require('../lib/allowedIps');
const { createSettingsStore } = require('../lib/settingsStore');

describe('allowedIps', () => {
  it('normalizes IPv4-mapped and bracketed IPv6', () => {
    assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
    assert.equal(normalizeIp('[::1]'), '::1');
    assert.equal(normalizeIp('2001:DB8::1'), '2001:db8::1');
  });

  it('always allows localhost forms', () => {
    assert.equal(isLocalhost('127.0.0.1'), true);
    assert.equal(isLocalhost('::1'), true);
    assert.equal(isLocalhost('::ffff:127.0.0.1'), true);
    assert.equal(isIpAllowed('127.0.0.1', []), true);
    assert.equal(isIpAllowed('::1', []), true);
  });

  it('allows configured extras and rejects others', () => {
    const list = ['203.0.113.10', '2001:db8::1'];
    assert.equal(isIpAllowed('203.0.113.10', list), true);
    assert.equal(isIpAllowed('2001:DB8::1', list), true);
    assert.equal(isIpAllowed('198.51.100.1', list), false);
  });

  it('rejects CIDR and localhost in parseAllowlistEntry', () => {
    assert.equal(parseAllowlistEntry('10.0.0.0/8').ok, false);
    assert.equal(parseAllowlistEntry('127.0.0.1').ok, false);
    assert.equal(parseAllowlistEntry('203.0.113.5').ok, true);
    assert.equal(parseAllowlistEntry('203.0.113.5').ip, '203.0.113.5');
  });

  it('normalizeAllowlist dedupes', () => {
    const out = normalizeAllowlist(['203.0.113.5', '203.0.113.5', '2001:db8::1']);
    assert.equal(out.ok, true);
    assert.deepEqual(out.ips, ['203.0.113.5', '2001:db8::1']);
  });

  it('detects Cloudflare edge ranges', () => {
    assert.equal(isCloudflareIp('141.101.98.212'), true);
    assert.equal(isCloudflareIp('104.16.0.1'), true);
    assert.equal(isCloudflareIp('104.248.167.139'), false);
    assert.equal(isCloudflareIp('127.0.0.1'), false);
    assert.equal(isCloudflareIp('2606:4700::1'), true);
  });

  it('expressTrustProxy trusts Cloudflare and loopback peers', () => {
    assert.equal(expressTrustProxy('141.101.98.212'), true);
    assert.equal(expressTrustProxy('127.0.0.1'), true);
    assert.equal(expressTrustProxy('::1'), true);
    assert.equal(expressTrustProxy('203.0.113.10'), false);
  });

  it('requestClientIp uses CF-Connecting-IP only when peer is Cloudflare', () => {
    const req = {
      get(name) {
        if (name.toLowerCase() === 'cf-connecting-ip') return '104.248.167.139';
        if (name.toLowerCase() === 'x-forwarded-for') return '203.0.113.1';
        return undefined;
      },
      socket: { remoteAddress: '141.101.98.212' },
    };
    assert.equal(requestClientIp(req), '104.248.167.139');
  });

  it('requestClientIp trusts CF headers from local reverse proxy', () => {
    const req = {
      get(name) {
        if (name.toLowerCase() === 'cf-connecting-ip') return '104.248.167.139';
        return undefined;
      },
      socket: { remoteAddress: '127.0.0.1' },
    };
    assert.equal(requestClientIp(req), '104.248.167.139');
  });

  it('requestClientIp ignores spoofed CF headers from non-Cloudflare peers', () => {
    const req = {
      get(name) {
        if (name.toLowerCase() === 'cf-connecting-ip') return '104.248.167.139';
        return undefined;
      },
      socket: { remoteAddress: '203.0.113.50' },
    };
    assert.equal(requestClientIp(req), '203.0.113.50');
  });
});

describe('settingsStore', () => {
  it('persists allowedIps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-settings-'));
    const fp = path.join(dir, 'settings.json');
    const a = createSettingsStore(fp);
    a.setAllowedIps(['203.0.113.1', '2001:db8::2']);
    const b = createSettingsStore(fp);
    assert.deepEqual(b.get().allowedIps, ['203.0.113.1', '2001:db8::2']);
  });
});
