const { Router } = require('express')
const { requireAuth } = require('../lib/auth')
const { stringifyBigInts, quoteConstantProduct, quoteLinearBuy, quoteLinearSell } = require('../lib/bondingCurve')

const router = Router()

const skills = [
  {
    name: 'token.launch',
    description: 'Create a Solana devnet launch plan with 0.1 SOL funding split, metadata, bonding curve and floor guard.',
    auth: 'wallet_jwt',
    endpoint: 'POST /api/launches',
    inputSchema: {
      metadata: {
        name: 'string',
        symbol: 'string',
        uri: 'string?',
        supply: 'number?',
      },
    },
  },
  {
    name: 'amm.quote',
    description: 'Quote Rise local AMM swaps using linear bonding curve or x*y=k constant-product variant.',
    auth: 'wallet_jwt',
    endpoint: 'POST /api/amm/quote',
    inputSchema: {
      model: 'linear | constant_product',
      direction: 'buy | sell',
      amountIn: 'lamports_or_token_base_units_string',
    },
  },
  {
    name: 'dex.aggregateQuote',
    description: 'Route swap quote requests through a DEX aggregator provider such as Jupiter.',
    auth: 'wallet_jwt',
    endpoint: 'GET /api/dex/quote',
    inputSchema: {
      inputMint: 'string',
      outputMint: 'string',
      amount: 'base_units_string',
      slippageBps: 'string?',
    },
  },
  {
    name: 'pumpfun.curveSimulate',
    description: 'Simulate PumpFun-style launch curve buys/sells before building a transaction.',
    auth: 'wallet_jwt',
    endpoint: 'POST /api/ai/run',
    inputSchema: {
      skill: 'pumpfun.curveSimulate',
      args: {
        direction: 'buy | sell',
        amountIn: 'string',
        pool: 'object?',
      },
    },
  },
]

router.get('/skills', (_req, res) => {
  res.json({
    agent: 'rise-launchpad-ai',
    cluster: process.env.SOLANA_CLUSTER || 'devnet',
    skills,
  })
})

router.post('/run', requireAuth, async (req, res) => {
  const { skill, args = {} } = req.body || {}

  try {
    if (skill === 'pumpfun.curveSimulate' || skill === 'amm.quote') {
      const model = args.model || 'linear'
      const direction = args.direction || 'buy'
      const pool = args.pool || {}

      const quote = model === 'constant_product'
        ? quoteConstantProduct({
          direction,
          amountIn: args.amountIn,
          reserveSolLamports: pool.reserveSolLamports || '49000000',
          reserveTokens: pool.reserveTokens || '1000000000000000',
          floorSolLamports: pool.floorSolLamports || '49000000',
          floorMode: pool.floorMode || 'reject',
          fee: args.fee,
        })
        : direction === 'buy'
          ? quoteLinearBuy({
            solInLamports: args.amountIn,
            soldTokens: pool.soldTokens || '0',
            remainingTokens: pool.remainingTokens || '1000000000000000',
            curve: args.curve,
            fee: args.fee,
          })
          : quoteLinearSell({
            tokenIn: args.amountIn,
            soldTokens: pool.soldTokens || '0',
            floorSolLamports: pool.floorSolLamports || '49000000',
            liquiditySolLamports: pool.liquiditySolLamports || '49000000',
            floorMode: pool.floorMode || 'reject',
            curve: args.curve,
            fee: args.fee,
          })

      return res.json({
        skill,
        wallet: req.auth.wallet,
        result: stringifyBigInts(quote),
      })
    }

    return res.status(400).json({ error: { message: `unsupported skill: ${skill}` } })
  } catch (e) {
    return res.status(400).json({ error: { message: e.message || 'skill execution failed' } })
  }
})

module.exports = router
