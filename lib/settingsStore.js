/**
 * Persist collector settings (allowed ingest IPs, etc.) under data/settings.json.
 */

const fs = require('fs');
const path = require('path');

function createSettingsStore(settingsPath) {
  const filePath = path.resolve(settingsPath);
  let cache = load(filePath);

  function load(fp) {
    try {
      if (!fs.existsSync(fp)) {
        return { allowedIps: [] };
      }
      const raw = fs.readFileSync(fp, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { allowedIps: [] };
      }
      const allowedIps = Array.isArray(parsed.allowedIps)
        ? parsed.allowedIps.map((s) => String(s).trim()).filter(Boolean)
        : [];
      return { allowedIps };
    } catch {
      return { allowedIps: [] };
    }
  }

  function persist() {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  return {
    get() {
      return {
        allowedIps: [...(cache.allowedIps || [])],
      };
    },
    setAllowedIps(ips) {
      const list = Array.isArray(ips)
        ? [...new Set(ips.map((s) => String(s).trim()).filter(Boolean))]
        : [];
      cache = { ...cache, allowedIps: list };
      persist();
      return this.get();
    },
  };
}

module.exports = { createSettingsStore };
