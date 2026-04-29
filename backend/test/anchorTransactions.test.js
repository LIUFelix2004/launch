const assert = require('node:assert/strict')
const test = require('node:test')
const { Keypair, Transaction } = require('@solana/web3.js')
const {
  buildCreateLaunchTransaction,
  buildSwapTransaction,
} = require('../lib/anchorTransactions')

function fakeConnection() {
  return {
    rpcEndpoint: 'http://127.0.0.1:8899',
    getAccountInfo: async () => ({ executable: true }),
    getBalance: async () => 2_000_000_000,
    getMinimumBalanceForRentExemption: async () => 1_461_600,
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 123,
    }),
  }
}

test('buildCreateLaunchTransaction returns a wallet-signable base64 transaction', async () => {
  const payer = Keypair.generate().publicKey.toBase58()
  const payload = await buildCreateLaunchTransaction({
    payer,
    connection: fakeConnection(),
    metadata: {
      name: 'Rise Dev Token',
      symbol: 'RISE',
      uri: 'https://example.com/rise.json',
      supply: '1000000000000000',
    },
  })

  const transaction = Transaction.from(Buffer.from(payload.transaction, 'base64'))

  assert.equal(payload.encoding, 'base64')
  assert.equal(payload.signers.payer, payer)
  assert.equal(payload.signers.mint, 'server_partial_signature')
  assert.equal(payload.accounts.payer, payer)
  assert.equal(transaction.instructions.length, 5)
  assert.equal(transaction.feePayer.toBase58(), payer)
  assert.ok(payload.accounts.pool)
  assert.ok(payload.accounts.protocolTreasury)
  assert.ok(payload.accounts.mint)
  assert.ok(payload.accounts.metadata)
  assert.equal(payload.accounts.poolTokenVault, null)
})

test('buildSwapTransaction returns a wallet-signable buy swap transaction', async () => {
  const payer = Keypair.generate().publicKey.toBase58()
  const pool = Keypair.generate().publicKey.toBase58()
  const mint = Keypair.generate().publicKey.toBase58()
  const payload = await buildSwapTransaction({
    payer,
    connection: fakeConnection(),
    request: {
      pool,
      mint,
      direction: 'buy',
      amountIn: '100000000',
      minOut: '1',
    },
  })

  const transaction = Transaction.from(Buffer.from(payload.transaction, 'base64'))

  assert.equal(payload.encoding, 'base64')
  assert.equal(payload.direction, 'buy')
  assert.equal(payload.amountIn, '100000000')
  assert.equal(payload.minOut, '1')
  assert.equal(payload.accounts.payer, payer)
  assert.equal(payload.accounts.pool, pool)
  assert.equal(payload.accounts.mint, mint)
  assert.equal(payload.accounts.poolTokenVault, null)
  assert.equal(transaction.instructions.length, 2)
  assert.equal(transaction.feePayer.toBase58(), payer)
})
