#!/usr/bin/env bash
###############################################################################
#  JARVIS 2.0 // MASTER MANAGEMENT SCRIPT
#  Uzycie: ./jarvis.sh {start|stop|restart|status|logs|health}
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JARVIS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Zaladuj .env
if [[ -f "$JARVIS_DIR/.env" ]]; then
  set -a
  source "$JARVIS_DIR/.env"
  set +a
fi

# ─── Konfiguracja ───────────────────────────────────────────────────────────
NATS_PORT="${NATS_PORT:-4222}"
REDIS_PORT="${REDIS_PORT:-6379}"
GATEWAY_PORT="${JARVIS_PORT:-18900}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3000}"
NAS_MOUNT="${JARVIS_NAS_MOUNT:-$JARVIS_DIR/../jarvis-nas}"
TSX_BIN="$JARVIS_DIR/node_modules/.pnpm/node_modules/.bin/tsx"

# ─── Kolory ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ─── Funkcje ────────────────────────────────────────────────────────────────
is_port_open() {
  lsof -i ":$1" -P -n 2>/dev/null | grep -q LISTEN
}

get_pid_on_port() {
  lsof -ti ":$1" -sTCP:LISTEN 2>/dev/null | head -1
}

wait_for_port() {
  local port=$1
  local name=$2
  local timeout=${3:-15}
  local elapsed=0

  while ! is_port_open "$port"; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [[ $elapsed -ge $timeout ]]; then
      echo -e "  ${RED}✗${RESET} $name nie uruchomil sie w ciagu ${timeout}s"
      return 1
    fi
  done
  echo -e "  ${GREEN}✓${RESET} $name dziala (port $port)"
}

# ─── Komendy ────────────────────────────────────────────────────────────────
start_services() {
  echo ""
  echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${CYAN}║${RESET}  ${BOLD}JARVIS 2.0${RESET} ${DIM}// STARTING MASTER NODE${RESET}                     ${CYAN}║${RESET}"
  echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${RESET}"
  echo ""

  # --- NATS ---
  echo -e "${BOLD}▸ NATS Server${RESET}"
  if is_port_open "$NATS_PORT"; then
    echo -e "  ${GREEN}✓${RESET} NATS juz dziala (port $NATS_PORT)"
  else
    if [[ -f "$SCRIPT_DIR/nats.conf" ]]; then
      nats-server -c "$SCRIPT_DIR/nats.conf" &>/dev/null &
    else
      nats-server -p "$NATS_PORT" -a 0.0.0.0 &>/dev/null &
    fi
    wait_for_port "$NATS_PORT" "NATS" 10
  fi

  # --- Redis ---
  echo -e "${BOLD}▸ Redis${RESET}"
  if is_port_open "$REDIS_PORT"; then
    echo -e "  ${GREEN}✓${RESET} Redis juz dziala (port $REDIS_PORT)"
  else
    redis-server --port "$REDIS_PORT" --daemonize yes \
      --logfile "$NAS_MOUNT/logs/redis.log" 2>/dev/null || \
    redis-server --port "$REDIS_PORT" --daemonize yes 2>/dev/null
    wait_for_port "$REDIS_PORT" "Redis" 10
  fi

  # --- Gateway ---
  echo -e "${BOLD}▸ Gateway${RESET}"
  if is_port_open "$GATEWAY_PORT"; then
    echo -e "  ${GREEN}✓${RESET} Gateway juz dziala (port $GATEWAY_PORT)"
  else
    cd "$JARVIS_DIR"
    if [[ -f "$TSX_BIN" ]]; then
      nohup "$TSX_BIN" packages/gateway/src/index.ts \
        >> "$NAS_MOUNT/logs/gateway.log" 2>&1 &
    else
      nohup npx tsx packages/gateway/src/index.ts \
        >> "$NAS_MOUNT/logs/gateway.log" 2>&1 &
    fi
    echo $! > /tmp/jarvis-gateway.pid
    wait_for_port "$GATEWAY_PORT" "Gateway" 20
  fi

  # --- Dashboard ---
  echo -e "${BOLD}▸ Dashboard${RESET}"
  if is_port_open "$DASHBOARD_PORT"; then
    echo -e "  ${GREEN}✓${RESET} Dashboard juz dziala (port $DASHBOARD_PORT)"
  else
    cd "$JARVIS_DIR"
    nohup npx --filter @jarvis/dashboard vite --port "$DASHBOARD_PORT" \
      >> "$NAS_MOUNT/logs/dashboard.log" 2>&1 &
    # Fallback: pnpm dev:dashboard
    if ! wait_for_port "$DASHBOARD_PORT" "Dashboard" 15; then
      # Sprobuj inaczej
      nohup pnpm --filter @jarvis/dashboard dev \
        >> "$NAS_MOUNT/logs/dashboard.log" 2>&1 &
      wait_for_port "$DASHBOARD_PORT" "Dashboard (retry)" 15
    fi
  fi

  echo ""
  echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${GREEN}║${RESET}  ${BOLD}JARVIS 2.0 MASTER NODE IS RUNNING${RESET}                       ${GREEN}║${RESET}"
  echo -e "${GREEN}╠═══════════════════════════════════════════════════════════╣${RESET}"
  echo -e "${GREEN}║${RESET}  Dashboard:   ${BOLD}http://localhost:${DASHBOARD_PORT}${RESET}                    ${GREEN}║${RESET}"
  echo -e "${GREEN}║${RESET}  Gateway:     ${BOLD}http://localhost:${GATEWAY_PORT}${RESET}                   ${GREEN}║${RESET}"
  echo -e "${GREEN}║${RESET}  Health:      ${BOLD}http://localhost:${GATEWAY_PORT}/health${RESET}            ${GREEN}║${RESET}"
  echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${RESET}"
  echo ""
}

