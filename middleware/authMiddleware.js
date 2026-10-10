const jwt = require('jsonwebtoken');

/**
 * Protects API routes. Expects a JWT in the httpOnly "token" cookie
 * (set by POST /api/auth/login). On success, attaches req.user = { id, username, role }.
 */
function authMiddleware(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = authMiddleware;
