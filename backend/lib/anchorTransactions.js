const {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} = require('@solana/web3.js')
const {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
} = require('@solana/spl-token')
const {
  getCreateMetadataAccountV3InstructionDataSerializer,
  MPL_TOKEN_METADATA_PROGRAM_ID,
} = require('@metaplex-foundation/mpl-token-metadata')

const DEFAULT_PROGRAM_ID = 'AtH8XVVKMm51FKPhYgYkw4ZVXb2fb8nnXjNumyTP44fo'
const DEFAULT_PROTOCOL_TREASURY = 'FtRbuPo4JJ5FoXz3SR1Cm9uYdw5817jpbLdP97PpJQEj'
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
const CREATE_LAUNCH_DISCRIMINATOR = Uint8Array.from([239, 223, 255, 134, 39, 121, 127, 62])
const SWAP_DISCRIMINATOR = Uint8Array.from([248, 198, 158, 145, 225, 117, 135, 200])
const LAMPORTS_PER_SOL = 1_000_000_000
const MIN_LAUNCH_BALANCE_LAMPORTS = 0.13 * LAMPORTS_PER_SOL

function getProgramId() {
  return new PublicKey(process.env.RISE_LAUNCHPAD_PROGRAM_ID || DEFAULT_PROGRAM_ID)
}

function getProtocolTreasury() {
  return new PublicKey(process.env.RISE_PROTOCOL_TREASURY || DEFAULT_PROTOCOL_TREASURY)
}

function getCluster() {
  return process.env.SOLANA_CLUSTER || 'devnet'
}

function getRpcEndpoint() {
  return process.env.SOLANA_RPC_URL || clusterApiUrl(getCluster())
}

function getProxyUrl() {
  return process.env.SOLANA_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    ''
}

function getFetch() {
  const proxyUrl = getProxyUrl()
  if (!proxyUrl) return undefined

  try {
    const fetch = require('node-fetch')
    const { HttpsProxyAgent } = require('https-proxy-agent')
    const agent = new HttpsProxyAgent(proxyUrl)
    return (url, options = {}) => fetch(url, { ...options, agent })
  } catch (error) {
    console.warn(`Solana RPC proxy unavailable: ${error.message}`)
    return undefined
  }
}

function getConnection() {
  return new Connection(getRpcEndpoint(), {
    commitment: 'confirmed',
    fetch: getFetch(),
  })
}

function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(totalLength)
  let offset = 0

  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }

  return output
}

function u32(value) {
  const buffer = new Uint8Array(4)
  new DataView(buffer.buffer).setUint32(0, value, true)
  return buffer
}

function u64(value) {
  const buffer = new Uint8Array(8)
  new DataView(buffer.buffer).setBigUint64(0, BigInt(value), true)
  return buffer
}

function u8(value) {
  return Uint8Array.from([value])
}

function utf8String(value) {
  const bytes = new TextEncoder().encode(value)
  return concatBytes([u32(bytes.length), bytes])
}

function parseU64(value, field, fallback) {
  const raw = value === undefined || value === null || value === '' ? fallback : value
  try {
    const parsed = BigInt(raw)
    if (parsed < 0n) throw new Error()
    return parsed
  } catch {
    throw new Error(`${field} must be a non-negative u64 integer`)
  }
}

function readPublicKey(value, field) {
  try {
    return new PublicKey(String(value || '').trim())
  } catch {
    throw new Error(`${field} must be a valid public key`)
  }
}

function createLaunchData(metadata) {
  return Buffer.from(concatBytes([
    CREATE_LAUNCH_DISCRIMINATOR,
    utf8String(String(metadata.name || '').trim()),
    utf8String(String(metadata.symbol || '').trim()),
    utf8String(String(metadata.uri || '').trim()),
    u64(metadata.slope || 37n),
    u64(metadata.maxPriceLamports || 1_400_000_000_000_000_000n),
    u64(metadata.floorNumerator || 7n),
    u64(metadata.floorDenominator || 2n),
    u64(parseU64(metadata.supply, 'metadata.supply', 1_000_000_000n)),
  ]))
}

function getMetadataAddress(mint) {
  const [metadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  )
  return metadata
}

function createTokenMetadataInstruction({ metadata, mint, mintAuthority, payer }) {
  const metadataAddress = getMetadataAddress(mint)
  const data = Buffer.from(getCreateMetadataAccountV3InstructionDataSerializer().serialize({
    data: {
      name: String(metadata.name || '').trim(),
      symbol: String(metadata.symbol || '').trim(),
      uri: String(metadata.uri || '').trim(),
      sellerFeeBasisPoints: Number(metadata.sellerFeeBasisPoints || 0),
      creators: null,
      collection: null,
      uses: null,
    },
    isMutable: metadata.isMutable !== false,
    collectionDetails: null,
  }))

  return {
    metadataAddress,
    instruction: new TransactionInstruction({
      programId: TOKEN_METADATA_PROGRAM_ID,
      keys: [
        { pubkey: metadataAddress, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: mintAuthority, isSigner: true, isWritable: false },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: payer, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data,
    }),
  }
}

function swapData(request) {
  return Buffer.from(concatBytes([
    SWAP_DISCRIMINATOR,
    u64(parseU64(request.amountIn, 'amountIn')),
    u64(parseU64(request.minOut, 'minOut', 1n)),
    u8(request.direction === 'sell' ? 1 : 0),
  ]))
}

function serializeTransaction(transaction) {
  return transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).toString('base64')
}

