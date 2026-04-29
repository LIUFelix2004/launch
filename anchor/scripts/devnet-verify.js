const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const anchor = require('@coral-xyz/anchor')
const {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
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
const MIN_BALANCE_SOL = 0.13

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

async function ensureBalance(connection, payer) {
  const balance = await connection.getBalance(payer.publicKey, 'confirmed')
  const sol = balance / LAMPORTS_PER_SOL
  if (sol >= MIN_BALANCE_SOL) return sol

  throw new Error(
    `Devnet payer needs at least ${MIN_BALANCE_SOL} SOL for create_launch + swap; ` +
    `current balance is ${sol.toFixed(4)} SOL. Fund ${payer.publicKey.toBase58()} and rerun npm run verify:devnet.`,
  )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const status = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })
    const value = status.value[0]
    if (value?.err) {
      throw new Error(`${label} failed: ${JSON.stringify(value.err)} (${signature})`)
    }
    if (value?.confirmationStatus === 'confirmed' || value?.confirmationStatus === 'finalized') {
      return signature
    }
    await sleep(2_000)
  }

  throw new Error(`${label} was not confirmed in time. Check signature ${signature}`)
}

async function main() {
  const rpcUrl = process.env.DEVNET_RPC_URL || DEFAULT_RPC_URL
  const payerPath = process.env.DEVNET_PAYER_KEYPAIR || path.join(__dirname, '../devnet-payer.json')
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
    throw new Error(
      `Program ${PROGRAM_ID.toBase58()} is not deployed on Devnet. Run anchor deploy --provider.cluster devnet first.`,
    )
  }

  const payerBalanceBefore = await ensureBalance(connection, payer)
  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, '../target/idl/rise_launchpad.json'), 'utf8'))
  const program = new anchor.Program(idl, provider)

  const mint = Keypair.generate()
  const [pool] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), payer.publicKey.toBuffer(), mint.publicKey.toBuffer()],
    PROGRAM_ID,
  )
  const traderTokenAccount = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey)
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
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      traderTokenAccount,
      payer.publicKey,
      mint.publicKey,
    ),
  )
  await sendAndConfirmHttp(connection, setup, [payer, mint], 'setup')

  const metadata = {
    name: `Rise Devnet ${Date.now()}`,
    symbol: 'RDEV',
    uri: 'https://example.com/rise-devnet.json',
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

  const buyTransaction = await program.methods
    .swap(new anchor.BN(100_000_000), new anchor.BN(1), { buy: {} })
    .accounts({
      pool,
      mint: mint.publicKey,
      trader: payer.publicKey,
      traderTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction()
  const buySignature = await sendAndConfirmHttp(connection, buyTransaction, [payer], 'buy_swap')

  const poolAccount = await program.account.tokenPool.fetch(pool)
  const traderToken = await getAccount(connection, traderTokenAccount)
  const mintAccount = await getMint(connection, mint.publicKey)

  console.log(JSON.stringify({
    ok: true,
    cluster: 'devnet',
    payer: payer.publicKey.toBase58(),
    payerBalanceBefore,
    programId: PROGRAM_ID.toBase58(),
    createSignature,
    buySignature,
    pool: pool.toBase58(),
    mint: mint.publicKey.toBase58(),
    protocolTreasury: protocolTreasury.toBase58(),
    traderTokenAccount: traderTokenAccount.toBase58(),
    soldSupply: poolAccount.soldSupply.toString(),
    mintSupply: mintAccount.supply.toString(),
    traderTokenAmount: traderToken.amount.toString(),
  }, null, 2))
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
