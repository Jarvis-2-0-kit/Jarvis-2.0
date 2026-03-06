#!/usr/bin/env bash
###############################################################################
#  JARVIS 2.0 // AGENT MANAGEMENT SCRIPT
#  Uzycie: bash scripts/jarvis-agent.sh {start|stop|restart|status|logs}
#
#  NOTE: This script requires bash. On zsh systems, invoke explicitly:
#        bash scripts/jarvis-agent.sh start
#
#  Zarzadza procesami agenta (tsx cli.ts) i websockify na maszynach slave.
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JARVIS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Kolory ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

# ─── Zaladuj .env ────────────────────────────────────────────────────────────
if [[ -f "$JARVIS_DIR/.env" ]]; then
  set -a
  source "$JARVIS_DIR/.env"
  set +a
fi

# ─── Konfiguracja ────────────────────────────────────────────────────────────
AGENT_ID="${JARVIS_AGENT_ID:-}"
ROLE="${JARVIS_AGENT_ROLE:-}"
# Auto-detect master IP: try mDNS hostname first, then env MASTER_IP, then fallback
if [[ -z "${NATS_URL:-}" ]]; then
  MASTER_RESOLVED=""
  # Try resolving master hostname via mDNS (.local)
  if command -v dscacheutil &>/dev/null; then
    MASTER_RESOLVED=$(dscacheutil -q host -a name mac-mini-master.local 2>/dev/null | awk '/ip_address:/{print $2; exit}')
  fi
  if [[ -z "$MASTER_RESOLVED" ]]; then
    MASTER_RESOLVED=$(getent hosts mac-mini-master.local 2>/dev/null | awk '{print $1; exit}' || true)
  fi
  if [[ -z "$MASTER_RESOLVED" ]]; then
    MASTER_RESOLVED="${MASTER_IP:-192.168.1.105}"
  fi
  NATS_URL="nats://${MASTER_RESOLVED}:4222"
  GATEWAY_URL="http://${MASTER_RESOLVED}:18900"
else
  GATEWAY_URL="${GATEWAY_URL:-http://$(echo "$NATS_URL" | sed 's|nats://||;s|:.*||'):18900}"
fi
NAS_MOUNT="${JARVIS_NAS_MOUNT:-$JARVIS_DIR/../jarvis-nas}"

# Port websockify: 6080 dla alpha, 6081 dla beta
if [[ "$AGENT_ID" == "agent-johny" ]]; then
  WSOCK_PORT=6081
else
  WSOCK_PORT=6080
fi
VNC_PORT=5900

PID_FILE="/tmp/jarvis-${AGENT_ID}.pid"
WSOCK_PID_FILE="/tmp/jarvis-websockify-${AGENT_ID}.pid"
AGENT_LOG="${NAS_MOUNT}/logs/${AGENT_ID}.log"
WSOCK_LOG="${NAS_MOUNT}/logs/websockify-${AGENT_ID}.log"
# Try .pnpm path first, then standard node_modules
if [[ -x "$JARVIS_DIR/node_modules/.pnpm/node_modules/.bin/tsx" ]]; then
  TSX_BIN="$JARVIS_DIR/node_modules/.pnpm/node_modules/.bin/tsx"
elif [[ -x "$JARVIS_DIR/node_modules/.bin/tsx" ]]; then
  TSX_BIN="$JARVIS_DIR/node_modules/.bin/tsx"
else
  TSX_BIN=""
fi

# ─── Funkcje ─────────────────────────────────────────────────────────────────
ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; }

is_port_open() {
  lsof -i ":$1" -P -n 2>/dev/null | grep -q LISTEN
}

