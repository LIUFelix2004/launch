# MemeLaunch / Rise-like Launchpad

一个运行在 Solana Devnet 上的 Meme Token 发射与交易原型。项目目标是参考 Rise.rich 的发射体验和机制，完成从前端创建代币、后端构建交易、钱包签名、链上合约执行、买卖 mint/burn、前端展示价格曲线和交易历史的完整链路。

当前版本仍处于 Devnet/MVP 阶段，重点用于机制验证、前后端打通和后续 E2E 压测，不应直接用于 Mainnet。

## 当前进度概览

整体完成度约为 70%。

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| Solana/Anchor 合约 | 已完成 MVP | 已实现 0.1 SOL 测试版创建模型、资金拆分、买入 mint、卖出 burn、线性 bonding curve 和 floor guard |
| Devnet 部署 | 已完成 | 程序已部署到 Devnet，Program ID 固定为 `AtH8XVVKMm51FKPhYgYkw4ZVXb2fb8nnXjNumyTP44fo` |
| 后端交易构建 API | 已完成 | `/api/create` 和 `/api/swap` 返回 base64 交易，由前端钱包签名发送 |
| 钱包登录鉴权 | 已完成 | Phantom 钱包签名 nonce，后端签发 JWT，受保护接口校验 Bearer token |
| Metaplex Metadata | 已完成 | 创建代币时同时创建 Token Metadata，改善 Phantom/Explorer 识别 |
| 前端创建代币 | 已完成 | 创建页可请求后端交易、弹出 Phantom 签名、创建成功后记录本地 token |
| 前端 Swap | 已完成基础链路 | buy/sell 交易由后端构建，前端签名发送；当前 Devnet 发送使用 `skipPreflight: true` 规避 Solayer simulation 误报 |
| 前端发现页/详情页 | 已完成基础 UI | 已展示创建 token、价格/floor/liquidity/交易记录/曲线图等信息 |
| 交易历史 | 半完成 | 当前主要依赖本地状态和即时写入，尚未接入完整链上索引服务 |
| 多钱包/高并发 E2E | 部分完成 | 已有脚本雏形，仍需持续跑通多钱包、多金额、买卖混合场景 |
| MEV/Jito 防护 | 未完成 | 尚未正式集成 Jito Bundle、优先费策略和防夹交易策略 |
| 安全审计 | 未完成 | 已有单元测试/构建验证，但尚未完成系统性审计 |
| Mainnet 准备 | 未完成 | 仍需审计、参数校准、监控、索引、费用策略和运维流程 |

## 核心机制

### 1. 0.1 SOL 测试版创建模型

当前为了方便 Devnet 多次测试，创建一个 launch 使用 0.1 SOL 模型：

| 项目 | 数值 |
| --- | --- |
| Launch Fee | `0.1 SOL` |
| Floor Reserve | `0.049 SOL` |
| Liquidity | `0.049 SOL` |
| Protocol Fee | `0.00125 SOL` |
| Pool Total | `0.09875 SOL` |
| Trade Fee | `1.25%` |

说明：

- 创建时，用户创建 SPL Mint、Metaplex Metadata、TokenPool PDA。
- 合约把 `0.09875 SOL` 转入 Pool PDA，作为 floor/liquidity 资金基础。
- 合约把 `0.00125 SOL` 转给协议金库。
- 当前是 Devnet 低成本测试版，不是原始 10 SOL POL 生产参数。

### 2. Rise-like 弹性供应 mint/burn

当前合约已从早期“池子预铸固定供应并放入 token vault”的模型，改成 Rise-like 弹性供应模型：

- 创建代币时，不再把全部供应 mint 到池子 vault。
- 买入时，合约使用 Pool PDA 作为 mint authority，按曲线报价 `mint_to` 到买家的 ATA。
- 卖出时，合约从用户 ATA `burn` 对应数量的 token，并从 Pool PDA 支付 SOL。
- 合约记录 `sold_supply`，用它作为当前流通/售出供应量。
- 前端展示中也已经改成 `Elastic mint/burn`，不再展示旧的 pool token vault。

注意：当前机制方向与 Rise 文档中的弹性供应一致，但具体曲线、floor 动态和风控参数仍是项目内实现版本，后续还需要继续校准到目标协议规则。

### 3. Bonding Curve 与 Floor

当前合约使用线性边际价格模型：

