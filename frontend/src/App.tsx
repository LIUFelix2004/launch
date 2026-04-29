import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { clusterApiUrl, PublicKey, type Connection } from '@solana/web3.js'
import '@solana/wallet-adapter-react-ui/styles.css'
import { api } from './lib/api'
import { quoteAmmSwap } from './lib/amm'
import { getAiSkills, runAiSkill } from './lib/aiSkills'
import { createAnchorLaunch, sendAnchorSwap } from './lib/localnetLaunch'
import WalletAuthButton from './components/WalletAuthButton'
import {
  Activity,
  BadgeCheck,
  Bot,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  PieChart,
  Play,
  Rocket,
  Search,
  Send,
  Users,
  WalletCards,
  X,
} from 'lucide-react'

/* ============================================================
 * Theme — Binance yellow on dark
 * ============================================================ */
const theme = {
  bg: '#0a0c12',
  panel: '#161a24',
  panelSoft: '#171b27',
  border: '#252b3b',
  borderSoft: '#1a2030',
  text: '#f4f6fb',
  textSoft: '#d0d5e6',
  muted: '#8f95a8',
  accent: '#F0B90B',           // Binance yellow
  accentSoft: '#FCD535',       // bright yellow
  success: '#1fda67',
  danger: '#f1666e',
  button: '#1a2030',
}

/* ============================================================
 * i18n
 * ============================================================ */
const T = {
  createToken: '创建代币',
  discover: '发现',
  portfolio: '投资组合',
  simulator: '模拟器',
  recommend: '推荐',
  faq: '常见问题',
  connect: '连接',
  search: '按名称、代号或地址搜索...',
  latest: '最新发行',
  verified: '认证发行',
  verifiedDesc: '经过验证的团队代币，按交易量排序',
  hot: '热门',
  volumeTop: '交易量最高',
  active: '最活跃',
  gainer: '涨幅最大',
  floor: '地板价',
  price: '价格',
  marketCap: '市值',
  tradeCount: '笔交易',
  close: '关闭',
  docs: '文档',
  switchLabel: '切换',
  beta: 'Beta',
}

/* ============================================================
 * Helpers
 * ============================================================ */