stop_services() {
  echo ""
  echo -e "${CYAN}[JARVIS]${RESET} Stopping all services..."
  echo ""

  # Dashboard
  echo -e "${BOLD}▸ Dashboard${RESET}"
  if is_port_open "$DASHBOARD_PORT"; then
    PID=$(get_pid_on_port "$DASHBOARD_PORT")
    if [[ -n "$PID" ]]; then
      kill "$PID" 2>/dev/null || true
      echo -e "  ${GREEN}✓${RESET} Dashboard stopped (PID: $PID)"
    fi
  else
    echo -e "  ${DIM}  Dashboard nie dzialal${RESET}"
  fi

  # Gateway
  echo -e "${BOLD}▸ Gateway${RESET}"
  if is_port_open "$GATEWAY_PORT"; then
    PID=$(get_pid_on_port "$GATEWAY_PORT")
    if [[ -n "$PID" ]]; then
      kill "$PID" 2>/dev/null || true
      echo -e "  ${GREEN}✓${RESET} Gateway stopped (PID: $PID)"
    fi
  else
    echo -e "  ${DIM}  Gateway nie dzialal${RESET}"
  fi
  rm -f /tmp/jarvis-gateway.pid

  # Redis
  echo -e "${BOLD}▸ Redis${RESET}"
  if is_port_open "$REDIS_PORT"; then
    redis-cli -p "$REDIS_PORT" shutdown nosave 2>/dev/null || \
    kill "$(get_pid_on_port "$REDIS_PORT")" 2>/dev/null || true
    echo -e "  ${GREEN}✓${RESET} Redis stopped"
  else
    echo -e "  ${DIM}  Redis nie dzialal${RESET}"
  fi

  # NATS
  echo -e "${BOLD}▸ NATS${RESET}"
  if is_port_open "$NATS_PORT"; then
    PID=$(get_pid_on_port "$NATS_PORT")
    if [[ -n "$PID" ]]; then
      kill "$PID" 2>/dev/null || true
      echo -e "  ${GREEN}✓${RESET} NATS stopped (PID: $PID)"
    fi
  else
    echo -e "  ${DIM}  NATS nie dzialal${RESET}"
  fi

  echo ""
  echo -e "${GREEN}[JARVIS]${RESET} Wszystkie serwisy zatrzymane"
  echo ""
}

