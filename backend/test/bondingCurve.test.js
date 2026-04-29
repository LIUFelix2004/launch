const assert = require('node:assert/strict')
const test = require('node:test')
const {
  collateralAtSold,
  quoteConstantProduct,
  quoteLinearBuy,
  quoteLinearSell,
  soldAtCollateral,
} = require('../lib/bondingCurve')

test('linear curve integral and inverse round trip', () => {
  const sold = 285_713_513_513n
  const collateral = collateralAtSold(sold)
  const solved = soldAtCollateral(collateral)

  assert.ok(solved <= sold)
  assert.ok(sold - solved < 10_000n)
})

test('linear buy charges 1.25 percent and emits bonded tokens', () => {
  const quote = quoteLinearBuy({
    solInLamports: 1_000_000_000n,
    soldTokens: 0n,
    remainingTokens: 1_000_000_000_000_000n,
  })

  assert.equal(quote.fees.tradeFee, 12_500_000n)
  assert.equal(quote.fees.protocolFee, 3_750_000n)
  assert.equal(quote.fees.floorInjection, 5_000_000n)
  assert.equal(quote.fees.creatorFee, 3_750_000n)
  assert.ok(quote.destinationAmount > 0n)
})

test('sell can reject when the 110 percent floor guard would be breached', () => {
  const quote = quoteLinearSell({
    tokenIn: 1_000_000_000n,
    soldTokens: 1_000_000_000n,
    liquiditySolLamports: 5_000_000_000n,
    floorSolLamports: 4_900_000_000n,
  })

  assert.equal(quote.rejected, true)
  assert.equal(quote.reason, 'floor_guard')
})

test('constant product quote preserves x*y=k directionally', () => {
  const quote = quoteConstantProduct({
    direction: 'buy',
    amountIn: 1_000_000_000n,
    reserveSolLamports: 4_900_000_000n,
    reserveTokens: 1_000_000_000_000n,
  })

  assert.ok(quote.destinationAmount > 0n)
  assert.ok(quote.nextReserveSol > 4_900_000_000n)
  assert.ok(quote.nextReserveTokens < 1_000_000_000_000n)
})
