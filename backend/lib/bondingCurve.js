const LAMPORTS_PER_SOL = 1_000_000_000n
const BPS_DENOMINATOR = 10_000n

const DEFAULT_CURVE = Object.freeze({
  slopeNumerator: 37n,
  slopeDenominator: 1_400_000_000_000_000_000n,
  initialPriceNumerator: 7n,
  initialPriceDenominator: 2n,
})

const DEFAULT_FEE = Object.freeze({
  tradeFeeBps: 125n,
  protocolBps: 3000n,
  floorInjectionBps: 4000n,
  creatorBps: 3000n,
})

function toBigInt(value, fallback = 0n) {
  if (value === undefined || value === null || value === '') return fallback
  return BigInt(value)
}

function divideCeil(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator
}

function integerSqrt(value) {
  if (value < 0n) throw new Error('square root of negative value')
  if (value < 2n) return value

  let x0 = value / 2n
  let x1 = (x0 + value / x0) / 2n
  while (x1 < x0) {
    x0 = x1
    x1 = (x0 + value / x0) / 2n
  }
  return x0
}

function normalizeCurve(curve = {}) {
  const next = {
    slopeNumerator: toBigInt(curve.slopeNumerator, DEFAULT_CURVE.slopeNumerator),
    slopeDenominator: toBigInt(curve.slopeDenominator, DEFAULT_CURVE.slopeDenominator),
    initialPriceNumerator: toBigInt(curve.initialPriceNumerator, DEFAULT_CURVE.initialPriceNumerator),
    initialPriceDenominator: toBigInt(curve.initialPriceDenominator, DEFAULT_CURVE.initialPriceDenominator),
  }

  if (next.slopeNumerator <= 0n || next.slopeDenominator <= 0n || next.initialPriceDenominator <= 0n) {
    throw new Error('invalid curve parameters')
  }
  return next
}

function normalizeFee(fee = {}) {
  const next = {
    tradeFeeBps: toBigInt(fee.tradeFeeBps, DEFAULT_FEE.tradeFeeBps),
    protocolBps: toBigInt(fee.protocolBps, DEFAULT_FEE.protocolBps),
    floorInjectionBps: toBigInt(fee.floorInjectionBps, DEFAULT_FEE.floorInjectionBps),
    creatorBps: toBigInt(fee.creatorBps, DEFAULT_FEE.creatorBps),
  }
  if (next.protocolBps + next.floorInjectionBps + next.creatorBps !== BPS_DENOMINATOR) {
    throw new Error('fee split must equal 10000 bps')
  }
  return next
}

function splitFee(amount, fee = {}) {
  const config = normalizeFee(fee)
  const tradeFee = amount * config.tradeFeeBps / BPS_DENOMINATOR
  return {
    tradeFee,
    netAmount: amount - tradeFee,
    protocolFee: tradeFee * config.protocolBps / BPS_DENOMINATOR,
    floorInjection: tradeFee * config.floorInjectionBps / BPS_DENOMINATOR,
    creatorFee: tradeFee * config.creatorBps / BPS_DENOMINATOR,
  }
}

function collateralAtSold(soldTokens, curve = {}) {
  const c = normalizeCurve(curve)
  const sold = toBigInt(soldTokens)
  const quadratic = c.slopeNumerator * sold * sold / (2n * c.slopeDenominator)
  const linear = c.initialPriceNumerator * sold / c.initialPriceDenominator
  return quadratic + linear
}

function soldAtCollateral(collateralLamports, curve = {}) {
  const c = normalizeCurve(curve)
  const collateral = toBigInt(collateralLamports)

  // Solve: collateral = (m / 2) * b^2 + a0 * b
  // Multiply through by 2 * slopeDen * initialDen to stay in integers:
  // (slopeNum * initialDen) b^2 + (2 * initialPriceNum * slopeDen) b
  // - (2 * collateral * slopeDen * initialDen) = 0
  const a = c.slopeNumerator * c.initialPriceDenominator
  const b = 2n * c.initialPriceNumerator * c.slopeDenominator
  const discriminant = b * b + 8n * collateral * c.slopeNumerator * c.slopeDenominator * c.initialPriceDenominator * c.initialPriceDenominator
  const root = integerSqrt(discriminant)
  if (root <= b) return 0n
  return (root - b) / (2n * a)
}

