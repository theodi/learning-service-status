const { worstStatus } = require('./validateReport');

const STATUS_ORDER = { fail: 0, warn: 1, ok: 2 };

/**
 * Sort rows: fail → warn → ok, then by service name.
 */
function sortDashboardRows(rows) {
  return [...(rows || [])].sort((a, b) => {
    const oa = STATUS_ORDER[a.overall] != null ? STATUS_ORDER[a.overall] : 9;
    const ob = STATUS_ORDER[b.overall] != null ? STATUS_ORDER[b.overall] : 9;
    if (oa !== ob) return oa - ob;
    return String(a.service).localeCompare(String(b.service));
  });
}

function summarizeFleet(rows) {
  const list = rows || [];
  let ok = 0;
  let warn = 0;
  let fail = 0;
  let stale = 0;
  for (const r of list) {
    if (r.stale) stale += 1;
    if (r.overall === 'fail') fail += 1;
    else if (r.overall === 'warn') warn += 1;
    else ok += 1;
  }
  const overall = worstStatus(list.map((r) => r.overall));
  return { ok, warn, fail, stale, total: list.length, overall };
}

function formatAge(ageMs) {
  if (ageMs == null) return 'never';
  if (ageMs < 1000) return 'just now';
  const sec = Math.round(ageMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

function isHostService(service) {
  return String(service || '').startsWith('host:');
}

/**
 * Nest flat dashboard rows under host groups for the UI.
 * Host machine rows (service `host:<id>`) lead each group; apps nest underneath.
 */
function groupRowsByHost(rows) {
  const list = rows || [];
  /** @type {Map<string, { host: string, hostRow: object|null, apps: object[], overall: string, stale: boolean }>} */
  const map = new Map();

  function ensure(hostKey) {
    const key = hostKey || '(unknown)';
    if (!map.has(key)) {
      map.set(key, {
        host: key,
        hostRow: null,
        apps: [],
        overall: 'ok',
        stale: false,
      });
    }
    return map.get(key);
  }

  for (const row of list) {
    const hostKey = row.host || (isHostService(row.service) ? row.service.slice(5) : null) || '(unknown)';
    const g = ensure(hostKey);
    if (isHostService(row.service)) {
      g.hostRow = row;
    } else {
      g.apps.push(row);
    }
  }

  const groups = [...map.values()].map((g) => {
    const members = [...(g.hostRow ? [g.hostRow] : []), ...g.apps];
    g.overall = worstStatus(members.map((r) => r.overall));
    g.stale = members.some((r) => r.stale);
    g.apps = sortDashboardRows(g.apps);
    return g;
  });

  groups.sort((a, b) => {
    const oa = STATUS_ORDER[a.overall] != null ? STATUS_ORDER[a.overall] : 9;
    const ob = STATUS_ORDER[b.overall] != null ? STATUS_ORDER[b.overall] : 9;
    if (oa !== ob) return oa - ob;
    return String(a.host).localeCompare(String(b.host));
  });

  return groups;
}

module.exports = {
  sortDashboardRows,
  summarizeFleet,
  formatAge,
  groupRowsByHost,
  isHostService,
  STATUS_ORDER,
};
