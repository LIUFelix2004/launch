const { Router } = require('express')
const { requireAuth } = require('../lib/auth')

const router = Router()
const DEFAULT_JUPITER_QUOTE_URL = 'https://quote-api.jup.ag/v6/quote'

router.get('/quote', requireAuth, async (req, res) => {
  const inputMint = String(req.query.inputMint || '')
  const outputMint = String(req.query.outputMint || '')
  const amount = String(req.query.amount || '')
  const slippageBps = String(req.query.slippageBps || '100')

  if (!inputMint || !outputMint || !amount) {
    return res.status(400).json({ error: { message: 'inputMint, outputMint and amount are required' } })
  }

  const url = new URL(process.env.JUPITER_QUOTE_URL || DEFAULT_JUPITER_QUOTE_URL)
  url.searchParams.set('inputMint', inputMint)
  url.searchParams.set('outputMint', outputMint)
  url.searchParams.set('amount', amount)
  url.searchParams.set('slippageBps', slippageBps)

  try {
    const response = await fetch(url)
    const payload = await response.json()
    return res.status(response.status).json({
      aggregator: 'jupiter',
      request: { inputMint, outputMint, amount, slippageBps },
      quote: payload,
    })
  } catch (e) {
    return res.status(502).json({ error: { message: e.message || 'dex quote failed' } })
  }
})

router.get('/providers', (_req, res) => {
  res.json({
    primary: 'jupiter',
    cluster: process.env.SOLANA_CLUSTER || 'devnet',
    providers: [
      {
        id: 'jupiter',
        type: 'aggregator',
        quoteUrl: process.env.JUPITER_QUOTE_URL || DEFAULT_JUPITER_QUOTE_URL,
        actions: ['quote'],
      },
      {
        id: 'rise-local-amm',
        type: 'bonding_curve',
        actions: ['quote', 'launch', 'swap'],
      },
    ],
  })
})

module.exports = router
