const fs = require('fs');
const path = require('path');

/**
 * Simple JSON file store keyed by service id.
 * Shape: { [service]: { report, receivedAt } }
 */
function createStore(storePath) {
  const filePath = path.resolve(storePath);
  let cache = load(filePath);

  function load(fp) {
    try {
      if (!fs.existsSync(fp)) {
        return {};
      }
      const raw = fs.readFileSync(fp, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
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
    getAll() {
      return { ...cache };
    },
    get(service) {
      return cache[service] || null;
    },
    upsert(service, report, receivedAt) {
      cache[service] = {
        report,
        receivedAt: receivedAt || new Date().toISOString(),
      };
      persist();
      return cache[service];
    },
  };
}

module.exports = { createStore };