const fmtUSD = (v?: number) => {
  if (v === undefined || v === null || !isFinite(v)) return '—'
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T'
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K'
  if (v >= 1) return '$' + v.toFixed(2)
  return '$' + v.toPrecision(4)
}
const fmtPct = (v?: number) => (v === undefined ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%')
const ago = (idx: number) => `${idx + 1}小时前`
const weeksAgo = (idx: number) => `${idx + 1}周前`

function buildTokenArt(label: string, from: string, to: string, accent: string) {
  const initials = label
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${from}"/>
          <stop offset="100%" stop-color="${to}"/>
        </linearGradient>
        <linearGradient id="shine" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.95"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0.16"/>
        </linearGradient>
      </defs>
      <rect width="800" height="800" rx="132" fill="url(#bg)"/>
      <circle cx="620" cy="180" r="128" fill="url(#shine)" opacity="0.3"/>
      <circle cx="180" cy="620" r="186" fill="#ffffff" opacity="0.08"/>
      <rect x="120" y="470" width="560" height="32" rx="16" fill="#090d13" opacity="0.16"/>
      <text x="400" y="420" fill="#ffffff" font-size="248" font-family="Arial, Helvetica, sans-serif" font-weight="800" text-anchor="middle">${initials}</text>
      <text x="400" y="560" fill="#ffffff" opacity="0.86" font-size="64" font-family="Arial, Helvetica, sans-serif" font-weight="700" text-anchor="middle">${label.toUpperCase()}</text>
    </svg>
  `
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const palettes = [
  ['#5a3709', '#d0a736', '#fff0ba'],
  ['#2e3149', '#f0cac7', '#efedff'],
  ['#477b2d', '#d6ad55', '#effec9'],
  ['#1d1c1b', '#ecd5bd', '#fff6dd'],
  ['#402567', '#d8a964', '#f6f0d7'],
  ['#0d1014', '#F0B90B', '#FCD535'],
  ['#fbf0e5', '#f6c6d7', '#ffffff'],
]
function colorsFor(symbol: string): [string, string, string] {
  const sum = (symbol || 'X').split('').reduce((s, c) => s + c.charCodeAt(0), 0)
  return palettes[sum % palettes.length] as [string, string, string]
}
function shortAddr(symbol: string) {
  const sym = (symbol || 'TOKEN').toLowerCase().padEnd(4, 'x').slice(0, 4)
  return `${sym}...rise`
}

/* ============================================================
 * API types
 * ============================================================ */
type TokenItem = {
  rank: number
  symbol: string
  name: string
  image?: string
  price_usd: number
  change_24h_pct: number
  market_cap_usd: number
  volume_24h_usd: number
}

type CreatedLaunch = {
  id: string
  name: string
  symbol: string
  uri: string
  supply: string
  cluster: string
  signature: string
  pool: string
  mint: string
  metadata?: string | null
  poolTokenVault: string
  createdAt: number
  lastSwapSignature?: string
  lastSwapAmountIn?: string
  traderTokenAccount?: string
  trades?: LaunchTrade[]
  currentSoldSupply?: string
  currentPriceLamports?: number
  currentFloorSol?: number
  currentLiquiditySol?: number
  contractVersion?: string
}

type LaunchTrade = {
  signature: string
  type: 'Buy' | 'Sell'
  time: number
  value: string
  price: string
  amount: string
  trader: string
}

type PoolState = {
  creator: string
  mint: string
  floorSol: number
  liquiditySol: number
  protocolFeeSol: number
  creatorFeeSol: number
  totalSol: number
  floorPriceLamports: number
  athPriceLamports: number
  supply: number
  soldSupply: number
  tradeFeeBps: number
  slopeNumerator: number
  slopeDenominator: number
  initialPriceNumerator: number
  initialPriceDenominator: number
  priceLamports: number
}

const CREATED_LAUNCHES_KEY = 'rise_launchpad_created_launches'
const CURRENT_CONTRACT_VERSION = 'rise-elastic-mint-burn-v1'
const LAMPORTS_PER_SOL_UI = 1_000_000_000
const MAX_RECOMMENDED_TEST_SWAP_LAMPORTS = 100_000_000
const LAUNCH_RULES = {
  launchFeeSol: 0.1,
  floorReserveSol: 0.049,
  liquidityReserveSol: 0.049,
  protocolFeeSol: 0.00125,
  poolTotalSol: 0.09875,
  tradeFeeBps: 125,
  slopeNumerator: 37,
  slopeDenominator: 1_400_000_000_000_000_000,
  initialPriceNumerator: 7,
  initialPriceDenominator: 2,
}

function readCreatedLaunches(): CreatedLaunch[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CREATED_LAUNCHES_KEY)
    return raw ? JSON.parse(raw) as CreatedLaunch[] : []
  } catch {
    return []
  }
}

function writeCreatedLaunches(launches: CreatedLaunch[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CREATED_LAUNCHES_KEY, JSON.stringify(launches.slice(0, 12)))
}

function shortPubkey(value?: string | null) {
  if (!value) return '-'
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function formatSolFromLamports(value: number) {
  return `${(value / LAMPORTS_PER_SOL_UI).toFixed(4)} SOL`
}

function formatSolNumberFromLamports(value: number) {
  return (value / LAMPORTS_PER_SOL_UI).toFixed(4)
}

function trimFixed(value: number, digits = 12) {
  if (!Number.isFinite(value)) return '0'
  return value.toFixed(digits).replace(/\.?0+$/, '')
}

function formatPriceLamports(value: number) {
  return `${trimFixed(value, 12)} lamports`
}

function priceLamportsAtSoldFromParams(
  sold: number,
  slopeNumerator: number,
  slopeDenominator: number,
  initialPriceNumerator: number,
  initialPriceDenominator: number,
) {
  return slopeNumerator * sold / slopeDenominator + initialPriceNumerator / initialPriceDenominator
}

function collateralLamportsAtSoldFromParams(
  sold: number,
  slopeNumerator: number,
  slopeDenominator: number,
  initialPriceNumerator: number,
  initialPriceDenominator: number,
) {
  return slopeNumerator * sold * sold / (2 * slopeDenominator) + initialPriceNumerator * sold / initialPriceDenominator
}

function soldAtCollateralLamportsFromParams(
  targetLamports: number,
  supply: number,
  slopeNumerator: number,
  slopeDenominator: number,
  initialPriceNumerator: number,
  initialPriceDenominator: number,
) {
  let low = 0
  let high = Math.max(1, Math.floor(supply))
  while (low < high) {
    const mid = low + Math.ceil((high - low) / 2)
    if (collateralLamportsAtSoldFromParams(mid, slopeNumerator, slopeDenominator, initialPriceNumerator, initialPriceDenominator) <= targetLamports) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return low
}

function collateralLamportsAtSold(sold: number) {
  const quadratic = LAUNCH_RULES.slopeNumerator * sold * sold / (2 * LAUNCH_RULES.slopeDenominator)
  const linear = LAUNCH_RULES.initialPriceNumerator * sold / LAUNCH_RULES.initialPriceDenominator
  return quadratic + linear
}

function marginalPriceLamports(sold: number) {
  return LAUNCH_RULES.slopeNumerator * sold / LAUNCH_RULES.slopeDenominator +
    LAUNCH_RULES.initialPriceNumerator / LAUNCH_RULES.initialPriceDenominator
}

function soldAtCollateralLamports(targetLamports: number, supply: number) {
  let low = 0
  let high = Math.max(1, Math.floor(supply))
  while (low < high) {
    const mid = low + Math.ceil((high - low) / 2)
    if (collateralLamportsAtSold(mid) <= targetLamports) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return low
}

function buildCurvePoints(supply: string) {
  const parsedSupply = Number(supply || 0)
  const maxSupply = Math.max(1, Number.isFinite(parsedSupply) && parsedSupply > 0 ? parsedSupply : 1_000_000_000)
  const maxSold = Math.max(1, soldAtCollateralLamports(LAUNCH_RULES.poolTotalSol * LAMPORTS_PER_SOL_UI, maxSupply))
  return Array.from({ length: 36 }, (_, index) => {
    const sold = Math.round(maxSold * index / 35)
    return {
      sold,
      collateralSol: collateralLamportsAtSold(sold) / LAMPORTS_PER_SOL_UI,
      priceLamports: marginalPriceLamports(sold),
    }
  })
}

function buildCurvePointsFromPoolState(pool: PoolState) {
  const maxSold = Math.max(1, soldAtCollateralLamportsFromParams(
    Math.max(pool.totalSol, pool.liquiditySol) * LAMPORTS_PER_SOL_UI,
    pool.supply,
    pool.slopeNumerator,
    pool.slopeDenominator,
    pool.initialPriceNumerator,
    pool.initialPriceDenominator,
  ))
  return Array.from({ length: 36 }, (_, index) => {
    const sold = Math.round(maxSold * index / 35)
    return {
      sold,
      collateralSol: collateralLamportsAtSoldFromParams(
        sold,
        pool.slopeNumerator,
        pool.slopeDenominator,
        pool.initialPriceNumerator,
        pool.initialPriceDenominator,
      ) / LAMPORTS_PER_SOL_UI,
      priceLamports: priceLamportsAtSoldFromParams(
        sold,
        pool.slopeNumerator,
        pool.slopeDenominator,
        pool.initialPriceNumerator,
        pool.initialPriceDenominator,
      ),
    }
  })
}

async function fetchPoolState(connection: Connection, launch: CreatedLaunch): Promise<PoolState> {
  const account = await connection.getAccountInfo(new PublicKey(launch.pool), 'confirmed')
  if (!account) throw new Error('Pool account not found on current RPC. This cached launch may be stale.')

  const data = account.data
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const readU64 = (offset: number) => Number(view.getBigUint64(offset, true))
  const readPubkey = (offset: number) => new PublicKey(data.slice(offset, offset + 32)).toBase58()

  let offset = 8
  const creator = readPubkey(offset); offset += 32
  const mint = readPubkey(offset); offset += 32
  const floorSol = readU64(offset) / LAMPORTS_PER_SOL_UI; offset += 8
  const liquiditySol = readU64(offset) / LAMPORTS_PER_SOL_UI; offset += 8
  const protocolFeeSol = readU64(offset) / LAMPORTS_PER_SOL_UI; offset += 8
  const creatorFeeSol = readU64(offset) / LAMPORTS_PER_SOL_UI; offset += 8
  const totalSol = readU64(offset) / LAMPORTS_PER_SOL_UI; offset += 8
  const floorPriceLamports = readU64(offset); offset += 8
  const athPriceLamports = readU64(offset); offset += 8
  const supply = readU64(offset); offset += 8
  const soldSupply = readU64(offset); offset += 8
  const tradeFeeBps = readU64(offset); offset += 8
  offset += 8 * 3
  const slopeNumerator = readU64(offset); offset += 8
  const slopeDenominator = readU64(offset); offset += 8
  const initialPriceNumerator = readU64(offset); offset += 8
  const initialPriceDenominator = readU64(offset)

  if (mint !== launch.mint) {
    throw new Error('Cached launch mint does not match on-chain pool mint. Please recreate this launch.')
  }

  const priceLamports = priceLamportsAtSoldFromParams(
    soldSupply,
    slopeNumerator,
    slopeDenominator,
    initialPriceNumerator,
    initialPriceDenominator,
  )

  return {
    creator,
    mint,
    floorSol,
    liquiditySol,
    protocolFeeSol,
    creatorFeeSol,
    totalSol,
    floorPriceLamports,
    athPriceLamports,
    supply,
    soldSupply,
    tradeFeeBps,
    slopeNumerator,
    slopeDenominator,
    initialPriceNumerator,
    initialPriceDenominator,
    priceLamports,
  }
}

type NavView = 'discover' | 'create' | 'portfolio' | 'simulator' | 'ai'
type AppView = NavView | 'token'

/* ============================================================
 * App
 * ============================================================ */
export default function App() {
  const [view, setView] = useState<AppView>('discover')
  const [selectedLaunch, setSelectedLaunch] = useState<CreatedLaunch | null>(null)
  const network = WalletAdapterNetwork.Devnet
  const endpoint = useMemo(() => import.meta.env.VITE_SOLANA_RPC_URL || clusterApiUrl(network), [network])
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
  ], [])

  useEffect(() => {
    document.documentElement.classList.add('dark')
    document.body.style.background = theme.bg
    document.body.style.color = theme.text
  }, [])

  const navigate = (nextView: NavView) => {
    setView(nextView)
  }

  const openLaunch = (launch: CreatedLaunch) => {
    setSelectedLaunch(launch)
    setView('token')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const updateSelectedLaunch = (launch: CreatedLaunch) => {
    setSelectedLaunch(launch)
    const launches = readCreatedLaunches()
    writeCreatedLaunches([launch, ...launches.filter((item) => item.pool !== launch.pool)])
  }

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div
            className="min-h-screen overflow-x-hidden"
            style={{
              background:
                `radial-gradient(circle at top center, rgba(240, 185, 11, 0.16), transparent 26%),` +
                `radial-gradient(circle at 22% 0%, rgba(252, 213, 53, 0.10), transparent 18%), ${theme.bg}`,
              color: theme.text,
            }}
          >
            <TopNav activeView={view === 'token' ? 'discover' : view} onNavigate={navigate} />
            <main>
              {view === 'discover' && (
                <>
                  <AnnouncementBar />
                  <LatestSection onOpenLaunch={openLaunch} />
                  <VerifiedSection />
                  <HotSection />
                </>
              )}
              {view === 'token' && selectedLaunch && (
                <TokenDetailWorkbench
                  launch={selectedLaunch}
                  onBack={() => setView('discover')}
                  onLaunchUpdate={updateSelectedLaunch}
                />
              )}
              {view === 'create' && <CreateTokenWorkbench />}
              {view === 'portfolio' && <PortfolioWorkbench />}
              {view === 'simulator' && <SimulatorWorkbench />}
              {view === 'ai' && <AiSkillsWorkbench />}
            </main>
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

/* ============================================================
 * TopNav
 * ============================================================ */
function TopNav({
  activeView,
  onNavigate,
}: {
  activeView: NavView
  onNavigate: (view: NavView) => void
}) {
  const navButton = (view: typeof activeView, label: string) => (
    <button
      className="transition-colors hover:text-white"
      style={{ color: activeView === view ? theme.accent : undefined }}
      onClick={() => onNavigate(view)}
    >
      {label}
    </button>
  )

  return (
    <header
      className="sticky top-0 z-50 border-b backdrop-blur-xl"
      style={{ borderColor: theme.borderSoft, background: 'rgba(11, 13, 20, 0.9)' }}
    >
      <div className="mx-auto grid h-[78px] max-w-[1540px] grid-cols-[auto_1fr_auto] items-center gap-6 px-5">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <RiseLogo />
            <span
              className="inline-flex h-8 items-center rounded-full border px-3 text-sm font-semibold"
              style={{
                borderColor: 'rgba(240, 185, 11, 0.22)',
                background: 'linear-gradient(180deg, rgba(43, 45, 63, 0.84), rgba(28, 30, 44, 0.92))',
                color: theme.accent,
              }}
            >
              {T.beta}
            </span>
          </div>

          <nav className="hidden items-center gap-10 text-[15px] font-semibold lg:flex" style={{ color: theme.textSoft }}>
            {navButton('create', T.createToken)}
            {navButton('discover', T.discover)}
            {navButton('portfolio', T.portfolio)}
          </nav>
        </div>

        <div className="hidden justify-center lg:flex">
          <label
            className="flex h-11 w-full max-w-[404px] items-center gap-3 rounded-[16px] border px-4"
            style={{ borderColor: theme.border, background: 'rgba(24, 28, 40, 0.96)' }}
          >
            <Search size={17} style={{ color: theme.accent }} />
            <input
              aria-label={T.search}
              className="w-full bg-transparent text-[15px] outline-none placeholder:text-[#7e8598]"
              placeholder={T.search}
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-3">
          <nav className="hidden items-center gap-10 text-[15px] font-semibold xl:flex" style={{ color: theme.textSoft }}>
            {navButton('simulator', T.simulator)}
            {navButton('ai', 'AI Skills')}
            <button className="transition-colors hover:text-white" onClick={() => onNavigate('discover')}>{T.faq}</button>
          </nav>

          <IconButton label={T.docs} onClick={() => onNavigate('ai')}><BookOpen size={18} /></IconButton>
          <PillButton>EN</PillButton>
          <IconButton label="X"><X size={18} /></IconButton>
          <IconButton label="Telegram"><Send size={17} /></IconButton>
          <WalletAuthButton />
        </div>
      </div>
    </header>
  )
}

/* ============================================================
 * Announcement bar
 * ============================================================ */
function AnnouncementBar() {
  return (
    <section className="mx-auto max-w-[1540px] px-5 pt-8">
      <div
        className="flex min-h-[58px] items-center justify-between rounded-[16px] px-6 text-center text-[17px] font-bold"
        style={{
          background: `linear-gradient(90deg, ${theme.accent} 0%, ${theme.accentSoft} 100%)`,
          color: '#10131c',
        }}
      >
        <span className="flex-1">
          $GOLDING 交易 6 倍积分，限时 48 小时！其他 GOLD 代币交易 3 倍积分，持续至 5 月 10 日，更快累积奖励！
        </span>
        <button className="ml-4 text-[28px] leading-none opacity-70 transition-opacity hover:opacity-100" aria-label={T.close}>
          ×
        </button>
      </div>
    </section>
  )
}

/* ============================================================
 * Latest Section — card row of newest launches
 * ============================================================ */
function LatestSection({ onOpenLaunch }: { onOpenLaunch: (launch: CreatedLaunch) => void }) {
  const [createdLaunches, setCreatedLaunches] = useState<CreatedLaunch[]>(() => readCreatedLaunches())
  const { data, isLoading } = useQuery<{ data: TokenItem[] }>({
    queryKey: ['latest'],
    queryFn: () => fetch(api('tokens?limit=4&sort_by=market_cap')).then((r) => r.json()),
  })

  useEffect(() => {
    const refresh = () => setCreatedLaunches(readCreatedLaunches())
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const localItems = createdLaunches.slice(0, 4)
  const remoteItems = (data?.data ?? [])
    .filter((t) => t.symbol)
    .slice(0, Math.max(0, 4 - localItems.length))
  const cardSlots = [
    ...localItems.map((launch) => ({ kind: 'created' as const, launch })),
    ...remoteItems.map((token, index) => ({ kind: 'remote' as const, token, index })),
  ].slice(0, 4)
  const skeletonCount = isLoading && cardSlots.length < 4 ? 4 - cardSlots.length : 0

  return (
    <section className="mx-auto max-w-[1540px] px-5 pt-8">
      <SectionHeading
        title={T.latest}
        right={
          <div className="hidden items-center gap-3 md:flex">
            <ArrowShell><ChevronLeft size={20} /></ArrowShell>
            <ArrowShell><ChevronRight size={20} /></ArrowShell>
          </div>
        }
      />

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cardSlots.map((slot) => {
          if (slot.kind === 'created') {
            return <CreatedLatestCard key={`created:${slot.launch.pool}`} launch={slot.launch} onOpen={onOpenLaunch} />
          }

          const t = slot.token
          const [from, to, accent] = colorsFor(t.symbol)
          const art = t.image || buildTokenArt(t.symbol, from, to, accent)
          return (
            <article
              key={`remote:${t.symbol}:${slot.index}`}
              className="overflow-hidden rounded-[22px] border"
              style={{ borderColor: theme.border, background: theme.panelSoft }}
            >
              <div className="relative h-[234px] overflow-hidden">
                <img src={art} alt={t.name} className="h-full w-full object-cover" />
                <div
                  className="absolute inset-0"
                  style={{ background: 'linear-gradient(180deg, rgba(8, 10, 14, 0) 22%, rgba(8, 10, 14, 0.18) 56%, rgba(8, 10, 14, 0.92) 100%)' }}
                />
                <div
                  className="absolute right-4 top-4 rounded-md px-2 py-1 text-xs font-semibold"
                  style={{ background: 'rgba(20, 23, 32, 0.8)', color: '#cfd4e6' }}
                >
                  {ago(slot.index)}
                </div>
                <div className="absolute left-4 right-4 bottom-4 flex items-end justify-between gap-3">
                  <div className="text-[18px] font-extrabold tracking-tight text-white">{fmtUSD(t.price_usd)}</div>
                  <ChainMark />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold" style={{ color: theme.textSoft }}>{t.name}</div>
                  <div
                    className="mt-1 inline-flex items-center rounded-md border px-2 py-1 text-[12px]"
                    style={{ borderColor: theme.border, color: '#9fb0d8' }}
                  >
                    {t.symbol}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[12px]" style={{ color: theme.muted }}>{T.floor}</div>
                  <div className="text-[15px] font-bold" style={{ color: theme.accent }}>
                    {fmtUSD(t.price_usd * 0.55)}
                  </div>
                </div>
              </div>
            </article>
          )
        })}
        {skeletonCount > 0
          ? Array.from({ length: skeletonCount }).map((_, i) => (
              <div key={i} className="h-[330px] rounded-[22px] animate-pulse"
                   style={{ background: theme.panelSoft, border: `1px solid ${theme.border}` }} />
            ))
          : null}
      </div>
    </section>
  )
}

function CreatedLatestCard({ launch, onOpen }: { launch: CreatedLaunch; onOpen: (launch: CreatedLaunch) => void }) {
  const [from, to, accent] = colorsFor(launch.symbol || launch.name)
  const art = buildTokenArt(launch.symbol || launch.name, from, to, accent)
  const chart = useMemo(() => buildCurvePoints(launch.supply), [launch.supply])
  const maxCollateral = Math.max(...chart.map((point) => point.collateralSol), 0.000001)
  const polyline = chart.map((point, index) => {
    const x = 12 + index * (216 / Math.max(chart.length - 1, 1))
    const y = 74 - (point.collateralSol / maxCollateral) * 52
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
  const explorer = `https://explorer.solana.com/address/${launch.mint}?cluster=${launch.cluster}`

  return (
    <article
      className="cursor-pointer overflow-hidden rounded-[22px] border transition-transform hover:-translate-y-1"
      style={{ borderColor: theme.border, background: theme.panelSoft }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(launch)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen(launch)
      }}
    >
      <div className="relative h-[190px] overflow-hidden">
        <img src={art} alt={launch.name} className="h-full w-full object-cover" />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(8, 10, 14, 0.04) 0%, rgba(8, 10, 14, 0.3) 50%, rgba(8, 10, 14, 0.94) 100%)' }}
        />
        <div
          className="absolute right-4 top-4 rounded-md px-2 py-1 text-xs font-bold"
          style={{ background: 'rgba(240, 185, 11, 0.94)', color: '#10131c' }}
        >
          Created
        </div>
        <div className="absolute left-4 right-4 bottom-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[18px] font-extrabold text-white">{launch.name}</div>
            <div className="mt-1 text-xs font-semibold" style={{ color: '#cfd4e6' }}>{launch.symbol} 路 {shortPubkey(launch.mint)}</div>
          </div>
          <ChainMark />
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="rounded-[10px] border p-3" style={{ borderColor: theme.borderSoft, background: '#0f131d' }}>
          <div className="mb-1 flex items-center justify-between text-xs font-bold">
            <span style={{ color: theme.accent }}>Bonding Curve</span>
            <span style={{ color: theme.textSoft }}>Pool {LAUNCH_RULES.poolTotalSol} SOL</span>
          </div>
          <svg viewBox="0 0 240 84" className="h-[84px] w-full" role="img" aria-label={`${launch.symbol} bonding curve`}>
            <line x1="12" y1="74" x2="230" y2="74" stroke="#2b3142" strokeWidth="1" />
            <line x1="12" y1="16" x2="12" y2="74" stroke="#2b3142" strokeWidth="1" />
            <polyline points={polyline} fill="none" stroke={theme.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="flex items-center justify-between text-xs" style={{ color: theme.textSoft }}>
            <span>Floor {LAUNCH_RULES.floorReserveSol} SOL</span>
            <a
              className="font-bold hover:text-white"
              href={explorer}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              Explorer
            </a>
          </div>
        </div>
      </div>
    </article>
  )
}

