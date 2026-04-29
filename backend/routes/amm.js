const { Router } = require('express')
const { requireAuth } = require('../lib/auth')
const {
  LAMPORTS_PER_SOL,
  quoteConstantProduct,
  quoteLinearBuy,
  quoteLinearSell,
  stringifyBigInts,
} = require('../lib/bondingCurve')

const router = Router()

function readPool(body = {}) {
  return {
    soldTokens: body.soldTokens || '0',
    remainingTokens: body.remainingTokens || '1000000000000000',
    reserveSolLamports: body.reserveSolLamports || (49n * LAMPORTS_PER_SOL / 1000n).toString(),
    reserveTokens: body.reserveTokens || '1000000000000000',
    floorSolLamports: body.floorSolLamports || (49n * LAMPORTS_PER_SOL / 1000n).toString(),
    liquiditySolLamports: body.liquiditySolLamports || (49n * LAMPORTS_PER_SOL / 1000n).toString(),
    floorMode: body.floorMode || 'reject',
  }
}

router.post('/quote', requireAuth, (req, res) => {
  try {
    const body = req.body || {}
    const pool = readPool(body)
    const model = body.model || 'linear'
    const direction = body.direction || 'buy'
    const amountIn = body.amountIn

    if (!amountIn) {
      return res.status(400).json({ error: { message: 'amountIn is required' } })
    }

    if (model === 'constant_product') {
      const quote = quoteConstantProduct({
        direction,
        amountIn,
        reserveSolLamports: pool.reserveSolLamports,
        reserveTokens: pool.reserveTokens,
        floorSolLamports: pool.floorSolLamports,
        floorMode: pool.floorMode,
        fee: body.fee,
      })
      return res.json({ model, quote: stringifyBigInts(quote) })
    }

    const quote = direction === 'buy'
      ? quoteLinearBuy({
        solInLamports: amountIn,
        soldTokens: pool.soldTokens,
        remainingTokens: pool.remainingTokens,
        curve: body.curve,
        fee: body.fee,
      })
      : quoteLinearSell({
        tokenIn: amountIn,
        soldTokens: pool.soldTokens,
        floorSolLamports: pool.floorSolLamports,
        liquiditySolLamports: pool.liquiditySolLamports,
        curve: body.curve,
        fee: body.fee,
        floorMode: pool.floorMode,
      })

    return res.json({ model, quote: stringifyBigInts(quote) })
  } catch (e) {
    return res.status(400).json({ error: { message: e.message || 'quote failed' } })
  }
})

router.get('/pumpfun-template', (_req, res) => {
  res.json({
    model: 'linear_bonding_curve',
    launchFeeSol: 0.1,
    initialReserves: {
      floorSol: 0.049,
      liquiditySol: 0.049,
      protocolFeeSol: 0.00125,
    },
    tradeFee: {
      bps: 125,
      split: {
        protocol: '30%',
        floorInjection: '40%',
        creator: '30%',
      },
    },
    floorGuard: 'Reject sells when post-trade liquidity is below 110% of floor reserve, or execute at floor price when floorMode=floor_price.',
    curve: {
      price: 'a = slope * sold_tokens + initial_price',
      reserveIntegral: 'collateral = 0.5 * slope * sold_tokens^2 + initial_price * sold_tokens',
    },
  })
})

module.exports = router
