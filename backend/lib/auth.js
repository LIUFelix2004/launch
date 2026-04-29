const jwt = require('jsonwebtoken')

function getJwtSecret() {
  return process.env.JWT_SECRET || 'devnet-local-jwt-secret-change-me'
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: { message: 'missing bearer token' } })
  }

  try {
    req.auth = jwt.verify(token, getJwtSecret())
    return next()
  } catch {
    return res.status(401).json({ error: { message: 'invalid or expired token' } })
  }
}

module.exports = {
  getJwtSecret,
  requireAuth,
}