```text
price(sold) = initial_price + slope * sold
```

对应累计抵押/曲线积分：

```text
collateral(sold) = initial_price * sold + slope * sold^2 / 2
```

买入逻辑：

- 对输入 SOL 扣除 `1.25%` 交易费。
- 净额进入曲线积分，计算可 mint token 数量。
- 交易费按协议费、floor 注入、creator fee 拆分。
- 更新 `sold_supply`、`liq_sol`、`floor_sol`、`ath_price`、`floor_price`。

卖出逻辑：

- 输入 token 先从用户 ATA burn。
- 按曲线反向计算可兑出 SOL。
- 同时考虑 floor price 保底。
- 使用 floor guard 防止流动性跌穿保护线。
- 更新 `sold_supply`、`liq_sol`、`floor_sol` 和费用统计。

## 技术栈

### 链上合约

| 技术 | 用途 |
| --- | --- |
| Rust | Solana 程序开发语言 |
| Anchor `0.32.1` | 合约框架、账户约束、IDL 生成、测试构建 |
| Solana Program | Devnet 链上部署和执行 |
| SPL Token | Mint、ATA、mint_to、burn、set authority |
| Metaplex Token Metadata | 创建 token metadata，让钱包/Explorer 能识别代币信息 |

### 后端

| 技术 | 用途 |
| --- | --- |
| Node.js | 后端运行时 |
| Express `4.22.1` | API 服务 |
| `@solana/web3.js` | 构建 Solana 交易、连接 RPC |
| `@solana/spl-token` | 构建 Mint、ATA、SetAuthority、Token 指令 |
| `@metaplex-foundation/mpl-token-metadata` | 构建 Metadata 创建指令 |
| `jsonwebtoken` | 钱包登录后的 JWT 鉴权 |
| `tweetnacl` + `bs58` | 验证 Phantom 钱包签名 |
| Node Test Runner | 后端单元测试 |
| `https-proxy-agent` / `node-fetch` | RPC 代理兼容 |

### 前端

| 技术 | 用途 |
| --- | --- |
| React `19` | 前端 UI |
| TypeScript | 类型检查 |
| Vite `6` | 前端开发和构建 |
| Tailwind CSS | 样式 |
| Radix UI | 基础组件 |
| Lucide React | 图标 |
| Solana Wallet Adapter | Phantom 钱包连接、签名、交易发送 |
| `@solana/web3.js` | 前端读取链上状态、反序列化交易 |
| React Query | 远程数据查询 |
| ECharts | 后续图表能力，目前项目也有自绘 SVG 曲线 |

### RPC 与网络

| 项目 | 当前配置 |
| --- | --- |
| Cluster | `devnet` |
| RPC | `https://devnet-rpc.solayer.org` |
| Program ID | `AtH8XVVKMm51FKPhYgYkw4ZVXb2fb8nnXjNumyTP44fo` |
| Deploy Authority | `FtRbuPo4JJ5FoXz3SR1Cm9uYdw5817jpbLdP97PpJQEj` |

## 项目目录

```text
d:\memelaunch
├── anchor
│   ├── Anchor.toml
│   ├── programs
│   │   └── rise_launchpad
│   │       └── src/lib.rs
│   ├── scripts
│   │   ├── devnet-deploy.sh
│   │   ├── devnet-verify.js
│   │   ├── devnet-concurrent-e2e.js
│   │   └── localnet-integration.sh
│   └── tests
│       └── rise_launchpad.localnet.js
├── backend
│   ├── server.js
│   ├── routes
│   │   ├── auth.js
│   │   ├── create.js
│   │   ├── swap.js
│   │   ├── launches.js
│   │   ├── amm.js
│   │   ├── dex.js
│   │   ├── tokens.js
│   │   ├── gainers.js
│   │   ├── news.js
│   │   ├── sentiment.js
│   │   └── ai.js
│   ├── lib
│   │   ├── anchorTransactions.js
│   │   └── auth.js
│   └── test
│       └── anchorTransactions.test.js
└── frontend
    ├── src
    │   ├── App.tsx
    │   ├── lib
    │   │   ├── api.ts
    │   │   ├── localnetLaunch.ts
    │   │   ├── launches.ts
    │   │   ├── amm.ts
    │   │   └── dex.ts
    │   └── components
    │       └── WalletAuthButton.tsx
    └── package.json
```

## 主要模块说明

