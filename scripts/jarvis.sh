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
    echo $! > /tmp/jarvis-nats.pid
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
    # Save redis PID from port detection (redis daemonizes itself)
    REDIS_PID=$(get_pid_on_port "$REDIS_PORT")
    [[ -n "$REDIS_PID" ]] && echo "$REDIS_PID" > /tmp/jarvis-redis.pid
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

  # --- Jarvis Orchestrator Agent ---
  echo -e "${BOLD}▸ Jarvis Orchestrator${RESET}"
  if [[ -f /tmp/jarvis-orchestrator.pid ]] && kill -0 "$(cat /tmp/jarvis-orchestrator.pid 2>/dev/null)" 2>/dev/null; then
    echo -e "  ${GREEN}✓${RESET} Orchestrator juz dziala (PID: $(cat /tmp/jarvis-orchestrator.pid))"
  else
    cd "$JARVIS_DIR"
    JARVIS_AGENT_ID=jarvis JARVIS_AGENT_ROLE=orchestrator \
      nohup "$TSX_BIN" packages/agent-runtime/src/cli.ts \
        >> "$NAS_MOUNT/logs/jarvis.log" 2>&1 &
    echo $! > /tmp/jarvis-orchestrator.pid
    sleep 3
    if kill -0 "$(cat /tmp/jarvis-orchestrator.pid 2>/dev/null)" 2>/dev/null; then
      echo -e "  ${GREEN}✓${RESET} Orchestrator uruchomiony (PID: $(cat /tmp/jarvis-orchestrator.pid))"
    else
      echo -e "  ${RED}✗${RESET} Orchestrator nie startowal - sprawdz: $NAS_MOUNT/logs/jarvis.log"
    fi
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

  # Orchestrator
  echo -e "${BOLD}▸ Jarvis Orchestrator${RESET}"
  if [[ -f /tmp/jarvis-orchestrator.pid ]]; then
    PID=$(cat /tmp/jarvis-orchestrator.pid)
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
      echo -e "  ${GREEN}✓${RESET} Orchestrator stopped (PID: $PID)"
    else
      echo -e "  ${DIM}  Orchestrator nie dzialal${RESET}"
    fi
    rm -f /tmp/jarvis-orchestrator.pid
  else
    # Try to find and kill by pattern
    pkill -f "JARVIS_AGENT_ID=jarvis.*cli.ts" 2>/dev/null && echo -e "  ${GREEN}✓${RESET} Orchestrator stopped" || echo -e "  ${DIM}  Orchestrator nie dzialal${RESET}"
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
  rm -f /tmp/jarvis-redis.pid

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
  rm -f /tmp/jarvis-nats.pid

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

  # Orchestrator
  if [[ -f /tmp/jarvis-orchestrator.pid ]] && kill -0 "$(cat /tmp/jarvis-orchestrator.pid 2>/dev/null)" 2>/dev/null; then
    echo -e "  ${GREEN}●${RESET} Orchestrator     ${GREEN}RUNNING${RESET}  (PID: $(cat /tmp/jarvis-orchestrator.pid))"
  else
    echo -e "  ${RED}●${RESET} Orchestrator     ${RED}STOPPED${RESET}"
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

# ─── Remote Agent Management ─────────────────────────────────────────────────

# Remote agent config (bash 3.2 compatible — no associative arrays)
ALPHA_HOST_CFG="${ALPHA_IP:-${VNC_ALPHA_HOST:-}}"
ALPHA_USER_CFG="${ALPHA_USER:-${VNC_ALPHA_USERNAME:-agent_smith}}"
ALPHA_AGENT_ID="agent-smith"
BETA_HOST_CFG="${BETA_IP:-${VNC_BETA_HOST:-}}"
BETA_USER_CFG="${BETA_USER:-${VNC_BETA_USERNAME:-agent_johny}}"
BETA_AGENT_ID="agent-johny"

# Resolve agent config by name
_agent_host()    { eval echo "\${${1}_HOST_CFG}"; }
_agent_user()    { eval echo "\${${1}_USER_CFG}"; }
_agent_id()      { eval echo "\${${1}_AGENT_ID}"; }

ssh_to_agent() {
  local name="$1" cmd="$2"
  local host; host=$(_agent_host "$(echo "$name" | tr '[:lower:]' '[:upper:]')")
  local user; user=$(_agent_user "$(echo "$name" | tr '[:lower:]' '[:upper:]')")
  if [[ -z "$host" ]]; then
    echo -e "  ${RED}✗${RESET} ${name}: no host configured"
    return 1
  fi
  ssh -o ConnectTimeout=5 \
      -o ServerAliveInterval=10 \
      -o ServerAliveCountMax=3 \
      -o StrictHostKeyChecking=accept-new \
      "${user}@${host}" "$cmd"
}

