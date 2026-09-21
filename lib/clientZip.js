/**
 * Stream a zip of the sample Node client (uses system `zip` if available).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function streamClientNodeZip(res, clientDir) {
  const dir = clientDir || path.join(__dirname, '..', 'client', 'node');
  if (!fs.existsSync(dir)) {
    res.status(404).json({ error: 'Client package not found' });
    return;
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="odi-status-node.zip"');

  const child = spawn('zip', ['-qr', '-', '.'], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({
        error: `zip failed to start: ${err.message}. Install zip or browse /client/node/`,
      });
    } else {
      res.end();
    }
  });
  child.on('close', (code) => {
    if (code !== 0 && !res.writableEnded) {
      if (!res.headersSent) {
        res.status(500).json({ error: stderr.slice(0, 300) || `zip exited ${code}` });
      } else {
        res.end();
      }
    }
  });
  child.stdout.pipe(res);
}

module.exports = { streamClientNodeZip };
