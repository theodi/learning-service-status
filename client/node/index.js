/**
 * ODI service-status Node sample client.
 *
 * Copy this folder into your app (e.g. lib/odi-status/) or download
 * /client/odi-status-node.zip from the collector.
 *
 * Collector scores Node/OS LTS from `runtime` and npm audit from `dependencies`
 * (package.json + package-lock.json). No npm binary required in the app.
 */

const { detectRuntime } = require('./detectRuntime');
const { readDependencies } = require('./readDependencies');
const { buildReport } = require('./buildReport');
const {
  startStatusReporter,
  reportOnce,
  pushStatusReport,
  readReporterConfig,
} = require('./statusReporter');
const { npmAuditCheck, npmAuditToCheck } = require('./checks/npmAudit');

module.exports = {
  detectRuntime,
  readDependencies,
  buildReport,
  startStatusReporter,
  reportOnce,
  pushStatusReport,
  readReporterConfig,
  npmAuditCheck,
  npmAuditToCheck,
};
