const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const anchor = require('@coral-xyz/anchor')
const {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
} = require('@solana/spl-token')
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} = require('@solana/web3.js')

const PROGRAM_ID = new PublicKey('AtH8XVVKMm51FKPhYgYkw4ZVXb2fb8nnXjNumyTP44fo')
const DEFAULT_RPC_URL = 'https://api.devnet.solana.com'
const DEFAULT_PROXY_URL = 'http://127.0.0.1:7890'
const DEFAULT_TRADER_COUNT = 12
const DEFAULT_BUY_LAMPORTS = 10_000_000
const DEFAULT_TRADER_FUND_LAMPORTS = 35_000_000

function readKeypair(filePath) {
  const resolved = filePath.replace(/^~(?=$|\/|\\)/, os.homedir())
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, 'utf8'))))
}

function getFetch() {
  const proxyUrl = process.env.DEVNET_PROXY_URL || DEFAULT_PROXY_URL
  if (!proxyUrl) return undefined

  try {
    const fetch = require('../../frontend/node_modules/node-fetch')
    const { HttpsProxyAgent } = require('../../frontend/node_modules/https-proxy-agent')
    const agent = new HttpsProxyAgent(proxyUrl)
    return (url, options = {}) => fetch(url, { ...options, agent })
  } catch (error) {
    console.warn(`Proxy fetch unavailable: ${error.message}`)
    return undefined
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function envInt(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

async function sendAndConfirmHttp(connection, transaction, signers, label) {
  const latest = await connection.getLatestBlockhash('confirmed')
  transaction.feePayer = signers[0].publicKey
  transaction.recentBlockhash = latest.blockhash
  transaction.sign(...signers)

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  })

  await confirmSignature(connection, signature, label)
  return signature
}

async function confirmSignature(connection, signature, label) {
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    const status = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })
    const value = status.value[0]
    if (value?.err) {
      throw new Error(`${label} failed: ${JSON.stringify(value.err)} (${signature})`)
    }
    if (value?.confirmationStatus === 'confirmed' || value?.confirmationStatus === 'finalized') {
      return
    }
    await sleep(2_000)
  }

  throw new Error(`${label} was not confirmed in time. Check signature ${signature}`)
}

async function sendSignedTransactionsConcurrently(connection, signedTransactions, label) {
  const sent = await Promise.all(signedTransactions.map(async ({ transaction, index }) => {
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
    return { index, signature }
  }))

  await Promise.all(sent.map(({ index, signature }) => confirmSignature(connection, signature, `${label} ${index + 1}`)))
  return sent.sort((a, b) => a.index - b.index)
}

function marginalPrice(poolAccount) {
  const sold = BigInt(poolAccount.soldSupply.toString())
  const slopeNumerator = BigInt(poolAccount.slopeNumerator.toString())
  const slopeDenominator = BigInt(poolAccount.slopeDenominator.toString())
  const initialPriceNumerator = BigInt(poolAccount.initialPriceNumerator.toString())
  const initialPriceDenominator = BigInt(poolAccount.initialPriceDenominator.toString())
  return (slopeNumerator * sold / slopeDenominator) + (initialPriceNumerator / initialPriceDenominator)
}

function chunk(values, size) {
  const chunks = []
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size))
  return chunks
}

