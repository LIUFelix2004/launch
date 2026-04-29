const { Router } = require('express')
const { requireAuth } = require('../lib/auth')
const { buildCreateLaunchTransaction } = require('../lib/anchorTransactions')

const router = Router()

router.post('/', requireAuth, async (req, res) => {
  try {
    const metadata = req.body?.metadata || req.body || {}
    const transaction = await buildCreateLaunchTransaction({
      metadata,
      payer: req.auth.wallet,
    })

    return res.json({
      status: 'ready_for_wallet_signature',
      kind: 'create_launch',
      creator: req.auth.wallet,
      ...transaction,
    })
  } catch (e) {
    return res.status(400).json({ error: { message: e.message || 'create transaction build failed' } })
  }
})

module.exports = router
