const ALLOWED_STATUS = new Set(['ok', 'warn', 'fail']);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * @returns {{ ok: true, report: object } | { ok: false, error: string }}
 */
function validateReport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  if (!isNonEmptyString(body.service)) {
    return { ok: false, error: 'service is required (non-empty string)' };
  }
  if (!Array.isArray(body.checks)) {
    return { ok: false, error: 'checks must be an array' };
  }

  const checks = [];
  for (let i = 0; i < body.checks.length; i += 1) {
    const c = body.checks[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      return { ok: false, error: `checks[${i}] must be an object` };
    }
    if (!isNonEmptyString(c.id)) {
      return { ok: false, error: `checks[${i}].id is required` };
    }
    if (!isNonEmptyString(c.name)) {
      return { ok: false, error: `checks[${i}].name is required` };
    }
    if (!isNonEmptyString(c.status) || !ALLOWED_STATUS.has(c.status)) {
      return { ok: false, error: `checks[${i}].status must be ok|warn|fail` };
    }
    if (!isNonEmptyString(c.message)) {
      return { ok: false, error: `checks[${i}].message is required` };
    }
    const check = {
      id: String(c.id).trim(),
      name: String(c.name).trim(),
      status: c.status,
      message: String(c.message).trim(),
    };
    if (c.detail != null && typeof c.detail === 'object') {
      check.detail = c.detail;
    }
    checks.push(check);
  }

  const report = {
    service: String(body.service).trim(),
    checks,
  };
  if (body.version != null && String(body.version).trim()) {
    report.version = String(body.version).trim();
  }
  if (body.reportedAt != null && String(body.reportedAt).trim()) {
    report.reportedAt = String(body.reportedAt).trim();
  }
  if (body.instance != null && String(body.instance).trim()) {
    report.instance = String(body.instance).trim();
  }

  if (body.runtime != null) {
    if (typeof body.runtime !== 'object' || Array.isArray(body.runtime)) {
      return { ok: false, error: 'runtime must be an object' };
    }
    const runtime = {};
    if (body.runtime.node != null && String(body.runtime.node).trim()) {
      runtime.node = String(body.runtime.node).trim();
    }
    if (body.runtime.os != null) {
      if (typeof body.runtime.os !== 'object' || Array.isArray(body.runtime.os)) {
        return { ok: false, error: 'runtime.os must be an object' };
      }
      const os = {};
      for (const key of ['id', 'versionId', 'prettyName', 'product', 'platform', 'release']) {
        if (body.runtime.os[key] != null && String(body.runtime.os[key]).trim()) {
          os[key] = String(body.runtime.os[key]).trim();
        }
      }
      if (Object.keys(os).length) runtime.os = os;
    }
    if (Object.keys(runtime).length) {
      report.runtime = runtime;
    }
  }

  if (body.dependencies != null) {
    if (typeof body.dependencies !== 'object' || Array.isArray(body.dependencies)) {
      return { ok: false, error: 'dependencies must be an object' };
    }
    const dependencies = {};
    for (const key of ['packageJson', 'packageLock']) {
      const val = body.dependencies[key];
      if (val == null) continue;
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) continue;
        try {
          dependencies[key] = JSON.parse(trimmed);
        } catch {
          return { ok: false, error: `dependencies.${key} must be valid JSON` };
        }
      } else if (typeof val === 'object' && !Array.isArray(val)) {
        dependencies[key] = val;
      } else {
        return { ok: false, error: `dependencies.${key} must be an object or JSON string` };
      }
    }
    if (Object.keys(dependencies).length) {
      report.dependencies = dependencies;
    }
  }

  return { ok: true, report };
}

function worstStatus(statuses) {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'ok';
}

function parseExpectedServices(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Build dashboard rows from store + expected list + stale window.
 */
function buildDashboardRows({ storeEntries, expectedServices, staleAfterMs, now }) {
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const ids = new Set([
    ...Object.keys(storeEntries || {}),
    ...(expectedServices || []),
  ]);
  const rows = [];

  for (const service of [...ids].sort()) {
    const entry = storeEntries[service];
    if (!entry || !entry.report) {
      rows.push({
        service,
        overall: 'warn',
        stale: true,
        receivedAt: null,
        ageMs: null,
        version: null,
        instance: null,
        checks: [
          {
            id: 'stale',
            name: 'Report',
            status: 'warn',
            message: 'no report received',
          },
        ],
      });
      continue;
    }

    const receivedAt = entry.receivedAt;
    const receivedMs = Date.parse(receivedAt);
    const ageMs = Number.isFinite(receivedMs) ? nowMs - receivedMs : null;
    const stale = ageMs == null || ageMs > staleAfterMs;
    const reportChecks = Array.isArray(entry.report.checks) ? entry.report.checks : [];
    const checks = [...reportChecks];
    if (stale) {
      checks.unshift({
        id: 'stale',
        name: 'Report freshness',
        status: 'warn',
        message:
          ageMs == null
            ? 'no report received'
            : `no report received for ${Math.round(ageMs / 1000)}s (threshold ${Math.round(staleAfterMs / 1000)}s)`,
      });
    }
    const overall = worstStatus(checks.map((c) => c.status));
    rows.push({
      service,
      overall,
      stale,
      receivedAt,
      ageMs,
      version: entry.report.version || null,
      instance: entry.report.instance || null,
      checks,
    });
  }

  return rows;
}

function extractIngestKey(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const headerKey = req.headers['x-status-key'];
  if (typeof headerKey === 'string') {
    return headerKey.trim();
  }
  return '';
}

module.exports = {
  validateReport,
  worstStatus,
  parseExpectedServices,
  buildDashboardRows,
  extractIngestKey,
  ALLOWED_STATUS,
};