function quoteLinearBuy({ solInLamports, soldTokens = 0n, remainingTokens, curve, fee }) {
  const source = toBigInt(solInLamports)
  const sold = toBigInt(soldTokens)
  const remaining = toBigInt(remainingTokens, 0n)
  const fees = splitFee(source, fee)
  const startCollateral = collateralAtSold(sold, curve)
  const endSold = soldAtCollateral(startCollateral + fees.netAmount, curve)
  const tokensOut = remaining > 0n ? [endSold - sold, remaining].sort((a, b) => (a < b ? -1 : 1))[0] : endSold - sold

  return {
    direction: 'buy',
    sourceAmount: source,
    netAmount: fees.netAmount,
    destinationAmount: tokensOut > 0n ? tokensOut : 0n,
    fees,
    nextSoldTokens: sold + (tokensOut > 0n ? tokensOut : 0n),
  }
}

function quoteLinearSell({ tokenIn, soldTokens, floorSolLamports = 0n, liquiditySolLamports, curve, fee, floorMode = 'reject' }) {
  const source = toBigInt(tokenIn)
  const sold = toBigInt(soldTokens)
  const liq = toBigInt(liquiditySolLamports)
  const floor = toBigInt(floorSolLamports)
  const nextSold = source >= sold ? 0n : sold - source
  const startCollateral = collateralAtSold(sold, curve)
  const endCollateral = collateralAtSold(nextSold, curve)
  const grossOut = startCollateral - endCollateral
  const fees = splitFee(grossOut, fee)
  const nextLiquidity = liq > fees.netAmount ? liq - fees.netAmount : 0n
  const minLiquidity = floor * 110n / 100n

  if (floor > 0n && nextLiquidity < minLiquidity) {
    if (floorMode === 'reject') {
      return {
        direction: 'sell',
        rejected: true,
        reason: 'floor_guard',
        minLiquidity,
        nextLiquidity,
      }
    }

    const floorPrice = floor > 0n && sold > 0n ? floor / sold : 0n
    const floorGrossOut = source * floorPrice
    const floorFees = splitFee(floorGrossOut, fee)
    return {
      direction: 'sell',
      sourceAmount: source,
      netAmount: source,
      destinationAmount: floorFees.netAmount,
      fees: floorFees,
      floorExecution: true,
      nextSoldTokens: nextSold,
      nextLiquidity: liq > floorFees.netAmount ? liq - floorFees.netAmount : 0n,
    }
  }

  return {
    direction: 'sell',
    sourceAmount: source,
    netAmount: source,
    destinationAmount: fees.netAmount,
    fees,
    nextSoldTokens: nextSold,
    nextLiquidity,
  }
}

function quoteConstantProduct({ direction, amountIn, reserveSolLamports, reserveTokens, floorSolLamports = 0n, fee, floorMode = 'reject' }) {
  const source = toBigInt(amountIn)
  const solReserve = toBigInt(reserveSolLamports)
  const tokenReserve = toBigInt(reserveTokens)
  const floor = toBigInt(floorSolLamports)
  const fees = splitFee(source, fee)
  const k = solReserve * tokenReserve

  if (direction === 'buy') {
    const nextSol = solReserve + fees.netAmount + fees.floorInjection
    const nextToken = divideCeil(k, nextSol)
    const out = tokenReserve > nextToken ? tokenReserve - nextToken : 0n
    return {
      direction,
      sourceAmount: source,
      netAmount: fees.netAmount,
      destinationAmount: out,
      fees,
      nextReserveSol: nextSol,
      nextReserveTokens: nextToken,
    }
  }

  const nextToken = tokenReserve + fees.netAmount
  const nextSol = divideCeil(k, nextToken)
  const out = solReserve > nextSol ? solReserve - nextSol : 0n
  const minLiquidity = floor * 110n / 100n

  if (floor > 0n && nextSol < minLiquidity && floorMode === 'reject') {
    return {
      direction,
      rejected: true,
      reason: 'floor_guard',
      minLiquidity,
      nextLiquidity: nextSol,
    }
  }

  return {
    direction,
    sourceAmount: source,
    netAmount: fees.netAmount,
    destinationAmount: out,
    fees,
    nextReserveSol: nextSol,
    nextReserveTokens: nextToken,
    floorExecution: floor > 0n && nextSol < minLiquidity,
  }
}

function stringifyBigInts(value) {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(stringifyBigInts)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, stringifyBigInts(val)]))
  }
  return value
}

module.exports = {
  BPS_DENOMINATOR,
  DEFAULT_CURVE,
  DEFAULT_FEE,
  LAMPORTS_PER_SOL,
  collateralAtSold,
  quoteConstantProduct,
  quoteLinearBuy,
  quoteLinearSell,
  soldAtCollateral,
  splitFee,
  stringifyBigInts,
}
