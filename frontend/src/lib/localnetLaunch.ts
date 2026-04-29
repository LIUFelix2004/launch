import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js'
import { Buffer } from 'buffer'
import type { WalletContextState } from '@solana/wallet-adapter-react'
import { api, authHeaders, clearStoredAuth } from './api'
import type { LaunchMetadata } from './launches'

export const RISE_LAUNCHPAD_PROGRAM_ID = new PublicKey('AtH8XVVKMm51FKPhYgYkw4ZVXb2fb8nnXjNumyTP44fo')

export type AnchorSwapDirection = 'buy' | 'sell'

export type AnchorSwapRequest = {
  pool: string
  mint: string
  amountIn: string | number | bigint
  direction: AnchorSwapDirection
  minOut?: string | number | bigint
  poolTokenVault?: string
  traderTokenAccount?: string
}

type BackendTransactionResponse = {
  status: string
  kind: string
  cluster: string
  rpcEndpoint: string
  programId: string
  transaction: string
  encoding: 'base64'
  signers: {
    payer: string
    mint?: string
  }
  accounts: {
    payer: string
    pool?: string
    mint?: string
    metadata?: string
    poolTokenVault?: string
    traderTokenAccount?: string
  }
  recentBlockhash: string
  lastValidBlockHeight: number
  walletBalanceBeforeSol?: number
  direction?: AnchorSwapDirection
  amountIn?: string
  minOut?: string
  plan?: unknown
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (response.status === 401) {
    clearStoredAuth()
    throw new Error('Wallet login expired. Click the wallet button in the top right and sign in again, then retry.')
  }
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Request failed with HTTP ${response.status}`)
  }
  return payload as T
}

async function requestBackendTransaction(path: string, body: unknown) {
  const response = await fetch(api(path), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  return readJsonResponse<BackendTransactionResponse>(response)
}

async function describeTransactionError(error: unknown, connection?: Connection) {
  if (!(error instanceof Error)) return 'Transaction failed'

  const maybeError = error as Error & {
    logs?: string[]
    cause?: unknown
    getLogs?: (connection: Connection) => Promise<string[]>
  }
  const parts = [maybeError.message || maybeError.name]

  if (maybeError.logs?.length) {
    parts.push(maybeError.logs.slice(-6).join('\n'))
  }

  if (connection && maybeError.getLogs) {
    try {
      const logs = await maybeError.getLogs(connection)
      if (logs?.length) {
        parts.push(logs.slice(-10).join('\n'))
      }
    } catch {
      // Best effort only; the main error message is still useful.
    }
  }

  const cause = maybeError.cause
  if (cause instanceof Error && cause.message && cause.message !== maybeError.message) {
    parts.push(cause.message)
  }

  return parts.filter(Boolean).join('\n')
}

async function signSendAndConfirm(
  connection: Connection,
  wallet: Pick<WalletContextState, 'publicKey' | 'sendTransaction' | 'signTransaction'>,
  payload: BackendTransactionResponse,
) {
  if (!wallet.publicKey) throw new Error('Connect a wallet first')

  const walletAddress = wallet.publicKey.toBase58()
  if (payload.signers.payer !== walletAddress) {
    throw new Error(`Backend transaction payer ${payload.signers.payer} does not match connected wallet ${walletAddress}. Please sign in again.`)
  }

  const rpcConnection = payload.rpcEndpoint
    ? new Connection(payload.rpcEndpoint, 'confirmed')
    : connection
  const transaction = Transaction.from(Buffer.from(payload.transaction, payload.encoding))

  let signature: string
  try {
    signature = wallet.signTransaction
      ? await wallet.signTransaction(transaction)
        .then((signedTransaction) => rpcConnection.sendRawTransaction(signedTransaction.serialize(), {
          skipPreflight: true,
          preflightCommitment: 'confirmed',
        }))
      : await wallet.sendTransaction(transaction, rpcConnection, {
      skipPreflight: true,
      preflightCommitment: 'confirmed',
    })
  } catch (error) {
    throw new Error(await describeTransactionError(error, rpcConnection))
  }

  await rpcConnection.confirmTransaction({
    signature,
    blockhash: payload.recentBlockhash,
    lastValidBlockHeight: payload.lastValidBlockHeight,
  }, 'confirmed')

  return signature
}

export async function createAnchorLaunch(
  connection: Connection,
  wallet: Pick<WalletContextState, 'publicKey' | 'sendTransaction' | 'signTransaction'>,
  metadata: LaunchMetadata,
) {
  if (!wallet.publicKey) throw new Error('Connect a wallet first')

  const payload = await requestBackendTransaction('create', { metadata })
  const signature = await signSendAndConfirm(connection, wallet, payload)

  return {
    cluster: payload.cluster,
    signature,
    programId: payload.programId,
    pool: payload.accounts.pool || '',
    mint: payload.accounts.mint || '',
    metadata: payload.accounts.metadata || null,
    poolTokenVault: payload.accounts.poolTokenVault || '',
    walletBalanceBeforeSol: payload.walletBalanceBeforeSol,
    supply: String(metadata.supply || 1_000_000_000),
  }
}

export async function sendAnchorSwap(
  connection: Connection,
  wallet: Pick<WalletContextState, 'publicKey' | 'sendTransaction' | 'signTransaction'>,
  request: AnchorSwapRequest,
) {
  if (!wallet.publicKey) throw new Error('Connect a wallet first')

  const payload = await requestBackendTransaction('swap', {
    ...request,
    amountIn: String(request.amountIn),
    minOut: String(request.minOut || 1),
  })
  const signature = await signSendAndConfirm(connection, wallet, payload)

  return {
    cluster: payload.cluster,
    signature,
    programId: payload.programId,
    pool: payload.accounts.pool || request.pool,
    mint: payload.accounts.mint || request.mint,
    poolTokenVault: payload.accounts.poolTokenVault || request.poolTokenVault,
    traderTokenAccount: payload.accounts.traderTokenAccount,
    direction: payload.direction || request.direction,
    amountIn: payload.amountIn || String(request.amountIn),
    minOut: payload.minOut || String(request.minOut || 1),
  }
}
