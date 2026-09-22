/**
 * Agent config: prefer config.json (readable scanRoots array), fall back to config.env.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnvFile } = require('./readEnvFiles');

function parseScanRoots(value) {
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim()).filter(Boolean);
  }
  if (value == null) return [];
  return String(value)
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeConfig(raw) {
  const url = String(raw.statusReportUrl || raw.STATUS_REPORT_URL || '').trim();
  const key = String(raw.statusReportKey || raw.STATUS_REPORT_KEY || '').trim();
  const hostId = String(raw.hostId || raw.HOST_ID || os.hostname() || 'unknown').trim();
  const scanRoots = parseScanRoots(raw.scanRoots != null ? raw.scanRoots : raw.SCAN_ROOTS);
  const scanDepth = parseInt(raw.scanDepth != null ? raw.scanDepth : raw.SCAN_DEPTH || '4', 10);
  const intervalMs = parseInt(
    raw.intervalMs != null ? raw.intervalMs : raw.INTERVAL_MS || '3600000',
    10
  );

  return {
    url,
    key,
    enabled: Boolean(url && key),
    hostId,
    scanRoots,
    scanDepth: Number.isFinite(scanDepth) && scanDepth >= 0 ? scanDepth : 4,
    intervalMs:
      Number.isFinite(intervalMs) && intervalMs >= 60000 ? intervalMs : 3600000,
  };
}

function loadJsonConfig(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`config JSON must be an object: ${filePath}`);
  }
  return normalizeConfig(data);
}

function loadEnvConfig(filePath, options = {}) {
  const fromFile = loadEnvFile(filePath, {
    applyToProcess: options.applyToProcess === true,
  });
  // Prefer file over process.env; if options.env is passed (tests), ignore process.env
  const merged = options.env
    ? { ...fromFile, ...options.env }
    : { ...process.env, ...fromFile };
  return normalizeConfig({
    STATUS_REPORT_URL: merged.STATUS_REPORT_URL,
    STATUS_REPORT_KEY: merged.STATUS_REPORT_KEY,
    HOST_ID: merged.HOST_ID,
    SCAN_ROOTS: merged.SCAN_ROOTS,
    SCAN_DEPTH: merged.SCAN_DEPTH,
    INTERVAL_MS: merged.INTERVAL_MS,
  });
}

/**
 * Resolve which config file to use.
 * Explicit --config= path wins. Else prefer config.json, then config.env.
 */
function resolveConfigPath(options = {}) {
  if (options.configPath) return options.configPath;
  const dir = options.configDir || path.join(__dirname, '..');
  const jsonPath = path.join(dir, 'config.json');
  const envPath = path.join(dir, 'config.env');
  if (fs.existsSync(jsonPath)) return jsonPath;
  return envPath;
}

function readAgentConfig(options = {}) {
  const configPath = resolveConfigPath(options);
  if (configPath.endsWith('.json')) {
    if (!fs.existsSync(configPath)) {
      throw new Error(`config not found: ${configPath}`);
    }
    return { ...loadJsonConfig(configPath), configPath };
  }
  if (fs.existsSync(configPath)) {
    return { ...loadEnvConfig(configPath, options), configPath };
  }
  // No file — still allow env-only / injectables
  const env = options.env || process.env;
  return {
    ...normalizeConfig({
      STATUS_REPORT_URL: env.STATUS_REPORT_URL,
      STATUS_REPORT_KEY: env.STATUS_REPORT_KEY,
      HOST_ID: env.HOST_ID,
      SCAN_ROOTS: env.SCAN_ROOTS,
      SCAN_DEPTH: env.SCAN_DEPTH,
      INTERVAL_MS: env.INTERVAL_MS,
    }),
    configPath,
  };
}

module.exports = {
  readAgentConfig,
  resolveConfigPath,
  parseScanRoots,
  normalizeConfig,
};