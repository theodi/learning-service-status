/**
 * Match running Node processes to an app directory (Linux /proc, fallback ps).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function readProcLinux() {
  const procs = [];
  let pids;
  try {
    pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d));
  } catch {
    return procs;
  }
  for (const pid of pids) {
    try {
      const cmdline = fs
        .readFileSync(`/proc/${pid}/cmdline`, 'utf8')
        .replace(/\0/g, ' ')
        .trim();
      if (!cmdline) continue;
      let cwd = '';
      try {
        cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      } catch {
        /* permission */
      }
      let exe = '';
      try {
        exe = fs.readlinkSync(`/proc/${pid}/exe`);
      } catch {
        /* permission */
      }
      procs.push({ pid: Number(pid), cmdline, cwd, exe });
    } catch {
      /* skip */
    }
  }
  return procs;
}

function readProcPs() {
  try {
    const out = execFileSync('ps', ['-eo', 'pid=,args='], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(\d+)\s+(.*)$/);
        if (!m) return null;
        return { pid: Number(m[1]), cmdline: m[2], cwd: '', exe: '' };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function listProcesses(options = {}) {
  if (options.processes) return options.processes;
  if (fs.existsSync('/proc')) return readProcLinux();
  return readProcPs();
}

function pathInside(parent, child) {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  return c === p || c.startsWith(p + path.sep);
}

/**
 * Find a Node process whose cwd or cmdline references the app dir.
 * @returns {{ matched: boolean, pid?: number, nodeVersion?: string|null, detail?: object }}
 */
function matchAppProcess(appDir, options = {}) {
  const abs = path.resolve(appDir);
  const basename = path.basename(abs);
  const procs = listProcesses(options);
  const candidates = [];

  for (const p of procs) {
    const cmd = p.cmdline || '';
    const isNode =
      /(^|[\/\s])node(js)?(\s|$)/i.test(cmd) ||
      /\/node$/.test(p.exe || '') ||
      /pm2/i.test(cmd);
    if (!isNode && !cmd.includes(basename)) continue;

    let score = 0;
    if (p.cwd && pathInside(abs, p.cwd)) score += 10;
    if (cmd.includes(abs)) score += 8;
    if (cmd.includes(basename) && /node/i.test(cmd)) score += 3;
    if (score > 0) candidates.push({ ...p, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) {
    return { matched: false, detail: { scanned: procs.length } };
  }

  let nodeVersion = null;
  if (best.exe && fs.existsSync(best.exe)) {
    try {
      nodeVersion = execFileSync(best.exe, ['-v'], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
    } catch {
      /* ignore */
    }
  }

  return {
    matched: true,
    pid: best.pid,
    nodeVersion,
    exe: best.exe || null,
    detail: { cmdline: best.cmdline, cwd: best.cwd, score: best.score, exe: best.exe || null },
  };
}

module.exports = { listProcesses, matchAppProcess, pathInside, readProcLinux };
