const { Router } = require('express')
const { requireAuth } = require('../lib/auth')
const {
  buildCreateLaunchTransaction,
  buildSwapTransaction,
} = require('../lib/anchorTransactions')
const { DEFAULT_CURVE, DEFAULT_FEE, stringifyBigInts } = require('../lib/bondingCurve')

const router = Router()

const LAMPORTS_PER_SOL = 1_000_000_000
const LAUNCH_FEE_LAMPORTS = 0.1 * LAMPORTS_PER_SOL
const FLOOR_RESERVE_LAMPORTS = 0.049 * LAMPORTS_PER_SOL
const LIQUIDITY_RESERVE_LAMPORTS = 0.049 * LAMPORTS_PER_SOL
const PROTOCOL_FEE_LAMPORTS = 0.00125 * LAMPORTS_PER_SOL
const TRADE_FEE_BPS = 125

const FEE_SPLIT = {
  protocolBps: 3000,
  floorInjectionBps: 4000,
  creatorBps: 3000,
}

function buildLaunchPlan(metadata) {
  const supply = Number(metadata?.supply || 1_000_000_000)
  const floorPriceLamports = Math.floor(LIQUIDITY_RESERVE_LAMPORTS / supply)

  return {
    cluster: process.env.SOLANA_CLUSTER || 'devnet',
    programId: process.env.RISE_LAUNCHPAD_PROGRAM_ID || null,
    lamports: {
      launchFee: LAUNCH_FEE_LAMPORTS,
      floorReserve: FLOOR_RESERVE_LAMPORTS,
      liquidityReserve: LIQUIDITY_RESERVE_LAMPORTS,
      protocolFee: PROTOCOL_FEE_LAMPORTS,
      poolTotal: LAUNCH_FEE_LAMPORTS - PROTOCOL_FEE_LAMPORTS,
    },
    token: {
      name: metadata?.name,
      symbol: metadata?.symbol,
      uri: metadata?.uri || null,
      supply,
    },
    bondingCurve: {
      model: 'linear_price_integral',
      curve: stringifyBigInts(DEFAULT_CURVE),
      initialFloorPriceLamports: floorPriceLamports,
      initialAthPriceLamports: floorPriceLamports * 2,
      sellGuard: 'reject or execute at floor price when liq_sol < floor_sol * 1.1',
      reserveFormula: 'collateral = 0.5 * slope * sold_tokens^2 + initial_price * sold_tokens',
      inverseFormula: 'sold_tokens = positive_root(collateral = 0.5 * slope * b^2 + initial_price * b)',
    },
    fees: {
      tradeFeeBps: TRADE_FEE_BPS,
      split: FEE_SPLIT,
      curveDefaults: stringifyBigInts(DEFAULT_FEE),
    },
    dexAggregation: {
      primary: 'jupiter',
      localAmm: 'rise-local-amm',
      quoteEndpoints: ['/api/dex/quote', '/api/amm/quote'],
    },
  }
}

router.post('/', requireAuth, (req, res) => {
  const metadata = req.body?.metadata || req.body || {}
  const name = String(metadata.name || '').trim()
  const symbol = String(metadata.symbol || '').trim()

  if (!name || !symbol) {
    return res.status(400).json({ error: { message: 'metadata.name and metadata.symbol are required' } })
  }

  res.json({
    creator: req.auth.wallet,
    status: 'ready_for_anchor_instruction',
    plan: buildLaunchPlan(metadata),
  })
})

router.post('/create', requireAuth, async (req, res) => {
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
      plan: buildLaunchPlan(metadata),
      ...transaction,
    })
  } catch (e) {
    return res.status(400).json({ error: { message: e.message || 'create transaction build failed' } })
  }
})

router.post('/swap', requireAuth, async (req, res) => {
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

router.get('/config', (_req, res) => {
  res.json(buildLaunchPlan({ name: 'Rise Devnet Token', symbol: 'RISE' }))
})

module.exports = router
