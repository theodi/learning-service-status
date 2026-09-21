/**
 * Assemble a SPEC report. App-owned checks from getChecks(); runtime + lockfiles for collector.
 */

const os = require('os');
const path = require('path');
const { detectRuntime } = require('./detectRuntime');
const { readDependencies } = require('./readDependencies');

/**
 * @param {{
 *   service: string,
 *   version?: string,
 *   instance?: string,
 *   runtime?: object,
 *   dependencies?: object,
 *   checks?: object[],
 *   getChecks?: () => object[]|Promise<object[]>,
 *   includeRuntime?: boolean,
 *   includeDependencies?: boolean,
 *   cwd?: string,
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

  if (options.includeDependencies !== false) {
    report.dependencies =
      options.dependencies ||
      readDependencies({ cwd: options.cwd || process.cwd() }) ||
      undefined;
    if (!report.dependencies) delete report.dependencies;
  }

  return report;
}

module.exports = { buildReport };
