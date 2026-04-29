import { api, authHeaders } from './api'

export type AmmQuoteRequest = {
  model?: 'linear' | 'constant_product'
  direction: 'buy' | 'sell'
  amountIn: string
  soldTokens?: string
  remainingTokens?: string
  reserveSolLamports?: string
  reserveTokens?: string
  floorSolLamports?: string
  liquiditySolLamports?: string
  floorMode?: 'reject' | 'floor_price'
}

export async function quoteAmmSwap(payload: AmmQuoteRequest) {
  const response = await fetch(api('amm/quote'), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message || 'AMM quote failed')
  }

  return response.json()
}

export async function getPumpFunTemplate() {
  const response = await fetch(api('amm/pumpfun-template'))
  if (!response.ok) throw new Error('PumpFun template failed')
  return response.json()
}