show_status() {
  echo ""
  echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${CYAN}║${RESET}  ${BOLD}JARVIS 2.0 // SYSTEM STATUS${RESET}                             ${CYAN}║${RESET}"
  echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${RESET}"
  echo ""

  # --- Infrastructure ---
  echo -e "  ${BOLD}INFRASTRUCTURE${RESET}"
  echo ""

  # NATS
  if is_port_open "$NATS_PORT"; then
    echo -e "  ${GREEN}●${RESET} NATS Server      ${GREEN}RUNNING${RESET}  (port $NATS_PORT)"
  else
    echo -e "  ${RED}●${RESET} NATS Server      ${RED}STOPPED${RESET}"
  fi

  # Redis
  if is_port_open "$REDIS_PORT"; then
    REDIS_INFO=$(redis-cli -p "$REDIS_PORT" info memory 2>/dev/null | grep "used_memory_human" | cut -d: -f2 | tr -d '\r' || echo "?")
    echo -e "  ${GREEN}●${RESET} Redis            ${GREEN}RUNNING${RESET}  (port $REDIS_PORT, mem: $REDIS_INFO)"
  else
    echo -e "  ${RED}●${RESET} Redis            ${RED}STOPPED${RESET}"
  fi

  # NAS
  if [[ -d "$NAS_MOUNT" ]]; then
    echo -e "  ${GREEN}●${RESET} NAS Storage      ${GREEN}MOUNTED${RESET}  ($NAS_MOUNT)"
  else
    echo -e "  ${RED}●${RESET} NAS Storage      ${RED}NOT MOUNTED${RESET}"
  fi

  echo ""
  echo -e "  ${BOLD}SERVICES${RESET}"
  echo ""

  # Gateway
  if is_port_open "$GATEWAY_PORT"; then
    HEALTH=$(curl -s --connect-timeout 2 "http://localhost:$GATEWAY_PORT/health" 2>/dev/null || echo "{}")
    UPTIME=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); h=int(d.get('uptime',0))//3600; m=(int(d.get('uptime',0))%3600)//60; print(f'{h}h {m}m')" 2>/dev/null || echo "?")
    AGENTS=$(echo "$HEALTH" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('agents',[])))" 2>/dev/null || echo "0")
    CLIENTS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('dashboard',{}).get('connectedClients',0))" 2>/dev/null || echo "0")
    echo -e "  ${GREEN}●${RESET} Gateway          ${GREEN}RUNNING${RESET}  (port $GATEWAY_PORT, up: $UPTIME)"
    echo -e "    ${DIM}Agents: $AGENTS connected, Dashboard clients: $CLIENTS${RESET}"
  else
    echo -e "  ${RED}●${RESET} Gateway          ${RED}STOPPED${RESET}"
  fi

  # Dashboard
  if is_port_open "$DASHBOARD_PORT"; then
    echo -e "  ${GREEN}●${RESET} Dashboard        ${GREEN}RUNNING${RESET}  (http://localhost:$DASHBOARD_PORT)"
  else
    echo -e "  ${RED}●${RESET} Dashboard        ${RED}STOPPED${RESET}"
  fi

  echo ""

  # --- Agents ---
  if is_port_open "$GATEWAY_PORT"; then
    echo -e "  ${BOLD}AGENTS${RESET}"
    echo ""
    AGENT_LIST=$(curl -s --connect-timeout 2 "http://localhost:$GATEWAY_PORT/api/agents" 2>/dev/null || echo '{"agents":[]}')
    AGENT_COUNT=$(echo "$AGENT_LIST" | python3 -c "import sys,json; agents=json.load(sys.stdin).get('agents',[]); print(len(agents))" 2>/dev/null || echo "0")

    if [[ "$AGENT_COUNT" == "0" ]]; then
      echo -e "  ${DIM}  Brak polaczonych agentow${RESET}"
      echo -e "  ${DIM}  Uruchom agentow na Alpha/Beta: ./scripts/jarvis-agent.sh start${RESET}"
    else
      echo "$AGENT_LIST" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for a in data.get('agents', []):
    aid = a.get('identity', {}).get('agentId', '?')
    role = a.get('identity', {}).get('role', '?')
    status = a.get('status', 'unknown')
    color = '\033[0;32m' if status == 'idle' else '\033[1;33m' if status == 'busy' else '\033[0;31m'
    print(f'  {color}●\033[0m {aid:<16} {color}{status.upper()}\033[0m  (role: {role})')
