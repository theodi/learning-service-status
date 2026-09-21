/**
 * Assemble a SPEC report. App-owned checks come from getChecks(); runtime is versions only.
 */

const os = require('os');
const { detectRuntime } = require('./detectRuntime');

/**
 * @param {{
 *   service: string,
 *   version?: string,
 *   instance?: string,
 *   runtime?: object,
 *   checks?: object[],
 *   getChecks?: () => object[]|Promise<object[]>,
 *   includeRuntime?: boolean,
 *   env?: NodeJS.ProcessEnv,
 * }} options
 */
async function buildReport(options = {}) {
  if (!options.service || !String(options.service).trim()) {
    throw new Error('buildReport: service is required');
  }

  const env = options.env || process.env;
  let checks = Array.isArray(options.checks) ? [...options.checks] : [];
  if (typeof options.getChecks === 'function') {
    const extra = await options.getChecks();
    if (Array.isArray(extra)) checks = checks.concat(extra);
  }

  const report = {
    service: String(options.service).trim(),
    reportedAt: new Date().toISOString(),
    checks,
  };

  if (options.version != null && String(options.version).trim()) {
    report.version = String(options.version).trim();
  }

  const instance =
    options.instance ||
    env.STATUS_REPORT_INSTANCE ||
    env.HOSTNAME ||
    os.hostname();
  if (instance) report.instance = String(instance);

  if (options.includeRuntime !== false) {
    report.runtime = options.runtime || detectRuntime(options);
  }

  return report;
}

module.exports = { buildReport };
