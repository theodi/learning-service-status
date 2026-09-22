/**
 * Discover Node apps under scan roots (dirs with package.json).
 */

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  'vendor',
  'tmp',
  'temp',
]);

function readJsonSafe(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string[]} roots
 * @param {{ maxDepth?: number }} [options]
 * @returns {Array<{ dir: string, packageJson: object, packageLock: object|null, service: string, version: string|null }>}
 */
function discoverApps(roots, options = {}) {
  const maxDepth = options.maxDepth != null ? options.maxDepth : 4;
  const found = [];
  const seen = new Set();

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const packageJson = readJsonSafe(pkgPath);
      if (packageJson && typeof packageJson === 'object') {
        const resolved = path.resolve(dir);
        if (!seen.has(resolved)) {
          seen.add(resolved);
          const lockPath = path.join(dir, 'package-lock.json');
          const shrinkPath = path.join(dir, 'npm-shrinkwrap.json');
          let packageLock = null;
          if (fs.existsSync(lockPath)) packageLock = readJsonSafe(lockPath);
          else if (fs.existsSync(shrinkPath)) packageLock = readJsonSafe(shrinkPath);
          const service =
            (packageJson.name && String(packageJson.name).trim()) ||
            path.basename(dir);
          found.push({
            dir: resolved,
            packageJson,
            packageLock,
            service,
            version: packageJson.version ? String(packageJson.version) : null,
          });
        }
      }
      // Still walk children (monorepos) unless we want to stop — walk one level of packages
    }

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (SKIP_DIRS.has(ent.name)) continue;
      if (ent.name.startsWith('.') && ent.name !== '.') continue;
      walk(path.join(dir, ent.name), depth + 1);
    }
  }

  for (const root of roots || []) {
    const abs = path.resolve(root);
    if (!fs.existsSync(abs)) continue;
    walk(abs, 0);
  }

  return found;
}

module.exports = { discoverApps, SKIP_DIRS, readJsonSafe };