" 2>/dev/null || echo -e "  ${DIM}  Nie mozna odczytac listy agentow${RESET}"
    fi
    echo ""
  fi
}

show_logs() {
  SERVICE="${2:-all}"

  case "$SERVICE" in
    gateway)
      echo -e "${CYAN}[JARVIS]${RESET} Logi Gateway:"
      tail -50 "$NAS_MOUNT/logs/gateway.log" 2>/dev/null || echo "Brak logow"
      ;;
    nats)
      echo -e "${CYAN}[JARVIS]${RESET} Logi NATS:"
      tail -50 "$NAS_MOUNT/logs/nats.log" 2>/dev/null || echo "Brak logow"
      ;;
    redis)
      echo -e "${CYAN}[JARVIS]${RESET} Logi Redis:"
      tail -50 "$NAS_MOUNT/logs/redis.log" 2>/dev/null || echo "Brak logow"
      ;;
    dashboard)
      echo -e "${CYAN}[JARVIS]${RESET} Logi Dashboard:"
      tail -50 "$NAS_MOUNT/logs/dashboard.log" 2>/dev/null || echo "Brak logow"
      ;;
    all|*)
      echo -e "${CYAN}[JARVIS]${RESET} Ostatnie logi (wszystkie serwisy):"
      echo ""
      for svc in gateway nats redis dashboard; do
        LOG="$NAS_MOUNT/logs/${svc}.log"
        if [[ -f "$LOG" ]]; then
          echo -e "  ${BOLD}=== $svc ===${RESET}"
          tail -10 "$LOG" 2>/dev/null
          echo ""
        fi
      done
      echo -e "${DIM}Uzyj: $0 logs {gateway|nats|redis|dashboard} dla konkretnego serwisu${RESET}"
      ;;
  esac
}

show_health() {
  if ! is_port_open "$GATEWAY_PORT"; then
    echo -e "${RED}Gateway nie dziala. Uruchom: $0 start${RESET}"
    exit 1
  fi

  curl -s "http://localhost:$GATEWAY_PORT/health" | python3 -m json.tool 2>/dev/null || \
  curl -s "http://localhost:$GATEWAY_PORT/health"
}

# ─── Main ────────────────────────────────────────────────────────────────────
case "${1:-help}" in
  start)    start_services ;;
  stop)     stop_services ;;
  restart)  stop_services; sleep 2; start_services ;;
  status)   show_status ;;
  logs)     show_logs "$@" ;;
  health)   show_health ;;
  *)
    echo ""
    echo -e "${BOLD}JARVIS 2.0 // Master Management${RESET}"
    echo ""
    echo "Uzycie: $0 {command}"
    echo ""
    echo "Komendy:"
    echo "  start       Uruchom wszystkie serwisy (NATS, Redis, Gateway, Dashboard)"
    echo "  stop        Zatrzymaj wszystkie serwisy"
    echo "  restart     Restart wszystkich serwisow"
    echo "  status      Pokaz status systemu"
    echo "  health      Pokaz health JSON z Gateway"
    echo "  logs        Pokaz logi (all|gateway|nats|redis|dashboard)"
    echo ""
    exit 1
    ;;
esac
