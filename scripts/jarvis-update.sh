#!/usr/bin/env bash
###############################################################################
#  JARVIS 2.0 // OTA UPDATE TRAMPOLINE
#  Spawned by gateway as a detached process. Does git pull → build → restart.
#  Gateway can't restart itself (it'd die mid-restart), so this script outlives it.
###############################################################################

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JARVIS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LOCK_FILE="/tmp/jarvis-update.lock"
STATUS_FILE="/tmp/jarvis-update-status.json"
LOG_FILE="/tmp/jarvis-update.log"

# ─── Helpers ─────────────────────────────────────────────────────────────────

write_status() {
  local status="$1"
  local message="$2"
  local prev_head="${3:-}"
  local new_head="${4:-}"
  cat > "$STATUS_FILE" <<STATUSEOF
{
  "status": "$status",
  "message": "$message",
  "prevHead": "$prev_head",
  "newHead": "$new_head",
  "timestamp": $(date +%s)000
}
STATUSEOF
}

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# ─── Lock ────────────────────────────────────────────────────────────────────

if [[ -f "$LOCK_FILE" ]]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  if [[ -n "$LOCK_PID" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
    log "ERROR: Another update is already running (PID $LOCK_PID)"
    write_status "error" "Another update is already running" "" ""
    exit 1
  fi
  # Stale lock — remove it
  rm -f "$LOCK_FILE"
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# ─── Begin Update ────────────────────────────────────────────────────────────

cd "$JARVIS_DIR"

log "=== JARVIS OTA UPDATE STARTED ==="
write_status "running" "Starting update..." "" ""

# Save current HEAD
PREV_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
log "Current HEAD: $PREV_HEAD"

# ─── Git Pull ────────────────────────────────────────────────────────────────

log "Running git pull..."
if ! git pull --ff-only 2>&1 | tee -a "$LOG_FILE"; then
  log "ERROR: git pull failed — no code changed"
  write_status "error" "git pull failed — no code changed" "$PREV_HEAD" "$PREV_HEAD"
  exit 1
fi

NEW_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
log "New HEAD: $NEW_HEAD"

if [[ "$PREV_HEAD" == "$NEW_HEAD" ]]; then
  log "Already up to date — no changes pulled"
  write_status "done" "Already up to date" "$PREV_HEAD" "$NEW_HEAD"
  # Still restart to pick up any pending changes
fi

# ─── Install Dependencies ────────────────────────────────────────────────────

log "Running pnpm install..."
write_status "running" "Installing dependencies..." "$PREV_HEAD" "$NEW_HEAD"
if ! pnpm install --frozen-lockfile 2>&1 | tee -a "$LOG_FILE"; then
  log "WARN: pnpm install --frozen-lockfile failed, trying without flag..."
  if ! pnpm install 2>&1 | tee -a "$LOG_FILE"; then
    log "ERROR: pnpm install failed — rolling back"
    git reset --hard "$PREV_HEAD" 2>&1 | tee -a "$LOG_FILE"
    write_status "error" "pnpm install failed — rolled back to previous version" "$PREV_HEAD" "$PREV_HEAD"
    # Restart with old code anyway
    "$SCRIPT_DIR/jarvis.sh" restart >> "$LOG_FILE" 2>&1 || true
    exit 1
  fi
fi

# ─── Build ───────────────────────────────────────────────────────────────────

log "Running pnpm build..."
write_status "running" "Building..." "$PREV_HEAD" "$NEW_HEAD"
if ! pnpm build 2>&1 | tee -a "$LOG_FILE"; then
  log "ERROR: Build failed — rolling back to $PREV_HEAD"
  write_status "running" "Build failed — rolling back..." "$PREV_HEAD" "$NEW_HEAD"

  # Rollback
  git reset --hard "$PREV_HEAD" 2>&1 | tee -a "$LOG_FILE"
  pnpm install 2>&1 | tee -a "$LOG_FILE" || true
  pnpm build 2>&1 | tee -a "$LOG_FILE" || true

  write_status "error" "Build failed — rolled back to previous version" "$PREV_HEAD" "$PREV_HEAD"

  # Restart with old code
  log "Restarting with previous version..."
  "$SCRIPT_DIR/jarvis.sh" restart >> "$LOG_FILE" 2>&1 || true
  exit 1
fi

# ─── Restart ─────────────────────────────────────────────────────────────────

log "Build successful. Restarting Jarvis..."
write_status "done" "Update complete" "$PREV_HEAD" "$NEW_HEAD"

# Small delay to let gateway read status before dying
sleep 1

"$SCRIPT_DIR/jarvis.sh" restart >> "$LOG_FILE" 2>&1

log "=== JARVIS OTA UPDATE COMPLETED ==="
