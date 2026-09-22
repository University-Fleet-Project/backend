const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  const map = {
    requester: 'requester',
    dispatcher: 'dispatcher',
    'fleet dispatcher': 'dispatcher',
    driver: 'driver',
    'fleet manager': 'fleet_admin',
    'fleet_admin': 'fleet_admin',
    auditor: 'auditor',
  };
  return map[value] || value;
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user.user_id ?? user.id), name: user.name, role: normalizeRole(user.role) },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { sub: String(user.user_id ?? user.id), type: 'refresh' },
    JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ success:false, error:{code:'UNAUTHORIZED',message:'Bearer access token is required.',details:null} });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success:false, error:{code:'INVALID_TOKEN',message:'Access token is invalid or expired.',details:null} });
  }
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try { req.user = jwt.verify(header.slice(7), JWT_SECRET); } catch {}
  }
  next();
}

function allowRoles(...roles) {
  const allowed = roles.map(normalizeRole);
  return (req,res,next) => {
    if (!req.user) return res.status(401).json({success:false,error:{code:'UNAUTHORIZED',message:'Authentication required.',details:null}});
    if (!allowed.includes(normalizeRole(req.user.role))) {
      return res.status(403).json({success:false,error:{code:'FORBIDDEN',message:'You do not have permission for this operation.',details:null}});
    }
    next();
  };
}

module.exports = { normalizeRole, signAccessToken, signRefreshToken, requireAuth, optionalAuth, allowRoles };
