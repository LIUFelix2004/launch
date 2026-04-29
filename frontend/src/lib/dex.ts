import { api, authHeaders } from './api'

export type DexQuoteRequest = {
  inputMint: string
  outputMint: string
  amount: string
  slippageBps?: string
}

export async function quoteDexSwap(request: DexQuoteRequest) {
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount,
    slippageBps: request.slippageBps || '100',
  })

  const response = await fetch(api(`dex/quote?${params.toString()}`), {
    headers: authHeaders(),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message || 'DEX quote failed')
  }

  return response.json()
}

export async function getDexProviders() {
  const response = await fetch(api('dex/providers'))
  if (!response.ok) throw new Error('DEX providers failed')
  return response.json()
}
