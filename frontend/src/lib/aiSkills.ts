import { api, authHeaders } from './api'

export async function getAiSkills() {
  const response = await fetch(api('ai/skills'))
  if (!response.ok) throw new Error('AI skills failed')
  return response.json()
}

export async function runAiSkill(skill: string, args: unknown) {
  const response = await fetch(api('ai/run'), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ skill, args }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message || 'AI skill failed')
  }

  return response.json()
}
