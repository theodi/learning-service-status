/**
 * Node + OS support checks using endoflife.date (LTS / EOL).
 * ok = supported LTS with >6 months remaining
 * warn = supported but EOL within 6 months
 * fail = not LTS, unknown cycle, or already EOL
 */

const fs = require('fs');
const os = require('os');

const WARN_WITHIN_MS = 182 * 24 * 60 * 60 * 1000; // ~6 months
const EOL_API_BASE = 'https://endoflife.date/api';
const FETCH_TIMEOUT_MS = 8000;
const EOL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** @type {Map<string, { at: number, cycles: object[] }>} */
const eolCache = new Map();

/** Map /etc/os-release ID → endoflife.date product slug */
const OS_ID_TO_PRODUCT = {
  ubuntu: 'ubuntu',
  debian: 'debian',
  rhel: 'rhel',
  centos: 'centos',
  fedora: 'fedora',
  alpine: 'alpine',
  amzn: 'amazon-linux',
  'amazon': 'amazon-linux',
  sles: 'sles',
  opensuse: 'opensuse',
  ol: 'oracle-linux',
};

function parseDate(value) {
  if (value === false || value == null || value === true) return null;
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * @param {{ isLts: boolean, eol: string|boolean|null, label: string, now?: Date, warnWithinMs?: number }} opts
 * @returns {{ status: 'ok'|'warn'|'fail', reason: string, eolDate: string|null, daysRemaining: number|null }}
 */
function evaluateSupportWindow(opts) {
  const now = opts.now instanceof Date ? opts.now.getTime() : Date.now();
  const warnWithin = opts.warnWithinMs != null ? opts.warnWithinMs : WARN_WITHIN_MS;
  const label = opts.label || 'release';

  if (!opts.isLts) {
    return {
      status: 'fail',
      reason: `${label} is not an LTS release`,
      eolDate: typeof opts.eol === 'string' ? opts.eol : null,
      daysRemaining: null,
    };
  }

  if (opts.eol === true) {
    return {
      status: 'fail',
      reason: `${label} has reached end of life`,
      eolDate: null,
      daysRemaining: null,
    };
  }

  const eolMs = parseDate(opts.eol);
  if (opts.eol && !eolMs) {
    return {
      status: 'warn',
      reason: `${label} is LTS but EOL date could not be parsed`,
      eolDate: String(opts.eol),
      daysRemaining: null,
    };
  }

  if (!eolMs) {
    // LTS with no EOL listed — treat as ok
    return {
      status: 'ok',
      reason: `${label} is LTS (no EOL date published)`,
      eolDate: null,
      daysRemaining: null,
    };
  }

  const remaining = eolMs - now;
  const daysRemaining = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  const eolDate = new Date(eolMs).toISOString().slice(0, 10);

  if (remaining <= 0) {
    return {
      status: 'fail',
      reason: `${label} reached end of life on ${eolDate}`,
      eolDate,
      daysRemaining,
    };
  }
  if (remaining <= warnWithin) {
    return {
      status: 'warn',
      reason: `${label} LTS ends ${eolDate} (${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left)`,
      eolDate,
      daysRemaining,
    };
  }
  return {
    status: 'ok',
    reason: `${label} LTS supported until ${eolDate}`,
    eolDate,
    daysRemaining,
  };
}

function nodeMajor(version) {
  const m = String(version || '').replace(/^v/, '').match(/^(\d+)/);
  return m ? m[1] : null;
}

/**
 * Node: lts field is false for non-LTS, or a date/string when it entered LTS.
 * Supported LTS means lts !== false and not yet past eol.
 */
function isNodeCycleLts(cycleRow, nowMs) {
  if (!cycleRow) return false;
  if (cycleRow.lts === false || cycleRow.lts == null) return false;
  // Future LTS date: not yet LTS
  const ltsStart = parseDate(cycleRow.lts);
  if (ltsStart && ltsStart > nowMs) return false;
  return true;
}

function findCycleRow(cycles, cycleId) {
  if (!Array.isArray(cycles)) return null;
  const want = String(cycleId);
  return cycles.find((c) => String(c.cycle) === want) || null;
}

async function fetchEolCycles(product, fetchImpl, timeoutMs) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch is not available');
  }
  const url = `${EOL_API_BASE}/${encodeURIComponent(product)}.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`endoflife.date HTTP ${res.status}`);
    }
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      throw new Error('endoflife.date returned unexpected JSON');
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * In-process TTL cache for endoflife.date product JSON.
 */
async function fetchEolCyclesCached(product, fetchImpl, timeoutMs, ttlMs) {
  const key = String(product);
  const ttl = ttlMs != null ? ttlMs : EOL_CACHE_TTL_MS;
  const hit = eolCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttl) {
    return hit.cycles;
  }
  const cycles = await fetchEolCycles(product, fetchImpl, timeoutMs);
  eolCache.set(key, { at: now, cycles });
  return cycles;
}

function clearEolCache() {
  eolCache.clear();
}

function readOsRelease(filePath) {
  const fp = filePath || '/etc/os-release';
  try {
    if (!fs.existsSync(fp)) return null;
    const text = fs.readFileSync(fp, 'utf8');
    const map = {};
    for (const line of text.split('\n')) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      map[key] = val;
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * @returns {{ product: string|null, cycle: string|null, prettyName: string, platform: string, release: string }}
 */
function detectOsInfo(options = {}) {
  const platform = options.platform || os.platform();
  const release = options.release || os.release();
  const releaseFile = options.osRelease || readOsRelease(options.osReleasePath);

  if (platform === 'linux' && releaseFile) {
    const id = (releaseFile.ID || '').toLowerCase();
    const product = OS_ID_TO_PRODUCT[id] || null;
    const cycle = releaseFile.VERSION_ID || null;
    const pretty =
      releaseFile.PRETTY_NAME ||
      `${releaseFile.NAME || id} ${cycle || ''}`.trim() ||
      `Linux ${release}`;
    return { product, cycle, prettyName: pretty, platform, release, id };
  }

  if (platform === 'darwin') {
    // os.release() is Darwin kernel; prefer sw_vers via env injection in tests
    const macVer = options.macOsVersion || null;
    return {
      product: macVer ? 'macos' : null,
      cycle: macVer,
      prettyName: macVer ? `macOS ${macVer}` : `Darwin ${release}`,
      platform,
      release,
    };
  }

  if (platform === 'win32') {
    return {
      product: null,
      cycle: null,
      prettyName: `Windows ${release}`,
      platform,
      release,
    };
  }

  return {
    product: null,
    cycle: null,
    prettyName: `${platform} ${release}`,
    platform,
    release,
  };
}

/**
 * Build SPEC `runtime` payload (versions only — no LTS scoring).
 * @returns {{ node: string, os: object }}
 */
function detectRuntime(options = {}) {
  const info = options.osInfo || detectOsInfo(options);
  const node = options.nodeVersion || process.version;
  const os = {
    prettyName: info.prettyName,
    platform: info.platform,
    release: info.release,
  };
  if (info.id) os.id = info.id;
  if (info.product) os.product = info.product;
  if (info.cycle) os.versionId = info.cycle;
  return { node, os };
}

/**
 * Build Node.js runtime check.
 */
async function checkNodeRuntime(options = {}) {
  const version = options.nodeVersion || process.version;
  const major = nodeMajor(version);
  const now = options.now instanceof Date ? options.now : new Date();
  const id = 'node_runtime';
  const name = 'Node.js';

  if (!major) {
    return {
      id,
      name,
      status: 'fail',
      message: `Could not parse Node version (${version})`,
      detail: { version },
    };
  }

  try {
    const cycles =
      options.nodeCycles ||
      (options.useCache === false
        ? await fetchEolCycles('nodejs', options.fetchImpl, options.timeoutMs)
        : await fetchEolCyclesCached('nodejs', options.fetchImpl, options.timeoutMs, options.cacheTtlMs));
    const row = findCycleRow(cycles, major);
    if (!row) {
      return {
        id,
        name,
        status: 'fail',
        message: `Node ${version} — unknown release cycle ${major}`,
        detail: { version, major },
      };
    }

    const isLts = isNodeCycleLts(row, now.getTime());
    const evaluated = evaluateSupportWindow({
      isLts,
      eol: row.eol,
      label: `Node ${version}`,
      now,
      warnWithinMs: options.warnWithinMs,
    });

    const ltsLabel =
      row.lts && row.lts !== false
        ? typeof row.lts === 'string' && !/^\d{4}-/.test(row.lts)
          ? row.lts
          : 'LTS'
        : 'non-LTS';

    return {
      id,
      name,
      status: evaluated.status,
      message: evaluated.reason,
      detail: {
        version,
        major,
        lts: ltsLabel,
        eol: evaluated.eolDate,
        daysRemaining: evaluated.daysRemaining,
        latest: row.latest || null,
      },
    };
  } catch (err) {
    return {
      id,
      name,
      status: 'warn',
      message: `Node ${version} — could not verify LTS/EOL (${err.message || err})`,
      detail: { version, major, error: true },
    };
  }
}

/**
 * For OS products, lts is typically boolean true/false.
 */
function isOsCycleLts(cycleRow) {
  if (!cycleRow) return false;
  return cycleRow.lts === true || (typeof cycleRow.lts === 'string' && cycleRow.lts.length > 0);
}

/**
 * Build operating system check.
 */
async function checkOperatingSystem(options = {}) {
  const info = options.osInfo || detectOsInfo(options);
  const now = options.now instanceof Date ? options.now : new Date();
  const id = 'operating_system';
  const name = 'Operating system';

  if (!info.product || !info.cycle) {
    return {
      id,
      name,
      status: 'warn',
      message: `${info.prettyName} — EOL/LTS lookup not available for this platform`,
      detail: {
        prettyName: info.prettyName,
        platform: info.platform,
        release: info.release,
      },
    };
  }

  try {
    const cycles =
      options.osCycles ||
      (options.useCache === false
        ? await fetchEolCycles(info.product, options.fetchImpl, options.timeoutMs)
        : await fetchEolCyclesCached(
            info.product,
            options.fetchImpl,
            options.timeoutMs,
            options.cacheTtlMs
          ));
    // VERSION_ID may be "22.04" or "22.04.3" — try exact then major.minor
    let row = findCycleRow(cycles, info.cycle);
    if (!row && /^\d+\.\d+/.test(info.cycle)) {
      const short = info.cycle.match(/^(\d+\.\d+)/)[1];
      row = findCycleRow(cycles, short);
    }
    if (!row && /^\d+/.test(info.cycle)) {
      row = findCycleRow(cycles, info.cycle.match(/^(\d+)/)[1]);
    }
    if (!row) {
      return {
        id,
        name,
        status: 'fail',
        message: `${info.prettyName} — unknown cycle for ${info.product}`,
        detail: { ...info },
      };
    }

    const evaluated = evaluateSupportWindow({
      isLts: isOsCycleLts(row),
      eol: row.eol,
      label: info.prettyName,
      now,
      warnWithinMs: options.warnWithinMs,
    });

    return {
      id,
      name,
      status: evaluated.status,
      message: evaluated.reason,
      detail: {
        prettyName: info.prettyName,
        product: info.product,
        cycle: String(row.cycle),
        eol: evaluated.eolDate,
        daysRemaining: evaluated.daysRemaining,
        lts: Boolean(isOsCycleLts(row)),
      },
    };
  } catch (err) {
    return {
      id,
      name,
      status: 'warn',
      message: `${info.prettyName} — could not verify LTS/EOL (${err.message || err})`,
      detail: { prettyName: info.prettyName, product: info.product, cycle: info.cycle, error: true },
    };
  }
}

/**
 * Build npm support check.
 * npm is not on endoflife.date — score by major distance from the latest release
 * on the registry (same major = ok, previous = warn, older = fail).
 */
async function checkNpmRuntime(options = {}) {
  const version = options.npmVersion || null;
  const id = 'npm_runtime';
  const name = 'npm';

  if (!version) {
    return {
      id,
      name,
      status: 'warn',
      message: 'npm version not reported',
      detail: { missing: true },
    };
  }

  const major = nodeMajor(version);
  if (!major) {
    return {
      id,
      name,
      status: 'fail',
      message: `Could not parse npm version (${version})`,
      detail: { version },
    };
  }

  try {
    let latestMajor = options.npmLatestMajor;
    if (latestMajor == null) {
      latestMajor = await fetchLatestNpmMajor(options);
    }
    const maj = parseInt(major, 10);
    const latest = parseInt(String(latestMajor), 10);
    const lag = latest - maj;

    if (!Number.isFinite(latest) || latest < 1) {
      return {
        id,
        name,
        status: 'warn',
        message: `npm ${version} — could not determine latest major`,
        detail: { version, major: maj },
      };
    }

    if (lag <= 0) {
      return {
        id,
        name,
        status: 'ok',
        message: `npm ${version} is current (latest major ${latest})`,
        detail: { version, major: maj, latestMajor: latest },
      };
    }
    if (lag === 1) {
      return {
        id,
        name,
        status: 'warn',
        message: `npm ${version} is one major behind latest (${latest})`,
        detail: { version, major: maj, latestMajor: latest },
      };
    }
    return {
      id,
      name,
      status: 'fail',
      message: `npm ${version} is ${lag} majors behind latest (${latest})`,
      detail: { version, major: maj, latestMajor: latest },
    };
  } catch (err) {
    return {
      id,
      name,
      status: 'warn',
      message: `npm ${version} — could not verify support (${err.message || err})`,
      detail: { version, major: parseInt(major, 10), error: true },
    };
  }
}

async function fetchLatestNpmMajor(options = {}) {
  const fetchFn = options.fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch is not available');
  }
  const cacheKey = 'npm-latest-major';
  const ttl = options.cacheTtlMs != null ? options.cacheTtlMs : EOL_CACHE_TTL_MS;
  const hit = eolCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ttl && hit.cycles && hit.cycles[0]) {
    return hit.cycles[0].major;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn('https://registry.npmjs.org/npm/latest', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`npm registry HTTP ${res.status}`);
    const data = JSON.parse(text);
    const ver = data && data.version;
    const major = nodeMajor(ver);
    if (!major) throw new Error('could not parse latest npm version');
    const n = parseInt(major, 10);
    eolCache.set(cacheKey, { at: Date.now(), cycles: [{ major: n }] });
    return n;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run both checks (parallel EOL fetches).
 */
async function runRuntimeSupportChecks(options = {}) {
  const [node, operatingSystem] = await Promise.all([
    checkNodeRuntime(options),
    checkOperatingSystem(options),
  ]);
  return { node, operatingSystem };
}

module.exports = {
  WARN_WITHIN_MS,
  EOL_API_BASE,
  OS_ID_TO_PRODUCT,
  evaluateSupportWindow,
  nodeMajor,
  isNodeCycleLts,
  isOsCycleLts,
  detectOsInfo,
  detectRuntime,
  readOsRelease,
  checkNodeRuntime,
  checkNpmRuntime,
  checkOperatingSystem,
  runRuntimeSupportChecks,
  fetchEolCycles,
  fetchEolCyclesCached,
  fetchLatestNpmMajor,
  clearEolCache,
  findCycleRow,
};