/* ============================================================
 * Verified Section — featured project cards
 * ============================================================ */
function TokenDetailWorkbench({
  launch,
  onBack,
  onLaunchUpdate,
}: {
  launch: CreatedLaunch
  onBack: () => void
  onLaunchUpdate: (launch: CreatedLaunch) => void
}) {
  const { connection } = useConnection()
  const [from, to, accent] = colorsFor(launch.symbol || launch.name)
  const art = buildTokenArt(launch.symbol || launch.name, from, to, accent)
  const [poolState, setPoolState] = useState<PoolState | null>(null)
  const [poolStatus, setPoolStatus] = useState('Syncing pool...')
  const chart = useMemo(() => poolState ? buildCurvePointsFromPoolState(poolState) : buildCurvePoints(launch.supply), [poolState, launch.supply])
  const currentPriceLamports = poolState?.priceLamports ?? launch.currentPriceLamports ?? marginalPriceLamports(0)
  const currentFloorSol = poolState?.floorSol ?? launch.currentFloorSol ?? LAUNCH_RULES.floorReserveSol
  const currentFloorPriceLamports = poolState?.floorPriceLamports ?? 0
  const currentLiquiditySol = poolState?.liquiditySol ?? launch.currentLiquiditySol ?? LAUNCH_RULES.liquidityReserveSol
  const currentPoolTotalSol = poolState?.totalSol ?? LAUNCH_RULES.poolTotalSol
  const currentSupply = poolState?.supply ?? Number(launch.supply || 0)
  const marketCapSol = Number.isFinite(currentSupply) ? currentPriceLamports * currentSupply / LAMPORTS_PER_SOL_UI : 0

  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      try {
        const next = await fetchPoolState(connection, launch)
        if (cancelled) return
        setPoolState(next)
        setPoolStatus(`Live pool: ${next.soldSupply.toLocaleString()} sold`)
      } catch (error) {
        if (cancelled) return
        setPoolStatus(error instanceof Error ? error.message : 'Pool sync failed')
      }
    }
    sync()
    const timer = window.setInterval(sync, 8000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [connection, launch])

  return (
    <section className="mx-auto max-w-[1840px] px-5 py-5">
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <aside className="rounded-[8px] border p-5" style={{ borderColor: theme.border, background: theme.panel }}>
          <button className="mb-5 text-sm font-bold hover:text-white" style={{ color: theme.textSoft }} onClick={onBack}>
            Back to Discover
          </button>

          <div className="flex items-start gap-4">
            <img src={art} alt={launch.name} className="h-24 w-24 rounded-[18px] border object-cover" style={{ borderColor: theme.border }} />
            <div className="min-w-0 pt-1">
              <div className="truncate text-lg font-black">{launch.name}</div>
              <div className="mt-1 text-sm font-bold" style={{ color: theme.accent }}>{launch.symbol}</div>
              <div className="mt-2 text-xs" style={{ color: theme.muted }}>{shortPubkey(launch.mint)}</div>
            </div>
          </div>

          <div className="mt-7 border-t pt-6" style={{ borderColor: theme.border }}>
            <div className="text-3xl font-black">{formatPriceLamports(currentPriceLamports)}</div>
            <div className="mt-1 text-xs" style={{ color: theme.muted }}>
              {(currentPriceLamports / LAMPORTS_PER_SOL_UI).toExponential(6)} SOL
            </div>
            <div className="mt-2 text-sm font-bold" style={{ color: poolState ? theme.success : theme.muted }}>{poolStatus}</div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2">
            <DetailMetric label="Market Cap" value={`${marketCapSol.toFixed(4)} SOL`} />
            <DetailMetric label="Floor Price" value={formatPriceLamports(currentFloorPriceLamports)} accent />
            <DetailMetric label="Floor Reserve" value={`${currentFloorSol.toFixed(6)} SOL`} accent />
            <DetailMetric label="Liquidity" value={`${currentLiquiditySol.toFixed(6)} SOL`} />
            <DetailMetric label="Pool Total" value={`${currentPoolTotalSol.toFixed(6)} SOL`} />
            <DetailMetric label="Protocol Fee" value={`${(poolState?.protocolFeeSol ?? LAUNCH_RULES.protocolFeeSol).toFixed(6)} SOL`} />
            <DetailMetric label="Trade Fee" value={`${(poolState?.tradeFeeBps ?? LAUNCH_RULES.tradeFeeBps) / 100}%`} />
          </div>

          <div className="mt-6 grid gap-3 border-t pt-5 text-xs" style={{ borderColor: theme.border, color: theme.textSoft }}>
            <div className="flex justify-between gap-3"><span style={{ color: theme.muted }}>Mint</span><span>{shortPubkey(launch.mint)}</span></div>
            <div className="flex justify-between gap-3"><span style={{ color: theme.muted }}>Pool</span><span>{shortPubkey(launch.pool)}</span></div>
            <div className="flex justify-between gap-3"><span style={{ color: theme.muted }}>Supply</span><span>Elastic mint/burn</span></div>
            <div className="flex justify-between gap-3"><span style={{ color: theme.muted }}>Cluster</span><span>{launch.cluster}</span></div>
          </div>
        </aside>

        <div className="grid gap-5">
          <div className="rounded-[8px] border" style={{ borderColor: theme.border, background: '#0f131d' }}>
            <div className="flex flex-col gap-3 border-b px-5 py-4 md:flex-row md:items-center md:justify-between" style={{ borderColor: theme.border }}>
              <div className="flex flex-wrap items-center gap-6">
                <DetailMetric label="Price" value={formatPriceLamports(currentPriceLamports)} />
                <DetailMetric label="Floor Price" value={formatPriceLamports(currentFloorPriceLamports)} accent />
                <DetailMetric label="Floor Reserve" value={`${currentFloorSol.toFixed(6)} SOL`} accent />
                <DetailMetric label="Liquidity" value={`${currentLiquiditySol.toFixed(6)} SOL`} />
                <DetailMetric label="Protocol Fee" value={`${(poolState?.protocolFeeSol ?? LAUNCH_RULES.protocolFeeSol).toFixed(6)} SOL`} />
                <DetailMetric label="Pool Total" value={`${currentPoolTotalSol.toFixed(6)} SOL`} />
              </div>
              <div className="flex items-center gap-2 text-sm font-bold" style={{ color: theme.textSoft }}>
                {['1m', '5m', '1h', '1d'].map((label, index) => (
                  <span
                    key={label}
                    className="rounded-full border px-3 py-1"
                    style={{
                      borderColor: index === 2 ? theme.accent : 'transparent',
                      color: index === 2 ? theme.accent : theme.textSoft,
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <TokenCurveChart chart={chart} soldSupply={poolState?.soldSupply ?? Number(launch.currentSoldSupply || 0)} />
          </div>

          <div className="rounded-[8px] border" style={{ borderColor: theme.border, background: theme.panel }}>
            <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: theme.border }}>
              <h2 className="text-xl font-black">Transactions</h2>
              <span className="text-sm font-bold" style={{ color: theme.success }}>Live</span>
            </div>
            <TradeHistoryTable launch={launch} />
          </div>
        </div>

        <TokenSwapPanel launch={launch} onLaunchUpdate={onLaunchUpdate} />
      </div>
    </section>
  )
}

function TokenCurveChart({ chart, soldSupply }: { chart: ReturnType<typeof buildCurvePoints>; soldSupply?: number }) {
  const prices = chart.map((point) => point.priceLamports)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const rawPriceRange = maxPrice - minPrice
  const priceRange = rawPriceRange === 0 ? Math.max(maxPrice * 0.01, 1) : rawPriceRange
  const toY = (priceLamports: number) => 360 - ((priceLamports - minPrice) / priceRange) * 286
  const polyline = chart.map((point, index) => {
    const x = 48 + index * (1000 / Math.max(chart.length - 1, 1))
    const y = toY(point.priceLamports)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
  const firstPoint = chart[0]
  const lastPoint = chart[chart.length - 1]
  const currentRatio = soldSupply && lastPoint.sold > 0 ? Math.min(Math.max(soldSupply / lastPoint.sold, 0), 1) : 0
  const currentX = 48 + currentRatio * 1000
  const currentPrice = soldSupply
    ? firstPoint.priceLamports + (lastPoint.priceLamports - firstPoint.priceLamports) * currentRatio
    : firstPoint.priceLamports
  const currentY = toY(currentPrice)

  return (
    <div className="h-[430px] px-4 py-4">
      <svg viewBox="0 0 1120 390" className="h-full w-full" role="img" aria-label="Bonding curve chart">
        {Array.from({ length: 9 }).map((_, index) => (
          <line key={`v-${index}`} x1={48 + index * 125} y1="34" x2={48 + index * 125} y2="360" stroke="#202536" strokeWidth="1" />
        ))}
        {Array.from({ length: 7 }).map((_, index) => (
          <line key={`h-${index}`} x1="48" y1={34 + index * 54} x2="1060" y2={34 + index * 54} stroke="#202536" strokeWidth="1" />
        ))}
        <path d={`M48 360 L ${polyline} L 1060 360 Z`} fill="rgba(240, 185, 11, 0.10)" />
        <polyline points={polyline} fill="none" stroke={theme.success} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {soldSupply ? (
          <>
            <line x1={currentX} y1="34" x2={currentX} y2="360" stroke={theme.accent} strokeWidth="2" strokeDasharray="5 6" />
            <circle cx={currentX} cy={currentY} r="6" fill={theme.accent} />
          </>
        ) : null}
        <text x="50" y="24" fill="#8f95a8" fontSize="13">Price curve, auto-zoomed lamports/token</text>
        <text x="848" y="24" fill="#d0d5e6" fontSize="13">{formatPriceLamports(lastPoint.priceLamports)}</text>
        <text x="50" y="382" fill="#8f95a8" fontSize="13">Start</text>
        <text x="92" y="382" fill="#d0d5e6" fontSize="13">{formatPriceLamports(firstPoint.priceLamports)}</text>
        <text x="892" y="382" fill="#8f95a8" fontSize="13">{soldSupply ? `${soldSupply.toLocaleString()} sold` : 'Curve Supply'}</text>
      </svg>
    </div>
  )
}

function TradeHistoryTable({ launch }: { launch: CreatedLaunch }) {
  const rows = [
    {
      time: new Date(launch.createdAt).toLocaleTimeString(),
      type: 'Create',
      value: `${LAUNCH_RULES.launchFeeSol} SOL`,
      price: `${(LAUNCH_RULES.initialPriceNumerator / LAUNCH_RULES.initialPriceDenominator).toFixed(2)} lamports`,
      amount: Number(launch.supply || 0).toLocaleString(),
      trader: 'Creator',
      tx: launch.signature,
    },
    ...(launch.trades || []).slice().reverse().map((trade) => ({
      time: new Date(trade.time).toLocaleTimeString(),
      type: trade.type,
      value: trade.value,
      price: trade.price,
      amount: trade.amount,
      trader: trade.trader,
      tx: trade.signature,
    })),
  ]

  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead style={{ color: theme.muted }}>
          <tr>
            {['Time', 'Type', 'Value', 'Price', 'Amount', 'Trader', 'Tx'].map((head) => (
              <th key={head} className="px-5 py-3 font-bold">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.type}:${row.tx}`} className="border-t" style={{ borderColor: theme.borderSoft }}>
              <td className="px-5 py-4" style={{ color: theme.textSoft }}>{row.time}</td>
              <td className="px-5 py-4">
                <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: 'rgba(31, 218, 103, 0.12)', color: theme.success }}>
                  {row.type}
                </span>
              </td>
              <td className="px-5 py-4 font-bold" style={{ color: theme.success }}>{row.value}</td>
              <td className="px-5 py-4" style={{ color: '#52a8ff' }}>{row.price}</td>
              <td className="px-5 py-4" style={{ color: theme.textSoft }}>{row.amount}</td>
              <td className="px-5 py-4" style={{ color: theme.textSoft }}>{row.trader}</td>
              <td className="px-5 py-4">
                <a
                  href={`https://explorer.solana.com/tx/${row.tx}?cluster=${launch.cluster}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold hover:text-white"
                  style={{ color: '#ffb7c5' }}
                >
                  {shortPubkey(row.tx)}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TokenSwapPanel({
  launch,
  onLaunchUpdate,
}: {
  launch: CreatedLaunch
  onLaunchUpdate: (launch: CreatedLaunch) => void
}) {
  const { connection } = useConnection()
  const wallet = useWallet()
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy')
  const [amountIn, setAmountIn] = useState('10000000')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('Ready')

  async function submitSwap() {
    setLoading(true)
    setMessage('Building transaction...')
    try {
      if (launch.contractVersion !== CURRENT_CONTRACT_VERSION) {
        throw new Error('This token is from an old cached deploy. Please create a new token, then test buy/sell on the new token.')
      }
      if (!wallet.publicKey) throw new Error('Connect wallet first')
      const parsedAmount = BigInt(amountIn.trim())
      if (parsedAmount <= 0n) throw new Error('Swap amount must be greater than 0')

      if (direction === 'buy') {
        const balance = await connection.getBalance(wallet.publicKey, 'confirmed')
        const requested = Number(parsedAmount)
        if (parsedAmount > BigInt(Math.max(0, balance - 5_000_000))) {
          throw new Error(`Wallet balance is ${formatSolNumberFromLamports(balance)} SOL, but this buy requests ${formatSolNumberFromLamports(requested)} SOL. Use 10000000 lamports for a 0.01 SOL test buy.`)
        }
        if (parsedAmount > BigInt(MAX_RECOMMENDED_TEST_SWAP_LAMPORTS)) {
          throw new Error('This is a 0.1 SOL test pool. Use 10000000-100000000 lamports for now; 10000000000 lamports is 10 SOL.')
        }
      }

      const result = await sendAnchorSwap(connection, wallet, {
        pool: launch.pool,
        mint: launch.mint,
        poolTokenVault: launch.poolTokenVault,
        traderTokenAccount: launch.traderTokenAccount,
        direction,
        amountIn,
        minOut: direction === 'buy' ? 1 : 0,
      })
      const nextPool = await fetchPoolState(connection, launch).catch(() => null)
      const trade: LaunchTrade = {
        signature: result.signature,
        type: direction === 'buy' ? 'Buy' : 'Sell',
        time: Date.now(),
        value: direction === 'buy'
          ? `${formatSolNumberFromLamports(Number(result.amountIn || amountIn))} SOL`
          : `${result.amountIn || amountIn} tokens`,
        price: nextPool ? formatPriceLamports(nextPool.priceLamports) : 'Curve',
        amount: direction === 'buy' ? '-' : `${formatSolNumberFromLamports(Number(result.amountIn || amountIn))} SOL`,
        trader: shortPubkey(wallet.publicKey?.toBase58()),
      }
      const updated = {
        ...launch,
        lastSwapSignature: result.signature,
        lastSwapAmountIn: result.amountIn,
        traderTokenAccount: result.traderTokenAccount || launch.traderTokenAccount,
        trades: [...(launch.trades || []), trade].slice(-50),
        ...(nextPool ? {
          currentSoldSupply: String(nextPool.soldSupply),
          currentPriceLamports: nextPool.priceLamports,
          currentFloorSol: nextPool.floorSol,
          currentLiquiditySol: nextPool.liquiditySol,
        } : {}),
      }
      onLaunchUpdate(updated)
      setMessage(`Swap sent: ${shortPubkey(result.signature)}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Swap failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <aside className="rounded-[8px] border p-5" style={{ borderColor: theme.border, background: theme.panel }}>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-black">Swap</h2>
        <span className="text-xs font-bold" style={{ color: theme.muted }}>{launch.cluster}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-[8px] border p-1" style={{ borderColor: theme.border, background: '#0f131d' }}>
        {(['buy', 'sell'] as const).map((item) => (
          <button
            key={item}
            className="h-10 rounded-[6px] text-sm font-black capitalize"
            style={{
              background: direction === item ? theme.accent : 'transparent',
              color: direction === item ? '#10131c' : theme.textSoft,
            }}
            onClick={() => setDirection(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <label className="mt-5 grid gap-2 text-sm font-bold" style={{ color: theme.textSoft }}>
        {direction === 'buy' ? 'Pay SOL Lamports' : 'Sell Token Base Units'}
        <input
          className="h-14 rounded-[8px] border px-4 text-lg font-black outline-none"
          style={{ borderColor: theme.border, background: '#111520', color: theme.text }}
          value={amountIn}
          onChange={(event) => setAmountIn(event.target.value)}
        />
        {direction === 'buy' && (
          <span className="text-xs" style={{ color: theme.muted }}>
            10000000 = 0.01 SOL. Current test pool recommends max 100000000 lamports.
          </span>
        )}
      </label>

      <div className="mt-5 rounded-[8px] border p-4 text-sm" style={{ borderColor: theme.borderSoft, background: '#0f131d' }}>
        <div className="flex justify-between"><span style={{ color: theme.muted }}>Receive</span><span>{direction === 'buy' ? launch.symbol : 'SOL'}</span></div>
        <div className="mt-3 flex justify-between"><span style={{ color: theme.muted }}>Fee</span><span>{LAUNCH_RULES.tradeFeeBps / 100}%</span></div>
        <div className="mt-3 flex justify-between"><span style={{ color: theme.muted }}>Min Out</span><span>{direction === 'buy' ? '1' : '0'}</span></div>
      </div>

      <PrimaryAction disabled={loading} onClick={submitSwap} icon={<Send size={18} />}>
        {loading ? 'Swapping...' : `Send ${direction} swap`}
      </PrimaryAction>

      <div className="mt-4 min-h-16 rounded-[8px] border p-3 text-xs leading-5" style={{ borderColor: theme.borderSoft, color: theme.textSoft, background: '#0f131d' }}>
        {message}
      </div>
    </aside>
  )
}

function DetailMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs font-bold" style={{ color: theme.muted }}>{label}</div>
      <div className="mt-1 text-sm font-black" style={{ color: accent ? theme.accent : theme.text }}>{value}</div>
    </div>
  )
}

function VerifiedSection() {
  const { data, isLoading } = useQuery<{ data: TokenItem[] }>({
    queryKey: ['verified'],
    queryFn: () => fetch(api('tokens?limit=6&sort_by=volume')).then((r) => r.json()),
  })
  const items = (data?.data ?? []).filter((t) => t.symbol).slice(0, 3)

  return (
    <section className="mx-auto max-w-[1540px] px-5 pt-20">
      <SectionHeading
        title={T.verified}
        titleExtra={<VerifiedBadge />}
        subtitle={T.verifiedDesc}
      />

      <div className="mt-10 grid gap-8 xl:grid-cols-3">
        {isLoading || items.length === 0
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[480px] rounded-[28px] animate-pulse"
                   style={{ background: theme.panel, border: `1px solid ${theme.border}` }} />
            ))
          : items.map((t, i) => {
              const [from, to, accent] = colorsFor(t.symbol)
              const art = t.image || buildTokenArt(t.symbol, from, to, accent)
              return (
                <article
                  key={t.symbol}
                  className="rounded-[28px] border px-7 pb-6 pt-5"
                  style={{ borderColor: theme.border, background: theme.panel }}
                >
                  <div className="flex items-center justify-end gap-5 text-[15px]" style={{ color: '#a7acbc' }}>
                    <span className="inline-flex items-center gap-2">
                      <Users size={15} />
                      {(140 + i * 80 + (t.symbol.charCodeAt(0) % 220)).toString()}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <CalendarDays size={15} />
                      {weeksAgo(i)}
                    </span>
                  </div>

                  <div
                    className="relative mx-auto mt-16 flex h-[214px] w-[214px] items-center justify-center overflow-hidden rounded-[24px] border"
                    style={{ borderColor: 'rgba(240, 185, 11, 0.28)' }}
                  >
                    <img src={art} alt={t.name} className="h-full w-full object-cover" />
                    <div className="absolute bottom-3 right-3">
                      <ChainMark />
                    </div>
                  </div>

                  <div className="mt-16 flex items-end justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-4">
                      <img
                        src={art}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-full border object-cover"
                        style={{ borderColor: 'rgba(255, 255, 255, 0.12)' }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[18px] font-extrabold">
                          <span className="truncate">{t.name}</span>
                          <VerifiedBadge />
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[13px] font-semibold" style={{ color: theme.accent }}>
                          <span
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold"
                            style={{ background: 'rgba(240, 185, 11, 0.20)', color: theme.accent }}
                          >
                            $
                          </span>
                          <span>{t.symbol}</span>
                          <Copy size={14} style={{ color: '#aeb2c3' }} />
                        </div>
                      </div>
                    </div>

                    <div
                      className="inline-flex h-10 items-center rounded-full border px-4 text-[14px] font-semibold"
                      style={{ borderColor: theme.border, background: '#161b28', color: '#b8bfce' }}
                    >
                      BNB
                    </div>
                  </div>

                  <div className="mt-5 border-t pt-6" style={{ borderColor: theme.border }}>
                    <div className="grid grid-cols-3 gap-4">
                      <StatCell label={T.price} value={fmtUSD(t.price_usd)} />
                      <StatCell label={T.marketCap} value={fmtUSD(t.market_cap_usd)} />
                      <StatCell label={T.floor} value={fmtUSD(t.price_usd * 0.55)} accent />
                    </div>
                  </div>
                </article>
              )
            })}
      </div>

      <div className="mt-8 flex items-center justify-center gap-3">
        {Array.from({ length: 10 }).map((_, index) => (
          <span
            key={index}
            className="h-2.5 w-2.5 rounded-full"
            style={{
              background: index === 6 ? theme.accent : '#202536',
              boxShadow: index === 6 ? '0 0 0 2px rgba(240, 185, 11, 0.18)' : 'none',
            }}
          />
        ))}
      </div>
    </section>
  )
}

/* ============================================================
 * Hot Section — three columns
 * ============================================================ */
function HotSection() {
  const { data: byVol } = useQuery<{ data: TokenItem[] }>({
    queryKey: ['hot-vol'],
    queryFn: () => fetch(api('tokens?limit=8&sort_by=volume')).then((r) => r.json()),
  })
  const { data: byMc } = useQuery<{ data: TokenItem[] }>({
    queryKey: ['hot-mc'],
    queryFn: () => fetch(api('tokens?limit=8&sort_by=market_cap')).then((r) => r.json()),
  })
  const { data: byMove } = useQuery<{ data: TokenItem[] }>({
    queryKey: ['hot-move'],
    queryFn: () => fetch(api('gainers?limit=8')).then((r) => r.json()),
  })

  return (
    <section className="mx-auto max-w-[1540px] px-5 pb-20 pt-24">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <h2 className="text-[clamp(34px,3vw,48px)] font-black tracking-tight">{T.hot}</h2>
        <div
          className="inline-flex h-14 items-center rounded-[16px] border p-1"
          style={{ borderColor: theme.border, background: '#171b28' }}
        >
          {['24h', '7d', '30d'].map((label, index) => (
            <button
              key={label}
              className="rounded-xl px-5 py-2 text-[15px] font-bold"
              style={{
                background: index === 0 ? '#202536' : 'transparent',
                color: index === 0 ? '#ffffff' : '#9ca3b7',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="mt-7 overflow-hidden rounded-[18px] border"
        style={{ borderColor: theme.border, background: theme.panel }}
      >
        <div className="grid xl:grid-cols-3">
          <HotColumn title={T.volumeTop} items={byVol?.data} />
          <HotColumn title={T.active} items={byMc?.data} bordered />
          <HotColumn title={T.gainer} items={byMove?.data} bordered />
        </div>
      </div>
    </section>
  )
}

function HotColumn({
  title,
  items,
  bordered,
}: {
  title: string
  items?: TokenItem[]
  bordered?: boolean
}) {
  const list = (items ?? []).filter((t) => t.symbol).slice(0, 7)
  return (
    <div className={bordered ? 'border-l' : ''} style={bordered ? { borderColor: theme.border } : undefined}>
      <div
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: theme.border, background: 'rgba(255, 255, 255, 0.01)' }}
      >
        <span className="text-[16px] font-extrabold">{title}</span>
        <span className="text-[18px]" style={{ color: '#9fb0d8' }}>50</span>
      </div>

      <div>
        {list.length === 0 && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[110px] animate-pulse"
               style={{ borderBottom: i < 5 ? `1px solid ${theme.border}` : 0, background: theme.panel }} />
        ))}
        {list.map((row, index) => {
          const isUp = (row.change_24h_pct ?? 0) >= 0
          const [from, to, accent] = colorsFor(row.symbol)
          const art = row.image || buildTokenArt(row.symbol, from, to, accent)
          return (
            <div
              key={`${title}-${row.symbol}-${index}`}
              className="flex gap-4 px-4 py-4 transition-colors hover:bg-white/5"
              style={index < list.length - 1 ? { borderBottom: `1px solid ${theme.border}` } : undefined}
            >
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[14px] border" style={{ borderColor: theme.border }}>
                <img src={art} alt={row.symbol} className="h-full w-full object-cover" />
                <div className="absolute -bottom-1 -right-1">
                  <ChainMark small />
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-[18px] font-extrabold">{row.symbol}</div>
                      <VerifiedBadge />
                      <div className="truncate text-[15px]" style={{ color: theme.muted }}>{row.name}</div>
                    </div>
                    <div className="mt-1 text-[14px]" style={{ color: theme.textSoft }}>
                      {`交易量 ${fmtUSD(row.volume_24h_usd)} | ${T.floor} ${fmtUSD(row.price_usd * 0.55)}`}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[14px]" style={{ color: '#c7ccda' }}>
                      <span className="inline-flex items-center gap-1.5" style={{ color: theme.muted }}>
                        <Copy size={13} />
                        {shortAddr(row.symbol)}
                      </span>
                      <span className="inline-flex items-center gap-1.5" style={{ color: theme.muted }}>
                        <Users size={13} />
                        {(300 + (row.symbol.charCodeAt(0) % 60) * 70).toLocaleString()}
                      </span>
                      <span>{`${(120 + (row.symbol.charCodeAt(0) % 80) * 11).toLocaleString()} ${T.tradeCount}`}</span>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-[17px] font-extrabold">{fmtUSD(row.price_usd)}</div>
                    <div className="mt-1 text-[14px] font-bold" style={{ color: isUp ? theme.success : theme.danger }}>
                      {fmtPct(row.change_24h_pct)}
                    </div>
                    <div className="mt-1 text-[14px]" style={{ color: theme.muted }}>
                      {`${T.marketCap} ${fmtUSD(row.market_cap_usd)}`}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CreateTokenWorkbench() {
  const { connection } = useConnection()
  const wallet = useWallet()
  const [createdLaunches, setCreatedLaunches] = useState<CreatedLaunch[]>(() => readCreatedLaunches())
  const [form, setForm] = useState({
    name: 'Rise Dev Token',
    symbol: 'RISE',
    uri: 'https://example.com/rise.json',
    supply: '1000000000000000',
  })
  const [result, setResult] = useState<string>('Ready to send Anchor create_launch transaction')
  const [lastLaunch, setLastLaunch] = useState<null | {
    pool: string
    mint: string
    poolTokenVault: string
  }>(null)
  const [swapAmount, setSwapAmount] = useState('100000000')
  const [loading, setLoading] = useState(false)
  const [swapLoading, setSwapLoading] = useState(false)

  async function submit() {
    setLoading(true)
    try {
      const payload = await createAnchorLaunch(connection, wallet, {
        name: form.name,
        symbol: form.symbol,
        uri: form.uri,
        supply: Number(form.supply),
      })
      setLastLaunch({
        pool: payload.pool,
        mint: payload.mint,
        poolTokenVault: payload.poolTokenVault,
      })
      const created: CreatedLaunch = {
        id: payload.pool,
        name: form.name,
        symbol: form.symbol,
        uri: form.uri,
        supply: form.supply,
        cluster: payload.cluster,
        signature: payload.signature,
        pool: payload.pool,
        mint: payload.mint,
        metadata: payload.metadata,
        poolTokenVault: payload.poolTokenVault,
        createdAt: Date.now(),
        contractVersion: CURRENT_CONTRACT_VERSION,
      }
      setCreatedLaunches((items) => {
        const next = [created, ...items.filter((item) => item.pool !== created.pool)].slice(0, 12)
        writeCreatedLaunches(next)
        return next
      })
      setResult(JSON.stringify(payload, null, 2))
    } catch (e) {
      setResult(e instanceof Error ? e.message : '创建失败，请先连接钱包并签名登录')
    } finally {
      setLoading(false)
    }
  }

  async function sendBuySwap() {
    if (!lastLaunch) {
      setResult('Create a launch before sending swap')
      return
    }

    setSwapLoading(true)
    try {
      const payload = await sendAnchorSwap(connection, wallet, {
        ...lastLaunch,
        direction: 'buy',
        amountIn: swapAmount,
        minOut: 1,
      })
      setCreatedLaunches((items) => {
        const next = items.map((item) => item.pool === lastLaunch.pool
          ? {
            ...item,
            lastSwapSignature: payload.signature,
            lastSwapAmountIn: payload.amountIn,
            traderTokenAccount: payload.traderTokenAccount,
            trades: [
              ...(item.trades || []),
              {
                signature: payload.signature,
                type: 'Buy' as const,
                time: Date.now(),
                value: `${formatSolNumberFromLamports(Number(payload.amountIn || swapAmount))} SOL`,
                price: 'Curve',
                amount: '-',
                trader: shortPubkey(wallet.publicKey?.toBase58()),
              },
            ].slice(-50),
          }
          : item)
        writeCreatedLaunches(next)
        return next
      })
      setResult(JSON.stringify(payload, null, 2))
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'swap failed')
    } finally {
      setSwapLoading(false)
    }
  }

  return (
    <WorkbenchShell
      icon={<Rocket size={22} />}
      title="创建代币"
      subtitle="生成 Devnet 发射计划：0.1 SOL 资金池、线性 Bonding Curve、地板保护、Jupiter 聚合入口。"
    >
      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <ToolPanel>
          <Field label="名称" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <Field label="符号" value={form.symbol} onChange={(symbol) => setForm({ ...form, symbol })} />
          <Field label="Metadata URI" value={form.uri} onChange={(uri) => setForm({ ...form, uri })} />
          <Field label="供应量 Base Units" value={form.supply} onChange={(supply) => setForm({ ...form, supply })} />
          <PrimaryAction disabled={loading} onClick={submit} icon={<Rocket size={18} />}>
            {loading ? 'Sending...' : 'Send create_launch'}
          </PrimaryAction>
          <Field label="Swap SOL Lamports" value={swapAmount} onChange={setSwapAmount} />
          <PrimaryAction disabled={swapLoading || !lastLaunch} onClick={sendBuySwap} icon={<Send size={18} />}>
            {swapLoading ? 'Swapping...' : 'Send buy swap'}
          </PrimaryAction>
        </ToolPanel>
        <div className="grid gap-5">
          <OutputPanel title="Anchor Transaction" value={result} />
          <CreatedLaunchesPanel launches={createdLaunches} />
        </div>
      </div>
    </WorkbenchShell>
  )
}

function CreatedLaunchesPanel({ launches }: { launches: CreatedLaunch[] }) {
  return (
    <div className="rounded-[8px] border p-5" style={{ borderColor: theme.border, background: theme.panel }}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-bold" style={{ color: theme.accent }}>Created Tokens</div>
          <div className="mt-1 text-xs" style={{ color: theme.muted }}>0.1 SOL launch model</div>
        </div>
        <div className="text-right text-xs" style={{ color: theme.textSoft }}>
          {launches.length} launches
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        {launches.length === 0 ? (
          <div className="rounded-[8px] border p-4 text-sm" style={{ borderColor: theme.borderSoft, color: theme.muted }}>
            No created token yet
          </div>
        ) : launches.map((launch) => (
          <CreatedLaunchCard key={launch.pool} launch={launch} />
        ))}
      </div>
    </div>
  )
}

function CreatedLaunchCard({ launch }: { launch: CreatedLaunch }) {
  const chart = useMemo(() => buildCurvePoints(launch.supply), [launch.supply])
  const maxCollateral = Math.max(...chart.map((point) => point.collateralSol), 0.000001)
  const polyline = chart.map((point, index) => {
    const x = 20 + index * (320 / Math.max(chart.length - 1, 1))
    const y = 148 - (point.collateralSol / maxCollateral) * 116
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
  const firstPoint = chart[0]
  const lastPoint = chart[chart.length - 1]
  const explorer = `https://explorer.solana.com/address/${launch.mint}?cluster=${launch.cluster}`

  return (
    <article className="rounded-[8px] border p-4" style={{ borderColor: theme.borderSoft, background: '#111520' }}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-lg font-black">{launch.name}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs font-semibold" style={{ color: theme.textSoft }}>
                <span>{launch.symbol}</span>
                <span>{shortPubkey(launch.mint)}</span>
                <a className="hover:text-white" href={explorer} target="_blank" rel="noreferrer">Explorer</a>
              </div>
            </div>
            <div className="rounded-[8px] px-3 py-2 text-right text-xs" style={{ background: '#0f131d', color: theme.textSoft }}>
              <div>{new Date(launch.createdAt).toLocaleTimeString()}</div>
              <div className="mt-1" style={{ color: theme.accent }}>{launch.cluster}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
            <RuleStat label="Launch Fee" value={`${LAUNCH_RULES.launchFeeSol} SOL`} />
            <RuleStat label="Floor Reserve" value={`${LAUNCH_RULES.floorReserveSol} SOL`} />
            <RuleStat label="Liquidity" value={`${LAUNCH_RULES.liquidityReserveSol} SOL`} />
            <RuleStat label="Protocol Fee" value={`${LAUNCH_RULES.protocolFeeSol} SOL`} />
            <RuleStat label="Pool Total" value={`${LAUNCH_RULES.poolTotalSol} SOL`} />
            <RuleStat label="Trade Fee" value={`${LAUNCH_RULES.tradeFeeBps / 100}%`} />
            <RuleStat label="Initial Price" value={`${(LAUNCH_RULES.initialPriceNumerator / LAUNCH_RULES.initialPriceDenominator).toFixed(2)} lamports`} />
          </div>

          <div className="mt-4 grid gap-2 text-xs" style={{ color: theme.muted }}>
            <div>Pool {shortPubkey(launch.pool)} · Elastic mint/burn</div>
            <div>Tx {shortPubkey(launch.signature)}{launch.lastSwapSignature ? ` · Last swap ${shortPubkey(launch.lastSwapSignature)}` : ''}</div>
          </div>
        </div>

        <div className="w-full shrink-0 xl:w-[380px]">
          <div className="rounded-[8px] border p-3" style={{ borderColor: theme.border, background: '#0f131d' }}>
            <div className="mb-2 flex items-center justify-between text-xs font-bold">
              <span style={{ color: theme.accent }}>Bonding Curve</span>
              <span style={{ color: theme.muted }}>{formatSolFromLamports(collateralLamportsAtSold(lastPoint.sold))}</span>
            </div>
            <svg viewBox="0 0 360 168" className="h-[168px] w-full" role="img" aria-label={`${launch.symbol} bonding curve`}>
              <line x1="20" y1="148" x2="344" y2="148" stroke="#2b3142" strokeWidth="1" />
              <line x1="20" y1="20" x2="20" y2="148" stroke="#2b3142" strokeWidth="1" />
              <polyline points={polyline} fill="none" stroke={theme.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="20" cy="148" r="4" fill={theme.accentSoft} />
              <circle cx="340" cy="32" r="4" fill={theme.accent} />
            </svg>
            <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: theme.textSoft }}>
              <div>
                <div style={{ color: theme.muted }}>Start</div>
                <div>{formatPriceLamports(firstPoint.priceLamports)}</div>
              </div>
              <div className="text-right">
                <div style={{ color: theme.muted }}>Chart Range</div>
                <div>{lastPoint.sold.toLocaleString()} tokens</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

function RuleStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border px-3 py-2" style={{ borderColor: theme.border, background: '#0f131d' }}>
      <div style={{ color: theme.muted }}>{label}</div>
      <div className="mt-1 font-black" style={{ color: theme.text }}>{value}</div>
    </div>
  )
}

function PortfolioWorkbench() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58()
  const rows = [
    ['Floor Reserve', '0.049 SOL', '地板保护池'],
    ['Liquidity', '0.049 SOL', '交易曲线流动性'],
    ['Protocol Fee', '0.00125 SOL', '协议初始化费用'],
    ['Pool Total', '0.09875 SOL', '创建后进入池子的净额'],
    ['Trade Fee', '1.25%', '30% 协议 / 40% 地板 / 30% 创建者'],
  ]

  return (
    <WorkbenchShell
      icon={<WalletCards size={22} />}
      title="投资组合"
      subtitle={connected ? `当前钱包 ${wallet}` : '连接钱包后显示你的发射项目、持仓与收益。'}
    >
      <div className="grid gap-5 lg:grid-cols-4">
        {rows.map(([label, value, hint]) => (
          <article key={label} className="rounded-[8px] border p-5" style={{ borderColor: theme.border, background: theme.panel }}>
            <div className="text-sm" style={{ color: theme.muted }}>{label}</div>
            <div className="mt-3 text-2xl font-black">{value}</div>
            <div className="mt-2 text-sm" style={{ color: theme.textSoft }}>{hint}</div>
          </article>
        ))}
      </div>
      <ToolPanel className="mt-5">
        <div className="flex items-center gap-3">
          <PieChart size={20} style={{ color: theme.accent }} />
          <div>
            <div className="font-bold">你的项目</div>
            <div className="text-sm" style={{ color: theme.muted }}>
              {connected ? '后续可接入链上 PDA 扫描，读取 creator = wallet 的 TokenPool。' : '请先连接钱包。'}
            </div>
          </div>
        </div>
      </ToolPanel>
    </WorkbenchShell>
  )
}

function SimulatorWorkbench() {
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy')
  const [amountIn, setAmountIn] = useState('1000000000')
  const [result, setResult] = useState('等待报价')
  const [loading, setLoading] = useState(false)

  async function quote() {
    setLoading(true)
    try {
      const payload = await quoteAmmSwap({
        model: 'linear',
        direction,
        amountIn,
        soldTokens: direction === 'sell' ? '282142856' : '0',
      })
      setResult(JSON.stringify(payload, null, 2))
    } catch (e) {
      setResult(e instanceof Error ? e.message : '报价失败，请先连接钱包并签名登录')
    } finally {
      setLoading(false)
    }
  }

  return (
    <WorkbenchShell
      icon={<Activity size={22} />}
      title="AMM 模拟器"
      subtitle="本地模拟 PumpFun 风格线性曲线买卖，含 1.25% 手续费和地板保护。"
    >
      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <ToolPanel>
          <div className="grid grid-cols-2 gap-3">
            {(['buy', 'sell'] as const).map((item) => (
              <button
                key={item}
                className="h-11 rounded-[8px] border text-sm font-bold"
                style={{
                  borderColor: theme.border,
                  background: direction === item ? theme.accent : theme.button,
                  color: direction === item ? '#10131c' : theme.text,
                }}
                onClick={() => setDirection(item)}
              >
                {item === 'buy' ? '买入' : '卖出'}
              </button>
            ))}
          </div>
          <Field label="输入数量 Base Units" value={amountIn} onChange={setAmountIn} />
          <PrimaryAction disabled={loading} onClick={quote} icon={<Play size={18} />}>
            {loading ? '报价中' : '模拟报价'}
          </PrimaryAction>
        </ToolPanel>
        <OutputPanel title="AMM Quote" value={result} />
      </div>
    </WorkbenchShell>
  )
}

function AiSkillsWorkbench() {
  const [result, setResult] = useState('等待加载 AI skills')
  const [loading, setLoading] = useState(false)

  async function loadSkills() {
    setLoading(true)
    try {
      setResult(JSON.stringify(await getAiSkills(), null, 2))
    } catch (e) {
      setResult(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function simulateSkill() {
    setLoading(true)
    try {
      const payload = await runAiSkill('pumpfun.curveSimulate', {
        direction: 'buy',
        amountIn: '1000000000',
        pool: { soldTokens: '0' },
      })
      setResult(JSON.stringify(payload, null, 2))
    } catch (e) {
      setResult(e instanceof Error ? e.message : '执行失败，请先连接钱包并签名登录')
    } finally {
      setLoading(false)
    }
  }

  return (
    <WorkbenchShell
      icon={<Bot size={22} />}
      title="AI Skills"
      subtitle="把 token 发射、AMM 报价、DEX 聚合包装成可被 AI agent 调用的工具。"
    >
      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <ToolPanel>
          <PrimaryAction disabled={loading} onClick={loadSkills} icon={<Bot size={18} />}>读取 Skills</PrimaryAction>
          <PrimaryAction disabled={loading} onClick={simulateSkill} icon={<Play size={18} />}>运行曲线模拟</PrimaryAction>
        </ToolPanel>
        <OutputPanel title="AI Output" value={result} />
      </div>
    </WorkbenchShell>
  )
}

function WorkbenchShell({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section className="mx-auto max-w-[1540px] px-5 py-10">
      <div className="mb-7 flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-[8px]" style={{ background: theme.accent, color: '#10131c' }}>
          {icon}
        </div>
        <div>
          <h1 className="text-4xl font-black">{title}</h1>
          <p className="mt-2 text-base" style={{ color: theme.textSoft }}>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function ToolPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[8px] border p-5 ${className}`} style={{ borderColor: theme.border, background: theme.panel }}>
      <div className="grid gap-4">{children}</div>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-2 text-sm font-semibold" style={{ color: theme.textSoft }}>
      {label}
      <input
        className="h-11 rounded-[8px] border px-3 text-sm outline-none"
        style={{ borderColor: theme.border, background: '#111520', color: theme.text }}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function PrimaryAction({
  children,
  icon,
  disabled,
  onClick,
}: {
  children: ReactNode
  icon: ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] px-4 text-sm font-black disabled:opacity-60"
      style={{ background: theme.accent, color: '#10131c' }}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  )
}

function OutputPanel({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-[8px] border p-5" style={{ borderColor: theme.border, background: '#0f131d' }}>
      <div className="mb-3 text-sm font-bold" style={{ color: theme.accent }}>{title}</div>
      <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap text-xs leading-6" style={{ color: theme.textSoft }}>
        {value}
      </pre>
    </div>
  )
}

/* ============================================================
 * Helpers (presentational)
 * ============================================================ */
function SectionHeading({
  title,
  subtitle,
  titleExtra,
  right,
}: {
  title: string
  subtitle?: string
  titleExtra?: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-[clamp(34px,3vw,48px)] font-black tracking-tight">{title}</h2>
          {titleExtra}
        </div>
        {subtitle && (
          <p className="mt-3 text-[18px]" style={{ color: theme.textSoft }}>
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </div>
  )
}

function StatCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[14px]" style={{ color: theme.muted }}>{label}</div>
      <div className="mt-2 text-[18px] font-extrabold" style={{ color: accent ? theme.accent : theme.text }}>
        {value}
      </div>
    </div>
  )
}

function VerifiedBadge() {
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full"
      style={{ background: 'rgba(240, 185, 11, 0.18)', color: theme.accent }}
    >
      <BadgeCheck size={16} />
    </span>
  )
}

function ArrowShell({ children }: { children: ReactNode }) {
  return (
    <button
      className="inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors hover:bg-white/5"
      style={{ borderColor: theme.border, color: theme.textSoft }}
      aria-label={T.switchLabel}
    >
      {children}
    </button>
  )
}

function IconButton({ children, label, onClick }: { children: ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      aria-label={label}
      className="inline-flex h-11 w-11 items-center justify-center rounded-[16px] border"
      style={{ borderColor: theme.border, background: theme.button, color: theme.text }}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function PillButton({ children }: { children: ReactNode }) {
  return (
    <button
      className="inline-flex h-11 items-center justify-center rounded-[16px] border px-4 text-[15px] font-bold"
      style={{ borderColor: theme.border, background: theme.button, color: theme.text }}
    >
      {children}
    </button>
  )
}

function ChainMark({ small }: { small?: boolean }) {
  const size = small ? 20 : 26
  return (
    <span
      className="relative inline-flex items-center justify-center rounded-full border"
      style={{
        width: size,
        height: size,
        borderColor: 'rgba(240, 185, 11, 0.28)',
        background: '#090c12',
        boxShadow: '0 8px 20px rgba(0, 0, 0, 0.28)',
      }}
    >
      {[-5, 0, 5].map((offset) => (
        <span
          key={offset}
          className="absolute rounded-full"
          style={{
            width: small ? 11 : 14,
            height: 2,
            transform: `translateY(${offset}px) skewX(-18deg)`,
            background: `linear-gradient(90deg, ${theme.accent} 0%, ${theme.accentSoft} 100%)`,
          }}
        />
      ))}
    </span>
  )
}

function RiseLogo() {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl"
         style={{ background: `linear-gradient(135deg, ${theme.accentSoft}, ${theme.accent})` }}>
      <svg viewBox="0 0 64 64" className="h-9 w-9" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M17 18C20 10 27 6 35 6C46 6 54 14 54 24C54 34 47 39 37 39H31"
          stroke="#10131c"
          strokeWidth="4.6"
          strokeLinecap="round"
        />
        <path d="M20 17L17 29" stroke="#10131c" strokeWidth="4.6" strokeLinecap="round" />
        <path d="M23 26L47 55" stroke="#10131c" strokeWidth="4.6" strokeLinecap="round" />
        <circle cx="17" cy="47" r="4" fill="#10131c" />
      </svg>
    </div>
  )
}
