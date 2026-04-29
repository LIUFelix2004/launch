import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import bs58 from 'bs58'
import { ArrowRight, LogOut, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'

const AUTH_STORAGE_KEY = 'rise_launchpad_auth'

type StoredAuth = {
  token: string
  wallet: string
  userId: string
}

function readStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    return raw ? JSON.parse(raw) as StoredAuth : null
  } catch {
    return null
  }
}

export function getAuthToken() {
  return readStoredAuth()?.token || null
}

export default function WalletAuthButton() {
  const { publicKey, connected, connecting, disconnect, signMessage } = useWallet()
  const { setVisible } = useWalletModal()
  const [auth, setAuth] = useState<StoredAuth | null>(() => readStoredAuth())
  const [isSigning, setIsSigning] = useState(false)
  const wallet = publicKey?.toBase58() || null

  useEffect(() => {
    if (!wallet || auth?.wallet === wallet) return
    localStorage.removeItem(AUTH_STORAGE_KEY)
    setAuth(null)
  }, [auth?.wallet, wallet])

  useEffect(() => {
    const syncAuth = () => setAuth(readStoredAuth())
    window.addEventListener('storage', syncAuth)
    window.addEventListener('rise-auth-changed', syncAuth)
    return () => {
      window.removeEventListener('storage', syncAuth)
      window.removeEventListener('rise-auth-changed', syncAuth)
    }
  }, [])

  const label = useMemo(() => {
    if (connecting) return '连接中'
    if (isSigning) return '签名中'
    if (wallet && auth?.wallet === wallet) return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`
    if (wallet) return '签名登录'
    return '连接钱包'
  }, [auth?.wallet, connecting, isSigning, wallet])

  const login = useCallback(async () => {
    if (!connected || !wallet) {
      setVisible(true)
      return
    }

    if (!signMessage) {
      throw new Error('当前钱包不支持 signMessage')
    }

    setIsSigning(true)
    try {
      const nonceRes = await fetch(api('auth/nonce'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: wallet }),
      })
      if (!nonceRes.ok) throw new Error('获取 nonce 失败')
      const noncePayload = await nonceRes.json()

      const encodedMessage = new TextEncoder().encode(noncePayload.message)
      const signature = await signMessage(encodedMessage)

      const loginRes = await fetch(api('auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: wallet,
          nonce: noncePayload.nonce,
          signature: bs58.encode(signature),
        }),
      })
      if (!loginRes.ok) throw new Error('签名验证失败')
      const loginPayload = await loginRes.json()

      const nextAuth = {
        token: loginPayload.token,
        wallet: loginPayload.wallet,
        userId: loginPayload.userId,
      }
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth))
      window.dispatchEvent(new Event('rise-auth-changed'))
      setAuth(nextAuth)
    } finally {
      setIsSigning(false)
    }
  }, [connected, setVisible, signMessage, wallet])

  const logout = useCallback(async () => {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    window.dispatchEvent(new Event('rise-auth-changed'))
    setAuth(null)
    await disconnect()
  }, [disconnect])

  const isAuthenticated = wallet && auth?.wallet === wallet

  return (
    <div className="flex items-center gap-2">
      <button
        className="inline-flex h-11 items-center gap-3 rounded-[16px] px-6 text-[15px] font-bold disabled:opacity-60"
        style={{ background: '#F0B90B', color: '#10131c' }}
        onClick={login}
        disabled={connecting || isSigning}
      >
        {isAuthenticated ? <ShieldCheck size={18} /> : <ArrowRight size={18} />}
        {label}
      </button>
      {isAuthenticated && (
        <button
          aria-label="断开钱包"
          className="inline-flex h-11 w-11 items-center justify-center rounded-[16px] border"
          style={{ borderColor: '#252b3b', background: '#1a2030', color: '#f4f6fb' }}
          onClick={logout}
        >
          <LogOut size={17} />
        </button>
      )}
    </div>
  )
}
