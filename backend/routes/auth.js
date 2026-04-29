const crypto = require('node:crypto')
const { Router } = require('express')
const bs58Module = require('bs58')
const jwt = require('jsonwebtoken')
const nacl = require('tweetnacl')
const { getJwtSecret } = require('../lib/auth')

const router = Router()
const bs58 = bs58Module.default || bs58Module
const nonces = new Map()
const NONCE_TTL_MS = 5 * 60 * 1000
const TOKEN_TTL = '7d'

function getMessage(nonce) {
  return `Sign this nonce: ${nonce}`
}

function decodeBase58(value, field) {
  try {
    return bs58.decode(value)
  } catch {
    throw new Error(`invalid ${field}`)
  }
}

function cleanupExpiredNonces() {
  const now = Date.now()
  for (const [key, entry] of nonces.entries()) {
    if (entry.expiresAt <= now) nonces.delete(key)
  }
}

router.post('/nonce', (req, res) => {
  cleanupExpiredNonces()

  const publicKey = String(req.body?.publicKey || '').trim()
  if (!publicKey) {
    return res.status(400).json({ error: { message: 'publicKey is required' } })
  }

  try {
    decodeBase58(publicKey, 'publicKey')
  } catch (e) {
    return res.status(400).json({ error: { message: e.message } })
  }

  const nonce = crypto.randomBytes(24).toString('base64url')
  const expiresAt = Date.now() + NONCE_TTL_MS
  nonces.set(publicKey, { nonce, expiresAt })

  res.json({
    publicKey,
    nonce,
    message: getMessage(nonce),
    expiresAt,
  })
})

router.post('/login', (req, res) => {
  cleanupExpiredNonces()

  const publicKey = String(req.body?.publicKey || '').trim()
  const signature = String(req.body?.signature || '').trim()
  const nonce = String(req.body?.nonce || '').trim()

  if (!publicKey || !signature || !nonce) {
    return res.status(400).json({ error: { message: 'publicKey, signature and nonce are required' } })
  }

  const stored = nonces.get(publicKey)
  if (!stored || stored.nonce !== nonce || stored.expiresAt <= Date.now()) {
    return res.status(401).json({ error: { message: 'nonce expired or not found' } })
  }

  try {
    const messageBytes = new TextEncoder().encode(getMessage(nonce))
    const signatureBytes = decodeBase58(signature, 'signature')
    const publicKeyBytes = decodeBase58(publicKey, 'publicKey')
    const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes)

    if (!valid) {
      return res.status(401).json({ error: { message: 'signature verification failed' } })
    }

    nonces.delete(publicKey)

    const userId = crypto.randomUUID()
    const token = jwt.sign({ wallet: publicKey, userId }, getJwtSecret(), { expiresIn: TOKEN_TTL })
    return res.json({ token, wallet: publicKey, userId, expiresIn: TOKEN_TTL })
  } catch (e) {
    return res.status(400).json({ error: { message: e.message || 'invalid login payload' } })
  }
})

module.exports = router
