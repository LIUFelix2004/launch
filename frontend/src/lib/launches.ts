import { api, authHeaders } from './api'

export type LaunchMetadata = {
  name: string
  symbol: string
  uri?: string
  supply?: number
}

export async function createLaunch(metadata: LaunchMetadata) {
  const response = await fetch(api('launches'), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ metadata }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error?.message || 'create launch failed')
  }

  return response.json()
}
