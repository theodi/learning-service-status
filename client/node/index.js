/**
 * ODI service-status Node sample client.
 *
 * Copy this folder into your app (e.g. lib/odi-status/) or download
 * /client/odi-status-node.zip from the collector.
 *
 * Collector scores Node/OS LTS from `runtime`. You only send versions + app checks.
 */

const { detectRuntime } = require('./detectRuntime');
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
  buildReport,
  startStatusReporter,
  reportOnce,
  pushStatusReport,
  readReporterConfig,
  npmAuditCheck,
  npmAuditToCheck,
};