async function main() {
  const rpcUrl = process.env.DEVNET_RPC_URL || DEFAULT_RPC_URL
  const payerPath = process.env.DEVNET_PAYER_KEYPAIR || path.join(__dirname, '../devnet-payer.json')
  const traderCount = envInt('DEVNET_E2E_TRADERS', DEFAULT_TRADER_COUNT)
  const buyLamports = envInt('DEVNET_E2E_BUY_LAMPORTS', DEFAULT_BUY_LAMPORTS)
  const traderFundLamports = envInt('DEVNET_E2E_TRADER_FUND_LAMPORTS', DEFAULT_TRADER_FUND_LAMPORTS)

  assert(traderCount >= 10, 'DEVNET_E2E_TRADERS must be at least 10 for multi-wallet E2E')
  assert(traderFundLamports > buyLamports, 'DEVNET_E2E_TRADER_FUND_LAMPORTS must exceed DEVNET_E2E_BUY_LAMPORTS')

  const payer = readKeypair(payerPath)
  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    fetch: getFetch(),
  })
  const wallet = new anchor.Wallet(payer)
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  anchor.setProvider(provider)

  const programInfo = await connection.getAccountInfo(PROGRAM_ID, 'confirmed')
  if (!programInfo?.executable) {
    throw new Error(`Program ${PROGRAM_ID.toBase58()} is not deployed on Devnet.`)
  }

  const requiredLamports = 150_000_000 + traderCount * traderFundLamports
  const payerBalance = await connection.getBalance(payer.publicKey, 'confirmed')
  if (payerBalance < requiredLamports) {
    throw new Error(
      `Devnet payer ${payer.publicKey.toBase58()} needs about ${(requiredLamports / LAMPORTS_PER_SOL).toFixed(3)} SOL; ` +
      `current balance is ${(payerBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL.`,
    )
  }

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, '../target/idl/rise_launchpad.json'), 'utf8'))
  const program = new anchor.Program(idl, provider)
  const mint = Keypair.generate()
  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), payer.publicKey.toBuffer(), mint.publicKey.toBuffer()],
    PROGRAM_ID,
  )
  const protocolTreasury = new PublicKey(process.env.RISE_PROTOCOL_TREASURY || payer.publicKey.toBase58())
  const supply = new anchor.BN(1_000_000_000)
  const mintRent = await getMinimumBalanceForRentExemptMint(connection)

  const setup = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports: mintRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint.publicKey, 0, pool, null),
  )
  const setupSignature = await sendAndConfirmHttp(connection, setup, [payer, mint], 'setup')

  const metadata = {
    name: `Rise Concurrent ${Date.now()}`,
    symbol: 'RCON',
    uri: 'https://example.com/rise-concurrent.json',
    slopeNumerator: new anchor.BN(37),
    slopeDenominator: new anchor.BN('1400000000000000000'),
    initialPriceNumerator: new anchor.BN(7),
    initialPriceDenominator: new anchor.BN(2),
  }

  const createTransaction = await program.methods
    .createLaunch(metadata, supply)
    .accounts({
      pool,
      creator: payer.publicKey,
      protocolTreasury,
      mint: mint.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction()
  const createSignature = await sendAndConfirmHttp(connection, createTransaction, [payer], 'create_launch')

  const traders = Array.from({ length: traderCount }, () => Keypair.generate())
  for (const traderChunk of chunk(traders, 8)) {
    const fundTransaction = new Transaction()
    for (const trader of traderChunk) {
      fundTransaction.add(SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: trader.publicKey,
        lamports: traderFundLamports,
      }))
    }
    await sendAndConfirmHttp(connection, fundTransaction, [payer], 'fund_traders')
  }

  const poolBefore = await program.account.tokenPool.fetch(pool)
  const mintBefore = await getMint(connection, mint.publicKey)
  const poolLamportsBefore = await connection.getBalance(pool)
  const priceBefore = marginalPrice(poolBefore)

  const signedBuys = []
  for (let i = 0; i < traders.length; i += 1) {
    const trader = traders[i]
    const traderTokenAccount = getAssociatedTokenAddressSync(mint.publicKey, trader.publicKey)
    const buyTransaction = await program.methods
      .swap(new anchor.BN(buyLamports), new anchor.BN(1), { buy: {} })
      .accounts({
        pool,
        mint: mint.publicKey,
        trader: trader.publicKey,
        traderTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        createAssociatedTokenAccountIdempotentInstruction(
          trader.publicKey,
          traderTokenAccount,
          trader.publicKey,
          mint.publicKey,
        ),
      ])
      .transaction()

    const latest = await connection.getLatestBlockhash('confirmed')
    buyTransaction.feePayer = trader.publicKey
    buyTransaction.recentBlockhash = latest.blockhash
    buyTransaction.sign(trader)
    signedBuys.push({ index: i, transaction: buyTransaction, tokenAccount: traderTokenAccount })
  }

  const buySignatures = await sendSignedTransactionsConcurrently(connection, signedBuys, 'concurrent_buy')

  const poolAfterBuys = await program.account.tokenPool.fetch(pool)
  const mintAfterBuys = await getMint(connection, mint.publicKey)
  const poolLamportsAfterBuys = await connection.getBalance(pool)
  const priceAfterBuys = marginalPrice(poolAfterBuys)
  const tokenAccountsAfterBuys = await Promise.all(
    signedBuys.map(({ tokenAccount }) => getAccount(connection, tokenAccount)),
  )
  const tokenAmounts = tokenAccountsAfterBuys.map((account) => BigInt(account.amount.toString()))

  assert(BigInt(poolAfterBuys.soldSupply.toString()) > BigInt(poolBefore.soldSupply.toString()), 'sold supply should increase')
  assert(priceAfterBuys >= priceBefore, 'marginal price should not decrease after concurrent buys')
  assert(BigInt(mintAfterBuys.supply.toString()) > BigInt(mintBefore.supply.toString()), 'elastic mint supply should increase')
  assert(poolLamportsAfterBuys > poolLamportsBefore, 'pool should receive SOL from buys')
  assert.equal(tokenAmounts.filter((amount) => amount > 0n).length, traderCount, 'every trader should receive tokens')

  const seller = traders[0]
  const sellerTokenAccount = signedBuys[0].tokenAccount
  const sellAmount = tokenAmounts[0] / 4n
  assert(sellAmount > 0n, 'first trader needs enough tokens to exercise sell path')

  const sellerSolBefore = await connection.getBalance(seller.publicKey)
  const poolBeforeSell = await program.account.tokenPool.fetch(pool)
  const mintBeforeSell = await getMint(connection, mint.publicKey)
  const poolLamportsBeforeSell = await connection.getBalance(pool)

  const sellTransaction = await program.methods
    .swap(new anchor.BN(sellAmount.toString()), new anchor.BN(1), { sell: {} })
    .accounts({
      pool,
      mint: mint.publicKey,
      trader: seller.publicKey,
      traderTokenAccount: sellerTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction()
  const sellSignature = await sendAndConfirmHttp(connection, sellTransaction, [seller], 'sell_swap')

  const sellerSolAfter = await connection.getBalance(seller.publicKey)
  const poolAfterSell = await program.account.tokenPool.fetch(pool)
  const mintAfterSell = await getMint(connection, mint.publicKey)
  const sellerTokenAfterSell = await getAccount(connection, sellerTokenAccount)
  const poolLamportsAfterSell = await connection.getBalance(pool)

  assert(BigInt(poolAfterSell.soldSupply.toString()) < BigInt(poolBeforeSell.soldSupply.toString()))
  assert(BigInt(mintAfterSell.supply.toString()) < BigInt(mintBeforeSell.supply.toString()))
  assert.equal(BigInt(sellerTokenAfterSell.amount.toString()), tokenAmounts[0] - sellAmount)
  assert(sellerSolAfter > sellerSolBefore, 'sell should pay SOL to trader')
  assert(poolLamportsAfterSell < poolLamportsBeforeSell, 'sell should move SOL out of pool')
  assert(
    BigInt(poolAfterSell.liqSol.toString()) >= BigInt(poolAfterSell.floorSol.toString()) * 110n / 100n,
    'floor guard should hold after sell',
  )

  console.log(JSON.stringify({
    ok: true,
    cluster: 'devnet',
    programId: PROGRAM_ID.toBase58(),
    payer: payer.publicKey.toBase58(),
    traderCount,
    buyLamports,
    setupSignature,
    createSignature,
    buySignatures,
    sellSignature,
    pool: pool.toBase58(),
    mint: mint.publicKey.toBase58(),
    protocolTreasury: protocolTreasury.toBase58(),
    soldSupplyAfterBuys: poolAfterBuys.soldSupply.toString(),
    soldSupplyAfterSell: poolAfterSell.soldSupply.toString(),
    mintSupplyAfterSell: mintAfterSell.supply.toString(),
    priceBefore: priceBefore.toString(),
    priceAfterBuys: priceAfterBuys.toString(),
    sellerTokenAmountAfterSell: sellerTokenAfterSell.amount.toString(),
    payerBalanceAfterSol: (await connection.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
