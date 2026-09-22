/**
 * POST a report to the collector. Never throws.
 */

async function pushReport(report, { url, key, fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (!url || !key) {
    return { ok: false, skipped: true, reason: 'url or key missing' };
  }
  if (typeof fetchFn !== 'function') {
    return { ok: false, error: 'fetch is not available' };
  }
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(report),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: text.slice(0, 400) || res.statusText,
        service: report && report.service,
      };
    }
    return { ok: true, status: res.status, service: report && report.service };
  } catch (err) {
    return { ok: false, error: err.message || String(err), service: report && report.service };
  }
}

async function pushAllReports(reports, options = {}) {
  const results = [];
  const total = (reports || []).length;
  for (let i = 0; i < total; i += 1) {
    const report = reports[i];
    const n = i + 1;
    if (typeof options.onProgress === 'function') {
      options.onProgress(`Pushing [${n}/${total}] ${report.service}…`, {
        phase: 'push',
        index: n,
        total,
        service: report.service,
      });
    }
    const result = await pushReport(report, options);
    results.push(result);
    if (typeof options.onProgress === 'function') {
      if (result.ok) {
        options.onProgress(`Pushed [${n}/${total}] ${report.service} (HTTP ${result.status})`, {
          phase: 'push-ok',
          index: n,
          total,
          service: report.service,
        });
      } else {
        options.onProgress(
          `Push failed [${n}/${total}] ${report.service}: ${result.error || result.reason || result.status}`,
          {
            phase: 'push-fail',
            index: n,
            total,
            service: report.service,
          }
        );
      }
    }
  }
  return results;
}

module.exports = { pushReport, pushAllReports };
