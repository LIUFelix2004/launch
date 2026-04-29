const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const anchor = require('@coral-xyz/anchor')
const {
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
} = require('@solana/spl-token')
const {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} = require('@solana/web3.js')

const LAMPORTS_PER_SOL = 1_000_000_000
const PROGRAM_ID = new PublicKey('AtH8XVVKMm51FKPhYgYkw4ZVXb2fb8nnXjNumyTP44fo')

function readKeypair(filePath) {
  const resolved = filePath.replace(/^~(?=$|\/|\\)/, os.homedir())
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, 'utf8'))))
}

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || 'http://127.0.0.1:8899'
  const walletPath = process.env.ANCHOR_WALLET || path.join(os.homedir(), '.config/solana/id.json')
  const payer = readKeypair(walletPath)
  const connection = new anchor.web3.Connection(rpcUrl, 'confirmed')
  const wallet = new anchor.Wallet(payer)
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  anchor.setProvider(provider)

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, '../target/idl/rise_launchpad.json'), 'utf8'))
  const program = new anchor.Program(idl, provider)

  const balance = await connection.getBalance(payer.publicKey)
  assert(balance >= 2 * LAMPORTS_PER_SOL, `localnet payer needs >= 2 SOL, got ${balance / LAMPORTS_PER_SOL}`)

  const mint = Keypair.generate()
  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), payer.publicKey.toBuffer(), mint.publicKey.toBuffer()],
    PROGRAM_ID,
  )
  const protocolTreasury = Keypair.generate()
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
  await provider.sendAndConfirm(setup, [mint])

  const metadata = {
    name: 'Rise Localnet Token',
    symbol: 'RLOCAL',
    uri: 'https://example.com/rise-localnet.json',
    slopeNumerator: new anchor.BN(37),
    slopeDenominator: new anchor.BN('1400000000000000000'),
    initialPriceNumerator: new anchor.BN(7),
    initialPriceDenominator: new anchor.BN(2),
  }

  const signature = await program.methods
    .createLaunch(metadata, supply)
    .accounts({
      pool,
      creator: payer.publicKey,
      protocolTreasury: protocolTreasury.publicKey,
      mint: mint.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc()

  const poolAccount = await program.account.tokenPool.fetch(pool)
  const mintAccount = await getMint(connection, mint.publicKey)
  const poolAccountInfo = await connection.getAccountInfo(pool)
  const protocolTreasuryBalance = await connection.getBalance(protocolTreasury.publicKey)
  const poolLamportsAfterCreate = await connection.getBalance(pool)
  const poolRent = await connection.getMinimumBalanceForRentExemption(poolAccountInfo.data.length)
  const poolBootstrapLamports = poolLamportsAfterCreate - poolRent

  assert.equal(poolAccount.creator.toBase58(), payer.publicKey.toBase58())
  assert.equal(poolAccount.mint.toBase58(), mint.publicKey.toBase58())
  assert.equal(poolAccount.floorSol.toString(), '49000000')
  assert.equal(poolAccount.liqSol.toString(), '49000000')
  assert.equal(poolAccount.protocolFeeSol.toString(), '1250000')
  assert.equal(poolAccount.totalSol.toString(), '98750000')
  assert.equal(protocolTreasuryBalance, 1_250_000)
  assert.equal(poolBootstrapLamports, 98_750_000)
  assert.equal(poolAccount.supply.toString(), supply.toString())
  assert.equal(poolAccount.soldSupply.toString(), '0')
  assert.equal(mintAccount.supply.toString(), '0')

  const buyers = Array.from({ length: 10 }, () => Keypair.generate())
  const buyerTokenAccounts = buyers.map((buyer) => (
    getAssociatedTokenAddressSync(mint.publicKey, buyer.publicKey)
  ))
  const buyAmountLamports = new anchor.BN(100_000_000)
  const tokenBalancesAfterBuys = []
  let previousSoldSupply = BigInt(poolAccount.soldSupply.toString())
  let previousMarginalPrice = marginalPrice(poolAccount)
  let previousMintSupply = BigInt(mintAccount.supply.toString())
  let previousPoolLamports = await connection.getBalance(pool)

  for (const buyer of buyers) {
    await airdrop(connection, buyer.publicKey, 2 * LAMPORTS_PER_SOL)
  }

  const createBuyerAtas = new Transaction()
  for (let i = 0; i < buyers.length; i += 1) {
    createBuyerAtas.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        buyerTokenAccounts[i],
        buyers[i].publicKey,
        mint.publicKey,
      ),
    )
  }
  await provider.sendAndConfirm(createBuyerAtas, [])

  for (let i = 0; i < buyers.length; i += 1) {
    const buySignature = await program.methods
      .swap(buyAmountLamports, new anchor.BN(1), { buy: {} })
      .accounts({
        pool,
        mint: mint.publicKey,
        trader: buyers[i].publicKey,
        traderTokenAccount: buyerTokenAccounts[i],
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyers[i]])
      .rpc()

    const nextPool = await program.account.tokenPool.fetch(pool)
    const nextMint = await getMint(connection, mint.publicKey)
    const buyerTokenAccount = await getAccount(connection, buyerTokenAccounts[i])
    const nextSoldSupply = BigInt(nextPool.soldSupply.toString())
    const nextMarginalPrice = marginalPrice(nextPool)
    const nextMintSupply = BigInt(nextMint.supply.toString())
    const nextPoolLamports = await connection.getBalance(pool)

    assert(nextSoldSupply > previousSoldSupply, `buy ${i + 1} should increase sold supply`)
    assert(nextMarginalPrice >= previousMarginalPrice, `buy ${i + 1} should not lower marginal price`)
    assert(nextMintSupply > previousMintSupply, `buy ${i + 1} should mint elastic supply`)
    assert(BigInt(buyerTokenAccount.amount.toString()) > 0n, `buy ${i + 1} should credit buyer tokens`)
    assert(nextPoolLamports > previousPoolLamports, `buy ${i + 1} should move SOL into pool`)

    tokenBalancesAfterBuys.push(BigInt(buyerTokenAccount.amount.toString()))
    previousSoldSupply = nextSoldSupply
    previousMarginalPrice = nextMarginalPrice
    previousMintSupply = nextMintSupply
    previousPoolLamports = nextPoolLamports

    console.log(`buy ${i + 1} ok: ${buySignature}`)
  }

  const seller = buyers[0]
  const sellerTokenAccount = buyerTokenAccounts[0]
  const sellerTokensBefore = tokenBalancesAfterBuys[0]
  const sellAmount = sellerTokensBefore / 4n
  assert(sellAmount > 0n, 'first buyer needs tokens to exercise sell path')

  const sellerSolBefore = await connection.getBalance(seller.publicKey)
  const poolLamportsBeforeSell = await connection.getBalance(pool)
  const poolBeforeSell = await program.account.tokenPool.fetch(pool)
  const mintBeforeSell = await getMint(connection, mint.publicKey)

  const sellSignature = await program.methods
    .swap(new anchor.BN(sellAmount.toString()), new anchor.BN(1), { sell: {} })
    .accounts({
      pool,
      mint: mint.publicKey,
      trader: seller.publicKey,
      traderTokenAccount: sellerTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([seller])
    .rpc()

  const sellerSolAfter = await connection.getBalance(seller.publicKey)
  const poolLamportsAfterSell = await connection.getBalance(pool)
  const poolAfterSell = await program.account.tokenPool.fetch(pool)
  const mintAfterSell = await getMint(connection, mint.publicKey)
  const sellerTokenAfterSell = await getAccount(connection, sellerTokenAccount)

  assert(BigInt(poolAfterSell.soldSupply.toString()) < BigInt(poolBeforeSell.soldSupply.toString()))
  assert(BigInt(mintAfterSell.supply.toString()) < BigInt(mintBeforeSell.supply.toString()))
  assert(BigInt(sellerTokenAfterSell.amount.toString()) === sellerTokensBefore - sellAmount)
  assert(sellerSolAfter > sellerSolBefore, 'sell should pay SOL to trader')
  assert(poolLamportsAfterSell < poolLamportsBeforeSell, 'sell should move SOL out of pool')
  assert(
    BigInt(poolAfterSell.liqSol.toString()) >= BigInt(poolAfterSell.floorSol.toString()) * 110n / 100n,
    'floor guard should hold after sell',
  )

  console.log(JSON.stringify({
    ok: true,
    signature,
    sellSignature,
    pool: pool.toBase58(),
    mint: mint.publicKey.toBase58(),
    mintSupply: mintAfterSell.supply.toString(),
    soldSupply: poolAfterSell.soldSupply.toString(),
    buyerCount: buyers.length,
    payerBalanceSol: (await connection.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL,
  }, null, 2))
}

async function airdrop(connection, publicKey, lamports) {
  const signature = await connection.requestAirdrop(publicKey, lamports)
  const latest = await connection.getLatestBlockhash('confirmed')
  await connection.confirmTransaction({ signature, ...latest }, 'confirmed')
}

function marginalPrice(poolAccount) {
  const sold = BigInt(poolAccount.soldSupply.toString())
  const slopeNumerator = BigInt(poolAccount.slopeNumerator.toString())
  const slopeDenominator = BigInt(poolAccount.slopeDenominator.toString())
  const initialPriceNumerator = BigInt(poolAccount.initialPriceNumerator.toString())
  const initialPriceDenominator = BigInt(poolAccount.initialPriceDenominator.toString())
  return (slopeNumerator * sold / slopeDenominator) + (initialPriceNumerator / initialPriceDenominator)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
