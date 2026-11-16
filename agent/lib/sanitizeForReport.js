/**
 * Redact credentials before putting text into status reports.
 */

function redactSecrets(text) {
  let s = String(text == null ? '' : text);

  // scheme://user:password@host
  s = s.replace(/:\/\/([^/\s@]+):([^/\s@]+)@/g, '://***:***@');

  // Query / form secrets (with or without leading ?/&)
  s = s.replace(
    /([?&]?)((?:wstoken|access_token|refresh_token|id_token|api[_-]?key|apikey|token|password|secret|auth)=)[^&\s]*/gi,
    (_, prefix, key) => `${prefix}${key}***`
  );

  // Authorization headers / bearer tokens in errors
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer ***');
  s = s.replace(/\b(Basic)\s+[A-Za-z0-9+/=]+/gi, '$1 ***');

  // Common opaque secret prefixes
  s = s.replace(/\b(sk-|ghp_|xox[baprs]-|AKIA)[A-Za-z0-9_\-]+/g, '$1***');

  // PEM private key material
  s = s.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    '[REDACTED PRIVATE KEY]'
  );

  return s;
}

function safeErrorMessage(err) {
  if (err == null) return 'unknown error';
  if (typeof err === 'string') return redactSecrets(err);
  const msg = err.message != null ? String(err.message) : String(err);
  return redactSecrets(msg);
}

/**
 * Process argv can embed secrets; keep a short, redacted summary only.
 */
function sanitizeCmdline(cmdline) {
  if (cmdline == null || cmdline === '') return null;
  let s = redactSecrets(String(cmdline));
  // KEY=value and --key=value style args
  s = s.replace(/(^|\s)(-{0,2}[A-Za-z0-9_.-]*(?:pass|password|secret|token|key|auth|uri|url|mongo)[A-Za-z0-9_.-]*=)([^\s]*)/gi, '$1$2***');
  s = s.replace(/(^|\s)([A-Za-z0-9_.-]+=)([^\s]{24,})/g, '$1$2***');
  if (s.length > 160) s = `${s.slice(0, 160)}…`;
  return s;
}

module.exports = { redactSecrets, safeErrorMessage, sanitizeCmdline };
