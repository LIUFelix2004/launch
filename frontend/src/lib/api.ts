export function api(path: string) {
  return `${import.meta.env.BASE_URL}api/${path.replace(/^\/+/, '')}`
}

export function getStoredAuthToken() {
  try {
    const raw = localStorage.getItem('rise_launchpad_auth')
    if (!raw) return null
    return JSON.parse(raw)?.token || null
  } catch {
    return null
  }
}

export function clearStoredAuth() {
  try {
    localStorage.removeItem('rise_launchpad_auth')
    window.dispatchEvent(new Event('rise-auth-changed'))
  } catch {
    // Ignore storage failures; the next request will still fail clearly.
  }
}

export function authHeaders(extra: HeadersInit = {}) {
  const token = getStoredAuthToken()
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}
