#!/usr/bin/env node
/**
 * Deprecated: collector no longer self-reports.
 * Use the host agent: cd agent && npm run once
 */
console.error(
  'Collector self-report is disabled. Use the host agent:\n  cd agent && npm run once'
);
process.exit(1);
