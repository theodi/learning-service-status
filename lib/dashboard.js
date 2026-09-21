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

/**
 * Ensure service-status is always in the expected list.
 */
function withSelfExpected(expectedServices) {
  const list = [...(expectedServices || [])];
  if (!list.includes('service-status')) {
    list.push('service-status');
  }
  return list;
}

module.exports = {
  sortDashboardRows,
  summarizeFleet,
  formatAge,
  withSelfExpected,
  STATUS_ORDER,
};