find_websockify() {
  # 1. which
  local bin
  bin=$(command -v websockify 2>/dev/null || true)
  if [[ -n "$bin" ]]; then echo "$bin"; return; fi

  # 2. python3 shutil.which
  bin=$(python3 -c "import shutil; print(shutil.which('websockify') or '')" 2>/dev/null || true)
  if [[ -n "$bin" ]]; then echo "$bin"; return; fi

  # 3. Fallback: ~/Library/Python/*/bin/websockify
  for p in "$HOME"/Library/Python/*/bin/websockify; do
    if [[ -x "$p" ]]; then echo "$p"; return; fi
  done

  # 4. /opt/homebrew
  if [[ -x /opt/homebrew/bin/websockify ]]; then
    echo /opt/homebrew/bin/websockify; return
  fi

  echo ""
}

check_agent_id() {
  if [[ -z "$AGENT_ID" ]]; then
    fail "JARVIS_AGENT_ID nie ustawiony. Sprawdz .env"
    exit 1
  fi
}

# ─── START ───────────────────────────────────────────────────────────────────
do_start() {
  check_agent_id
  echo ""
  echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${CYAN}║${RESET}  ${BOLD}JARVIS 2.0${RESET} ${DIM}// STARTING $(echo "$AGENT_ID" | tr '[:lower:]' '[:upper:]')${RESET}                      ${CYAN}║${RESET}"
  echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${RESET}"
  echo ""

  mkdir -p "$NAS_MOUNT/logs"

  # --- Websockify ---
  echo -e "${BOLD}▸ Websockify${RESET} (port ${WSOCK_PORT} -> VNC ${VNC_PORT})"
  if is_port_open "$WSOCK_PORT"; then
    ok "Websockify juz dziala (port $WSOCK_PORT)"
  else
    WSOCK_BIN=$(find_websockify)
    if [[ -n "$WSOCK_BIN" ]]; then
      nohup "$WSOCK_BIN" "$WSOCK_PORT" "localhost:${VNC_PORT}" >> "$WSOCK_LOG" 2>&1 &
      echo $! > "$WSOCK_PID_FILE"
      sleep 2
      if is_port_open "$WSOCK_PORT"; then
        ok "Websockify uruchomiony (PID: $(cat "$WSOCK_PID_FILE"))"
      else
        fail "Websockify nie startowal - sprawdz: $WSOCK_LOG"
      fi
    else
      warn "Nie znaleziono websockify. Zainstaluj: pip3 install websockify"
    fi
  fi

  # --- Keychain unlock (needed for Claude CLI auth over SSH) ---
  if [[ -f "$HOME/Library/Keychains/login.keychain-db" ]]; then
    KEYCHAIN_PASS="${KEYCHAIN_PASSWORD:-137009}"
    security unlock-keychain -p "$KEYCHAIN_PASS" "$HOME/Library/Keychains/login.keychain-db" 2>/dev/null && \
      ok "Keychain unlocked" || warn "Keychain unlock failed (may need manual unlock)"
  fi

  # --- Ensure ANTHROPIC_AUTH_MODE is set ---
  export ANTHROPIC_AUTH_MODE="${ANTHROPIC_AUTH_MODE:-claude-cli}"

  # --- Agent Runtime ---
  echo -e "${BOLD}▸ Agent Runtime${RESET} (${AGENT_ID})"
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
    ok "Agent juz dziala (PID: $(cat "$PID_FILE"))"
  else
    cd "$JARVIS_DIR"

    if [[ -n "$TSX_BIN" && -f "$TSX_BIN" ]]; then
      nohup "$TSX_BIN" packages/agent-runtime/src/cli.ts >> "$AGENT_LOG" 2>&1 &
    elif command -v tsx &>/dev/null; then
      nohup tsx packages/agent-runtime/src/cli.ts >> "$AGENT_LOG" 2>&1 &
    else
      nohup npx tsx packages/agent-runtime/src/cli.ts >> "$AGENT_LOG" 2>&1 &
    fi
    echo $! > "$PID_FILE"
    sleep 3

    if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      ok "Agent Runtime uruchomiony (PID: $(cat "$PID_FILE"))"
    else
      fail "Agent Runtime nie startowal - sprawdz: $AGENT_LOG"
    fi
  fi

  echo ""
}

# ─── STOP ────────────────────────────────────────────────────────────────────
do_stop() {
  check_agent_id
  echo ""
  echo -e "${CYAN}[JARVIS]${RESET} Stopping ${AGENT_ID}..."
  echo ""

  # Stop Agent Runtime
  echo -e "${BOLD}▸ Agent Runtime${RESET}"
  if [[ -f "$PID_FILE" ]]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
      # Wait up to 5s for graceful shutdown (agent may be mid-task)
      for i in 1 2 3 4 5; do
        kill -0 "$PID" 2>/dev/null || break
        sleep 1
      done
      # Force kill if still running after grace period
      kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
      ok "Agent zatrzymany (PID: $PID)"
    else
      ok "Agent nie dzialal"
    fi
    rm -f "$PID_FILE"
  else
    # Try to find and kill by pattern
    pkill -f "tsx.*packages/agent-runtime/src/cli.ts" 2>/dev/null && ok "Agent zatrzymany" || ok "Agent nie dzialal"
  fi

  # Stop Websockify
  echo -e "${BOLD}▸ Websockify${RESET}"
  if [[ -f "$WSOCK_PID_FILE" ]]; then
    PID=$(cat "$WSOCK_PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
      ok "Websockify zatrzymany (PID: $PID)"
    else
      ok "Websockify nie dzialal"
    fi
    rm -f "$WSOCK_PID_FILE"
  else
    pkill -f "websockify.*${WSOCK_PORT}" 2>/dev/null && ok "Websockify zatrzymany" || ok "Websockify nie dzialal"
  fi

  echo ""
}

# ─── STATUS ──────────────────────────────────────────────────────────────────
do_status() {
  check_agent_id
  echo ""
  echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${CYAN}║${RESET}  ${BOLD}JARVIS 2.0 // AGENT STATUS${RESET}                              ${CYAN}║${RESET}"
  echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${RESET}"
  echo ""

  echo -e "  ${BOLD}IDENTITY${RESET}"
  echo -e "  Agent ID:   ${BOLD}${AGENT_ID}${RESET}"
  echo -e "  Role:       ${BOLD}${ROLE:-unknown}${RESET}"
  echo -e "  Machine:    $(hostname)"
  echo -e "  IP:         $(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 'unknown')"
  echo ""

  echo -e "  ${BOLD}PROCESSES${RESET}"
  echo ""

  # Agent Runtime
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
    echo -e "  ${GREEN}●${RESET} Agent Runtime    ${GREEN}RUNNING${RESET}  (PID: $(cat "$PID_FILE"))"
  else
    echo -e "  ${RED}●${RESET} Agent Runtime    ${RED}STOPPED${RESET}"
  fi

  # Websockify
  if is_port_open "$WSOCK_PORT"; then
    echo -e "  ${GREEN}●${RESET} Websockify       ${GREEN}RUNNING${RESET}  (port ${WSOCK_PORT} -> VNC ${VNC_PORT})"
  else
    echo -e "  ${RED}●${RESET} Websockify       ${RED}STOPPED${RESET}  (port ${WSOCK_PORT})"
  fi

  # VNC/Screen Sharing
  if is_port_open "$VNC_PORT"; then
    echo -e "  ${GREEN}●${RESET} Screen Sharing   ${GREEN}RUNNING${RESET}  (port ${VNC_PORT})"
  else
    echo -e "  ${RED}●${RESET} Screen Sharing   ${RED}STOPPED${RESET}"
  fi

  echo ""
  echo -e "  ${BOLD}CONNECTIVITY${RESET}"
  echo ""

  # NATS
  if nc -z -w 2 "$(echo "$NATS_URL" | sed 's|nats://||;s|:.*||')" "$(echo "$NATS_URL" | sed 's|.*:||')" 2>/dev/null; then
    echo -e "  ${GREEN}●${RESET} NATS             ${GREEN}REACHABLE${RESET}  ($NATS_URL)"
  else
    echo -e "  ${RED}●${RESET} NATS             ${RED}UNREACHABLE${RESET}  ($NATS_URL)"
  fi

  # Gateway
  if curl -s --connect-timeout 2 "$GATEWAY_URL/health" 2>/dev/null | grep -q '"status":"ok"'; then
    echo -e "  ${GREEN}●${RESET} Gateway          ${GREEN}REACHABLE${RESET}  ($GATEWAY_URL)"
  else
    echo -e "  ${RED}●${RESET} Gateway          ${RED}UNREACHABLE${RESET}  ($GATEWAY_URL)"
  fi

  echo ""
}

# ─── LOGS ────────────────────────────────────────────────────────────────────
do_logs() {
  check_agent_id
  local target="${1:-all}"

  case "$target" in
    agent)
      echo -e "${CYAN}[JARVIS]${RESET} Logi Agent Runtime (${AGENT_ID}):"
      tail -50 "$AGENT_LOG" 2>/dev/null || echo "  Brak logow: $AGENT_LOG"
      ;;
    websockify|wsock)
      echo -e "${CYAN}[JARVIS]${RESET} Logi Websockify (${AGENT_ID}):"
      tail -50 "$WSOCK_LOG" 2>/dev/null || echo "  Brak logow: $WSOCK_LOG"
      ;;
    follow|tail|-f)
      echo -e "${CYAN}[JARVIS]${RESET} Following logs (Ctrl+C to stop)..."
      tail -f "$AGENT_LOG" "$WSOCK_LOG" 2>/dev/null || tail -f "$AGENT_LOG" 2>/dev/null || echo "  Brak logow"
      ;;
    all|*)
      echo -e "${CYAN}[JARVIS]${RESET} Logi agenta (${AGENT_ID}):"
      echo ""
      echo -e "  ${BOLD}=== Agent Runtime ===${RESET}"
      tail -20 "$AGENT_LOG" 2>/dev/null || echo "  Brak logow: $AGENT_LOG"
      echo ""
      echo -e "  ${BOLD}=== Websockify ===${RESET}"
      tail -10 "$WSOCK_LOG" 2>/dev/null || echo "  Brak logow: $WSOCK_LOG"
      echo ""
      echo -e "${DIM}Uzyj: $0 logs {agent|websockify|follow}${RESET}"
      ;;
  esac
}

# ─── Main ────────────────────────────────────────────────────────────────────
do_start_websockify() {
  check_agent_id
  echo -e "${BOLD}▸ Websockify${RESET} (port ${WSOCK_PORT} -> VNC ${VNC_PORT})"
  if is_port_open "$WSOCK_PORT"; then
    ok "Websockify juz dziala (port $WSOCK_PORT)"
  else
    WSOCK_BIN=$(find_websockify)
    if [[ -n "$WSOCK_BIN" ]]; then
      mkdir -p "$NAS_MOUNT/logs" 2>/dev/null || true
      nohup "$WSOCK_BIN" "$WSOCK_PORT" "localhost:${VNC_PORT}" >> "$WSOCK_LOG" 2>&1 &
      echo $! > "$WSOCK_PID_FILE"
      sleep 2
      if is_port_open "$WSOCK_PORT"; then
        ok "Websockify uruchomiony (PID: $(cat "$WSOCK_PID_FILE"))"
      else
        fail "Websockify nie startowal - sprawdz: $WSOCK_LOG"
      fi
    else
      warn "Nie znaleziono websockify. Zainstaluj: pip3 install websockify"
    fi
  fi
}

case "${1:-help}" in
  start)              do_start ;;
  stop)               do_stop ;;
  restart)            do_stop; sleep 2; do_start ;;
  status)             do_status ;;
  logs)               do_logs "${2:-all}" ;;
  start-websockify)   do_start_websockify ;;
  *)
    echo ""
    echo -e "${BOLD}JARVIS 2.0 // Agent Management${RESET}"
    echo ""
    echo "Uzycie: $0 {command}"
    echo ""
    echo "Komendy:"
    echo "  start             Uruchom agenta i websockify"
    echo "  stop              Zatrzymaj agenta i websockify"
    echo "  restart           Restart agenta"
    echo "  status            Pokaz status agenta, procesow i polaczen"
    echo "  logs              Pokaz logi (all|agent|websockify|follow)"
    echo "  start-websockify  Uruchom tylko websockify"
    echo ""
    exit 1
    ;;
esac
