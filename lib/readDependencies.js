/**
 * Read package.json + package-lock.json for SPEC `dependencies` (no npm binary needed).
 * Collector copy — keep in sync with client/node/readDependencies.js.
 */

const fs = require('fs');
const path = require('path');

function readJsonFile(fp) {
  const text = fs.readFileSync(fp, 'utf8');
  return JSON.parse(text);
}

/**
 * @param {{ cwd?: string, packageJsonPath?: string, packageLockPath?: string }} [options]
 * @returns {{ packageJson: object, packageLock: object } | null}
 */
function readDependencies(options = {}) {
  const cwd = options.cwd || process.cwd();
  const pkgPath = options.packageJsonPath || path.join(cwd, 'package.json');
  const lockPath = options.packageLockPath || path.join(cwd, 'package-lock.json');
  const shrinkwrap = path.join(cwd, 'npm-shrinkwrap.json');

  try {
    if (!fs.existsSync(pkgPath)) return null;
    const packageJson = readJsonFile(pkgPath);
    let packageLock = null;
    if (fs.existsSync(lockPath)) {
      packageLock = readJsonFile(lockPath);
    } else if (fs.existsSync(shrinkwrap)) {
      packageLock = readJsonFile(shrinkwrap);
    }
    if (!packageLock) return null;
    return { packageJson, packageLock };
  } catch {
    return null;
  }
}

module.exports = { readDependencies };
