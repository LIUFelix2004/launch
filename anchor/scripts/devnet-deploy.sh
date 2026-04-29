#!/usr/bin/env bash
set -euo pipefail

HOST_IP="${DEVNET_PROXY_HOST:-$(ip route | awk '/default/ {print $3; exit}')}"
PROXY_PORT="${DEVNET_PROXY_PORT:-7891}"

export HTTP_PROXY="http://${HOST_IP}:${PROXY_PORT}"
export HTTPS_PROXY="${HTTP_PROXY}"
export ALL_PROXY="${HTTP_PROXY}"
export PATH="/root/.cargo/bin:/root/.local/share/solana/install/active_release/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

anchor deploy --provider.cluster devnet -- --use-rpc