async function assertProgramDeployed(connection, programId) {
  const programAccount = await connection.getAccountInfo(programId, 'confirmed')
  if (!programAccount?.executable) {
    throw new Error(`Rise launchpad program ${programId.toBase58()} is not deployed on ${connection.rpcEndpoint}`)
  }
}

async function buildCreateLaunchTransaction({ metadata, payer, connection = getConnection() }) {
  const name = String(metadata?.name || '').trim()
  const symbol = String(metadata?.symbol || '').trim()

  if (!name || !symbol) {
    throw new Error('metadata.name and metadata.symbol are required')
  }

  const payerPublicKey = readPublicKey(payer, 'payer')
  const programId = getProgramId()
  const protocolTreasury = getProtocolTreasury()
  await assertProgramDeployed(connection, programId)

  const balance = await connection.getBalance(payerPublicKey, 'confirmed')
  if (balance < MIN_LAUNCH_BALANCE_LAMPORTS) {
    throw new Error(`Wallet needs at least 0.13 SOL to create this launch; current balance is ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`)
  }

  const mint = Keypair.generate()
  const [pool] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('pool'), payerPublicKey.toBuffer(), mint.publicKey.toBuffer()],
    programId,
  )
  const { metadataAddress, instruction: createMetadataInstruction } = createTokenMetadataInstruction({
    metadata: { ...metadata, name, symbol },
    mint: mint.publicKey,
    mintAuthority: payerPublicKey,
    payer: payerPublicKey,
  })
  const mintRent = await getMinimumBalanceForRentExemptMint(connection)
  const latest = await connection.getLatestBlockhash('confirmed')

  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payerPublicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports: mintRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mint.publicKey, 0, payerPublicKey, null),
    createMetadataInstruction,
    createSetAuthorityInstruction(
      mint.publicKey,
      payerPublicKey,
      AuthorityType.MintTokens,
      pool,
    ),
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: payerPublicKey, isSigner: true, isWritable: true },
        { pubkey: mint.publicKey, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: protocolTreasury, isSigner: false, isWritable: true },
      ],
      data: createLaunchData({ ...metadata, name, symbol }),
    }),
  )

  transaction.feePayer = payerPublicKey
  transaction.recentBlockhash = latest.blockhash
  transaction.partialSign(mint)

  return {
    cluster: getCluster(),
    rpcEndpoint: connection.rpcEndpoint,
    programId: programId.toBase58(),
    transaction: serializeTransaction(transaction),
    encoding: 'base64',
    signers: {
      payer: payerPublicKey.toBase58(),
      mint: 'server_partial_signature',
    },
    accounts: {
      payer: payerPublicKey.toBase58(),
      protocolTreasury: protocolTreasury.toBase58(),
      pool: pool.toBase58(),
      mint: mint.publicKey.toBase58(),
      metadata: metadataAddress.toBase58(),
      poolTokenVault: null,
    },
    recentBlockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    walletBalanceBeforeSol: balance / LAMPORTS_PER_SOL,
  }
}

async function buildSwapTransaction({ request, payer, connection = getConnection() }) {
  const payerPublicKey = readPublicKey(payer, 'payer')
  const programId = getProgramId()
  await assertProgramDeployed(connection, programId)

  const pool = readPublicKey(request?.pool, 'pool')
  const mint = readPublicKey(request?.mint, 'mint')
  const direction = request?.direction === 'sell' ? 'sell' : 'buy'
  const traderTokenAccount = request?.traderTokenAccount
    ? readPublicKey(request.traderTokenAccount, 'traderTokenAccount')
    : getAssociatedTokenAddressSync(mint, payerPublicKey)
  const latest = await connection.getLatestBlockhash('confirmed')

  const transaction = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payerPublicKey,
      traderTokenAccount,
      payerPublicKey,
      mint,
    ),
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: payerPublicKey, isSigner: true, isWritable: true },
        { pubkey: traderTokenAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: swapData({ ...request, direction }),
    }),
  )

  transaction.feePayer = payerPublicKey
  transaction.recentBlockhash = latest.blockhash

  return {
    cluster: getCluster(),
    rpcEndpoint: connection.rpcEndpoint,
    programId: programId.toBase58(),
    transaction: serializeTransaction(transaction),
    encoding: 'base64',
    signers: {
      payer: payerPublicKey.toBase58(),
    },
    accounts: {
      payer: payerPublicKey.toBase58(),
      pool: pool.toBase58(),
      mint: mint.toBase58(),
      poolTokenVault: null,
      traderTokenAccount: traderTokenAccount.toBase58(),
    },
    direction,
    amountIn: String(parseU64(request?.amountIn, 'amountIn')),
    minOut: String(parseU64(request?.minOut, 'minOut', 1n)),
    recentBlockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }
}

module.exports = {
  DEFAULT_PROGRAM_ID,
  DEFAULT_PROTOCOL_TREASURY,
  MIN_LAUNCH_BALANCE_LAMPORTS,
  buildCreateLaunchTransaction,
  buildSwapTransaction,
  createLaunchData,
  createTokenMetadataInstruction,
  getMetadataAddress,
  getConnection,
  getProgramId,
  swapData,
}
