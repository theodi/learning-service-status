/**
 * Detect Node + OS versions for SPEC `runtime` (no LTS scoring — collector does that).
 */

const fs = require('fs');
const os = require('os');

function readOsRelease(filePath) {
  const fp = filePath || '/etc/os-release';
  try {
    if (!fs.existsSync(fp)) return null;
    const text = fs.readFileSync(fp, 'utf8');
    const map = {};
    for (const line of text.split('\n')) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      map[key] = val;
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * @returns {{ node: string, os: { id?: string, versionId?: string, prettyName: string, platform: string, release: string } }}
 */
function detectRuntime(options = {}) {
  const platform = options.platform || os.platform();
  const release = options.release || os.release();
  const node = options.nodeVersion || process.version;
  const releaseFile = options.osRelease || readOsRelease(options.osReleasePath);

  if (platform === 'linux' && releaseFile) {
    const id = (releaseFile.ID || '').toLowerCase();
    const versionId = releaseFile.VERSION_ID || undefined;
    const prettyName =
      releaseFile.PRETTY_NAME ||
      `${releaseFile.NAME || id} ${versionId || ''}`.trim() ||
      `Linux ${release}`;
    const runtimeOs = { prettyName, platform, release };
    if (id) runtimeOs.id = id;
    if (versionId) runtimeOs.versionId = versionId;
    return { node, os: runtimeOs };
  }

  return {
    node,
    os: {
      prettyName: `${platform} ${release}`,
      platform,
      release,
    },
  };
}

module.exports = { detectRuntime, readOsRelease };