### Anchor 合约

核心文件：

```text
anchor/programs/rise_launchpad/src/lib.rs
```

已实现指令：

| 指令 | 状态 | 说明 |
| --- | --- | --- |
| `create_launch` | 已实现 | 初始化 TokenPool，收取 0.1 SOL launch fee，写入曲线参数和资金拆分 |
| `swap` | 已实现 | 支持 buy/sell，buy mint token，sell burn token |

核心账户：

| 账户 | 说明 |
| --- | --- |
| `TokenPool` | Pool PDA，保存 creator、mint、floor/liquidity、fee、supply、sold_supply、curve 参数 |
| `Mint` | SPL Token Mint，mint authority 被转移给 Pool PDA |
| `trader_token_account` | 用户 ATA，买入收 token，卖出 burn token |
| `protocol_treasury` | 协议费接收账户 |

### 后端 API

后端不会代替用户签名，而是负责构建交易并返回 base64：

| 接口 | 鉴权 | 状态 | 说明 |
| --- | --- | --- | --- |
| `POST /api/auth/nonce` | 否 | 已完成 | 根据钱包地址生成 nonce |
| `POST /api/auth/login` | 否 | 已完成 | 验证钱包签名，签发 JWT |
| `POST /api/create` | 是 | 已完成 | 构建 create_launch 交易 |
| `POST /api/swap` | 是 | 已完成 | 构建 buy/sell swap 交易 |
| `POST /api/launches/create` | 是 | 已完成 | create 的兼容入口 |
| `POST /api/launches/swap` | 是 | 已完成 | swap 的兼容入口 |
| `GET /api/launches/config` | 否 | 已完成 | 返回 launch 配置 |
| `GET /api/tokens` | 否 | 已完成基础 | 发现页 token 数据 |
| `GET /api/gainers` | 否 | 已完成基础 | 涨幅数据 |
| `GET /api/news` | 否 | 已完成基础 | 新闻数据 |
| `GET /api/sentiment` | 否 | 已完成基础 | 情绪数据 |
| `POST /api/amm/quote` | 是 | 已完成基础 | AMM 报价工具 |
| `GET /api/dex/quote` | 是 | 已完成基础 | DEX 报价工具 |
| `POST /api/ai/run` | 是 | 已完成基础 | AI skills 工具入口 |

交易构建核心文件：

```text
backend/lib/anchorTransactions.js
```

该文件负责：

- 校验 Program 是否已部署。
- 读取 payer 钱包地址。
- 创建 Mint 账户初始化指令。
- 创建 Metaplex Metadata 指令。
- 将 mint authority 转移给 Pool PDA。
- 构建 `create_launch` 指令。
- 构建 `swap` 指令。
- 序列化为 base64，返回给前端钱包签名。

### 前端

核心文件：

```text
frontend/src/App.tsx
frontend/src/lib/localnetLaunch.ts
frontend/src/components/WalletAuthButton.tsx
```

已完成能力：

- Phantom 钱包连接。
- 钱包签名登录。
- 创建代币表单。
- 请求后端 `/api/create` 获取 base64 交易。
- Phantom 弹窗签名并发送交易。
- 创建成功后在页面展示 token。
- 发现页展示本地创建的 token。
- token 详情页展示：
  - price
  - floor reserve
  - liquidity
  - protocol fee
  - pool total
  - market cap
  - supply / sold supply
  - mint / pool 地址
  - transactions
  - bonding curve 图表
- Swap 面板支持 buy/sell。
- 买卖后写入本地交易历史，并尝试刷新链上 Pool 状态。
- 旧合约版本 token 会被前端隔离，避免旧缓存 token 与新版 mint/burn ABI 混用。

当前前端合约版本标记：

```text
rise-elastic-mint-burn-v1
```

## 环境变量

### backend/.env

本地开发需要：

```env
BACKEND_PORT=3001
SURF_API_KEY=replace_me
JWT_SECRET=devnet-local-jwt-secret-change-me
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://devnet-rpc.solayer.org
SOLANA_PROXY_URL=http://127.0.0.1:7890
RISE_LAUNCHPAD_PROGRAM_ID=AtH8XVVKMm51FKPhYgYkw4ZVXb2fb8nnXjNumyTP44fo
RISE_PROTOCOL_TREASURY=FtRbuPo4JJ5FoXz3SR1Cm9uYdw5817jpbLdP97PpJQEj
```

