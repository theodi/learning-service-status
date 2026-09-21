function isOdiStaffEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const host = email.split('@')[1];
  if (!host) return false;
  return host.toLowerCase() === 'theodi.org';
}

function ensureOdiStaff(req, res, next) {
  const user = req.user || (req.session && req.session.passport && req.session.passport.user);
  if (!user || !isOdiStaffEmail(user.email)) {
    const err = new Error('Forbidden: service status is limited to @theodi.org accounts.');
    err.status = 403;
    return next(err);
  }
  return next();
}

function requireAuthHtml(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return ensureOdiStaff(req, res, next);
  }
  return res.redirect('/login');
}

function requireAuthJson(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return ensureOdiStaff(req, res, next);
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

module.exports = {
  isOdiStaffEmail,
  ensureOdiStaff,
  requireAuthHtml,
  requireAuthJson,
};
