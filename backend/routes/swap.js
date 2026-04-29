const { Router } = require('express')
const { requireAuth } = require('../lib/auth')
const { buildSwapTransaction } = require('../lib/anchorTransactions')

const router = Router()

router.post('/', requireAuth, async (req, res) => {
  try {
    const transaction = await buildSwapTransaction({
      request: req.body || {},
      payer: req.auth.wallet,
    })

    return res.json({
      status: 'ready_for_wallet_signature',
      kind: 'swap',
      trader: req.auth.wallet,
      ...transaction,
    })
  } catch (e) {
    return res.status(400).json({ error: { message: e.message || 'swap transaction build failed' } })
  }
})

module.exports = router