说明：

- `SURF_API_KEY` 当前用于满足后端启动检查和部分 Surf SDK 相关能力。
- `JWT_SECRET` 如果不设置，会使用开发默认值。
- `SOLANA_PROXY_URL` 在 Windows/WSL 代理环境下可能需要设置；如果网络可直连，可以留空。

### frontend/.env

```env
PORT=5173
BACKEND_PORT=3001
BASE_PATH=
```

## 本地运行

### 1. 启动后端

```powershell
cd d:\memelaunch\backend
npm run dev
```

默认监听：

```text
http://localhost:3001
```

### 2. 启动前端

```powershell
cd d:\memelaunch\frontend
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

默认访问：

```text
http://localhost:5173
```

### 3. 钱包操作

1. 打开前端。
2. 连接 Phantom。
3. 切换到 Devnet。
4. 点击右上角钱包按钮进行签名登录。
5. 进入“创建代币”。
6. 填写名称、符号、metadata URI、供应量。
7. 点击 `Send create_launch`。
8. Phantom 弹窗确认交易。
9. 成功后 token 会出现在创建页和发现页。

## 构建与测试

### Anchor build

```powershell
wsl -u root -- bash -lc 'PATH=/root/.cargo/bin:/root/.local/share/solana/install/active_release/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; export PATH; cd /mnt/d/memelaunch/anchor && anchor build'
```

### 后端测试

```powershell
cd d:\memelaunch\backend
npm test
```

当前已通过：

```text
tests 6
pass 6
fail 0
```

覆盖内容：

- create transaction 构建。
- swap transaction 构建。
- bonding curve 积分和反解。
- buy fee split。
- sell floor guard。
- AMM quote 基础方向性。

### 前端类型检查

```powershell
cd d:\memelaunch\frontend
npm run type-check
```

### 前端生产构建

```powershell
cd d:\memelaunch\frontend
npm run build
```

当前已通过：

- `vite build --outDir dist/client`
- `vite build --ssr src/entry-server.tsx --outDir dist/server`

## Devnet 部署

当前 Program ID：

```text
AtH8XVVKMm51FKPhYgYkw4ZVXb2fb8nnXjNumyTP44fo
```

Anchor 配置：

```text
anchor/Anchor.toml
```

部署命令：

```powershell
wsl -u root -- bash -lc 'PATH=/root/.cargo/bin:/root/.local/share/solana/install/active_release/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; export PATH; cd /mnt/d/memelaunch/anchor && solana program deploy --verbose --use-rpc --skip-preflight --max-sign-attempts 2 --url https://devnet-rpc.solayer.org --keypair /root/.config/solana/id.json --program-id target/deploy/rise_launchpad-keypair.json target/deploy/rise_launchpad.so'
```

最近一次已验证部署签名：

```text
wG9xCFZx7vA39H3hzzyfatsWq6dLywxyrAxGpnjKXnchdVdFfjNi89UN4jdBMS6zbD1Myz8qsKUFFSd9ybujWuX
```

已验证真实 create 成功上链签名：

```text
5JzaNPxuPVCdzEjfeuCPYMiMCpY1sEJQqApLMALtLsLR6Sn1mhRymzsKYTR7JsdGZxZ3UwZ9Lz1T1vr8ZWVDVMnX
```

## 已解决的重要问题

### 1. 创建费用从 1 SOL / 10 SOL 调整到 0.1 SOL

为了 Devnet 高频测试，当前创建成本已经调低到 0.1 SOL，并同步调整了前端展示和后端余额检查。

### 2. 旧版 pool token vault 模型切换到 mint/burn

早期实现里创建时会预铸供应到 pool token vault。现在已改为：

- 创建时 mint supply 为 0。
- 买入时 mint。
- 卖出时 burn。
- 后端 create/swap 不再传 `poolTokenVault`。

### 3. JWT 过期误导为创建失败

之前前端会直接显示 `invalid or expired token`。现在遇到 401 会清除旧登录态，并提示重新钱包签名登录。

### 4. create_launch 初始化顺序导致 MathOverflow

之前合约先计算 `ath_price`，再写入曲线参数，导致除零溢出。现已调整为先写入曲线参数、校验曲线，再计算初始 `ath_price`。

### 5. Solayer Devnet preflight simulation 误报

Solayer 的 simulation 在某些情况下会误报 `Custom: 3007`，但真实上链执行成功。当前前端交易发送已使用：

```ts
skipPreflight: true
```

这适用于当前 Devnet 验证阶段。Mainnet 前需要重新评估 RPC、预检、重试和日志策略。

## 当前已知限制

1. 交易历史还不是完整链上索引。
   当前主要依赖前端本地记录和即时刷新。刷新浏览器、换设备或多钱包交易后，历史可能不完整。

2. 图表还不是完整实时 K 线。
   当前更偏机制展示和曲线状态展示，尚未接入链上事件索引、OHLCV 聚合、时间分辨率切换。

3. Rise 机制尚未完全生产级复刻。
   当前已实现弹性供应 mint/burn、floor reserve、trade fee、线性曲线和基础保护，但仍需进一步校准 Rise 文档中的具体价格、floor、供应、费用和极端情况。

4. Sell 路径需要更多 E2E。
   合约已实现 burn + SOL 结算，但仍需要多钱包、多金额、连续买卖、高并发下的验证。

5. Mainnet 不能直接上线。
   还缺少审计、监控、索引服务、Jito/MEV 防护、权限管理、参数治理、失败恢复方案。

6. Devnet 当前使用 `skipPreflight: true`。
   这是为了绕过 Solayer simulation 误报，Mainnet 前必须重新设计发送策略。

## 下一步路线

### P0：把 Devnet 交易链路压实

- 用前端创建 5-10 个新 token。
- 对每个 token 执行多笔 buy。
- 对至少 2 个 token 执行 sell。
- 确认：
  - mint supply 随 buy 增加。
  - mint supply 随 sell 减少。
  - `sold_supply` 与用户余额变化一致。
  - floor/liquidity/protocol fee 更新符合预期。

### P1：补完整链上索引

- 监听 create/swap 交易。
- 存储 launch、trade、price point。
- 前端从后端索引读取交易历史。
- 支持刷新后仍能看到完整交易记录。

### P2：完善图表与价格

- 构建 price point / trade event 数据结构。
- 支持实时价格、floor、market cap、sold supply 更新。
- 支持 1m / 5m / 1h / 1d 视图。
- 增加 buy/sell 成交点标记。

### P3：E2E 和高并发

- 扩展 `anchor/scripts/devnet-concurrent-e2e.js`。
- 多钱包批量 airdrop / fund。
- 10+ 并发买入。
- 买卖混合压力测试。
- 验证曲线价格只按规则变化，floor guard 生效。

### P4：MEV 与 Mainnet 准备

- Jito Bundle / priority fee 策略。
- RPC fallback。
- 交易重试和状态确认策略。
- 合约权限梳理。
- 安全审计。
- Mainnet 参数切换。

## 常见问题

### 为什么我有 SOL 但创建失败？

常见原因：

- Phantom 没有切到 Devnet。
- 前端登录 JWT 过期，需要重新签名登录。
- 使用的是旧页面 bundle，需要 `Ctrl + F5` 强刷。
- 浏览器缓存中有旧 token，需要重新创建新版 token。
- Devnet RPC 短暂异常。

### 为什么旧创建的 token 不能 swap？

因为合约 ABI 已切换到 `rise-elastic-mint-burn-v1`。旧 token 可能来自 pool token vault 模型，前端会阻止旧版本 token 继续测试 swap，避免账户结构不匹配。

### 为什么 Phantom 里有时显示未知代币？

已经创建 Metaplex metadata，但钱包索引和 Devnet 展示可能有延迟。metadata URI 也需要是真实可访问 JSON，`https://example.com/rise.json` 只是测试占位。

### 为什么当前发送交易跳过 preflight？

Solayer Devnet simulation 对当前交易存在误报，但真实链上执行成功。为了继续 Devnet 验证，前端暂时使用 `skipPreflight: true`。Mainnet 前需要改成更稳健的发送策略。

## 版本状态

当前阶段：

```text
Devnet MVP / Rise-like elastic mint-burn prototype
```

当前前端合约版本：

```text
rise-elastic-mint-burn-v1
```

当前 Program ID：

```text
AtH8XVVKMm51FKPhYgYkw4ZVXb2fb8nnXjNumyTP44fo
```

当前建议使用方式：

```text
仅用于 Devnet 功能验证、前后端联调、曲线机制验证和 E2E 压测。
```
