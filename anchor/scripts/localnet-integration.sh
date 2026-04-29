#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOLANA_BIN="/root/.local/share/solana/install/active_release/bin"
PROGRAM_ID="AtH8XVVKMm51FKPhYgYkw4ZVXb2fb8nnXjNumyTP44fo"
LEDGER="/tmp/rise-localnet-ledger"
PID_FILE="/tmp/rise-validator.pid"
LOG_FILE="/tmp/rise-validator.log"

export PATH="/root/.cargo/bin:${SOLANA_BIN}:${PATH}"
export ANCHOR_PROVIDER_URL="http://127.0.0.1:8899"
export ANCHOR_WALLET="${ANCHOR_WALLET:-/root/.config/solana/id.json}"

stop_validator() {
  if [[ -f "${PID_FILE}" ]]; then
    kill "$(cat "${PID_FILE}")" >/dev/null 2>&1 || true
    rm -f "${PID_FILE}"
  fi
  pkill -f solana-test-validator >/dev/null 2>&1 || true
  pkill -f solana-faucet >/dev/null 2>&1 || true
}

trap stop_validator EXIT

cd "${ROOT_DIR}"
anchor build

stop_validator
rm -rf "${LEDGER}"

nohup "${SOLANA_BIN}/solana-test-validator" \
  --ledger "${LEDGER}" \
  --reset \
  --rpc-port 8899 \
  --faucet-port 9900 \
  --bpf-program "${PROGRAM_ID}" "${ROOT_DIR}/target/deploy/rise_launchpad.so" \
  > "${LOG_FILE}" 2>&1 &
echo "$!" > "${PID_FILE}"

for _ in $(seq 1 45); do
  if "${SOLANA_BIN}/solana" --url "${ANCHOR_PROVIDER_URL}" cluster-version >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! "${SOLANA_BIN}/solana" --url "${ANCHOR_PROVIDER_URL}" cluster-version >/dev/null 2>&1; then
  tail -120 "${LOG_FILE}" || true
  stop_validator
  exit 1
fi

"${SOLANA_BIN}/solana" --url "${ANCHOR_PROVIDER_URL}" airdrop 20 "$(cat "${ANCHOR_WALLET}" | "${SOLANA_BIN}/solana-keygen" pubkey -)" >/dev/null
npm run test:localnet
