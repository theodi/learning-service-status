/**
 * Load KEY=VALUE env files without overriding already-set process.env keys
 * unless { override: true }.
 */

const fs = require('fs');

function parseEnvText(text) {
  const out = {};
  if (!text) return out;
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

function loadEnvFile(fp, options = {}) {
  if (!fp || !fs.existsSync(fp)) return {};
  const parsed = parseEnvText(fs.readFileSync(fp, 'utf8'));
  if (options.applyToProcess) {
    for (const [k, v] of Object.entries(parsed)) {
      if (options.override || process.env[k] === undefined) {
        process.env[k] = v;
      }
    }
  }
  return parsed;
}

/**
 * Merge config.env then .env from an app directory (.env wins on conflicts).
 */
function readAppEnv(appDir) {
  const path = require('path');
  const a = loadEnvFile(path.join(appDir, 'config.env'));
  const b = loadEnvFile(path.join(appDir, '.env'));
  return { ...a, ...b };
}

module.exports = { parseEnvText, loadEnvFile, readAppEnv };