agents_start() {
  echo ""
  echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${CYAN}║${RESET}  ${BOLD}JARVIS 2.0${RESET} ${DIM}// STARTING REMOTE AGENTS${RESET}                    ${CYAN}║${RESET}"
  echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${RESET}"
  echo ""

  for name in alpha beta; do
    local upper; upper=$(echo "$name" | tr '[:lower:]' '[:upper:]')
    local host; host=$(_agent_host "$upper")
    local user; user=$(_agent_user "$upper")
    local agent_id; agent_id=$(_agent_id "$upper")
    if [[ -z "$host" ]]; then
      warn "${name}: no host configured, skipping"
      continue
    fi

    echo -e "${BOLD}▸ ${name}${RESET} (${user}@${host} — ${agent_id})"

    # First start websockify via normal SSH (nohup OK for websockify — it's a simple proxy)
    ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new \
        "${user}@${host}" \
        "cd ~/Documents/Jarvis-2.0/jarvis && bash scripts/jarvis-agent.sh start-websockify" \
        </dev/null 2>/dev/null || true

    # Kill any existing agent process on remote
    ssh -o ConnectTimeout=5 "${user}@${host}" \
        "pkill -f 'tsx.*agent-runtime/src/cli.ts' 2>/dev/null; pkill -f 'node.*agent-runtime/src/cli.ts' 2>/dev/null" \
        </dev/null 2>/dev/null || true

    # Kill old SSH tunnel if exists
    local pid_file="/tmp/jarvis-ssh-${agent_id}.pid"
    if [[ -f "$pid_file" ]]; then
      kill "$(cat "$pid_file")" 2>/dev/null || true
      rm -f "$pid_file"
    fi

    sleep 1

    # Start agent via PERSISTENT SSH session (foreground on remote, background here).
    # macOS revokes network access for orphaned background processes (nohup/screen)
    # when the SSH session closes. Keeping SSH alive prevents this.
    local log_file="/tmp/jarvis-ssh-${agent_id}.log"
    nohup ssh -o ConnectTimeout=10 \
              -o ServerAliveInterval=10 \
              -o ServerAliveCountMax=30 \
              -o StrictHostKeyChecking=accept-new \
              "${user}@${host}" \
              "source ~/.nvm/nvm.sh 2>/dev/null && nvm use 22 2>/dev/null; cd ~/Documents/Jarvis-2.0/jarvis && set -a && source .env && set +a && export ANTHROPIC_AUTH_MODE=\${ANTHROPIC_AUTH_MODE:-claude-cli} && security unlock-keychain -p \${KEYCHAIN_PASSWORD:-137009} ~/Library/Keychains/login.keychain-db 2>/dev/null; exec node_modules/.bin/tsx packages/agent-runtime/src/cli.ts" \
              > "$log_file" 2>&1 &

    local ssh_pid=$!
    echo "$ssh_pid" > "$pid_file"

    # Wait briefly for connection
    sleep 3
    if kill -0 "$ssh_pid" 2>/dev/null; then
      ok "Agent running via persistent SSH (PID: ${ssh_pid})"
    else
      fail "SSH session died — check: ${log_file}"
    fi
  done

  echo ""
}

agents_stop() {
  echo ""
  echo -e "${CYAN}[JARVIS]${RESET} Stopping remote agents..."
  echo ""

  for name in alpha beta; do
    local upper; upper=$(echo "$name" | tr '[:lower:]' '[:upper:]')
    local host; host=$(_agent_host "$upper")
    local agent_id; agent_id=$(_agent_id "$upper")
    if [[ -z "$host" ]]; then continue; fi

    echo -e "${BOLD}▸ ${name}${RESET} (${agent_id})"

    ssh_to_agent "$name" "cd ~/Documents/Jarvis-2.0/jarvis && bash scripts/jarvis-agent.sh stop" 2>/dev/null \
      && echo -e "  ${GREEN}✓${RESET} Agent stopped on ${name}" \
      || echo -e "  ${RED}✗${RESET} Could not reach ${name}"

    local pid_file="/tmp/jarvis-ssh-${agent_id}.pid"
    if [[ -f "$pid_file" ]]; then
      kill "$(cat "$pid_file")" 2>/dev/null || true
      rm -f "$pid_file"
    fi
  done

  echo ""
}

agents_status() {
  echo ""
  echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${CYAN}║${RESET}  ${BOLD}JARVIS 2.0 // REMOTE AGENT STATUS${RESET}                       ${CYAN}║${RESET}"
  echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${RESET}"
  echo ""

  for name in alpha beta; do
    local upper; upper=$(echo "$name" | tr '[:lower:]' '[:upper:]')
    local host; host=$(_agent_host "$upper")
    local user; user=$(_agent_user "$upper")
    if [[ -z "$host" ]]; then
      echo -e "  ${DIM}${name}: not configured${RESET}"
      continue
    fi

    echo -e "${BOLD}▸ ${name}${RESET} (${user}@${host})"
    ssh_to_agent "$name" "cd ~/Documents/Jarvis-2.0/jarvis && bash scripts/jarvis-agent.sh status" 2>/dev/null \
      || echo -e "  ${RED}✗${RESET} Could not reach ${name} (${host})"
    echo ""
  done
}

ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; }

# ─── Main ────────────────────────────────────────────────────────────────────
case "${1:-help}" in
  start)          start_services ;;
  stop)           stop_services ;;
  restart)        stop_services; sleep 2; start_services ;;
  status)         show_status ;;
  logs)           show_logs "$@" ;;
  health)         show_health ;;
  agents-start)   agents_start ;;
  agents-stop)    agents_stop ;;
  agents-status)  agents_status ;;
  *)
    echo ""
    echo -e "${BOLD}JARVIS 2.0 // Master Management${RESET}"
    echo ""
    echo "Uzycie: $0 {command}"
    echo ""
    echo "Komendy:"
    echo "  start          Uruchom wszystkie serwisy (NATS, Redis, Gateway, Dashboard)"
    echo "  stop           Zatrzymaj wszystkie serwisy"
    echo "  restart        Restart wszystkich serwisow"
    echo "  status         Pokaz status systemu"
    echo "  health         Pokaz health JSON z Gateway"
    echo "  logs           Pokaz logi (all|gateway|nats|redis|dashboard)"
    echo ""
    echo "  agents-start   Uruchom agentow na zdalnych maszynach (Alpha/Beta)"
    echo "  agents-stop    Zatrzymaj agentow na zdalnych maszynach"
    echo "  agents-status  Pokaz status zdalnych agentow"
    echo ""
    exit 1
    ;;
esac
