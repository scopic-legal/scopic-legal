#!/usr/bin/env bash
# Start every service Scopic needs for local dev: the markitdown-agent
# (sibling Python service) in the background, then the Scopic
# (Express + Vite) in the foreground. Ctrl+C cleanly stops both.
#
# For the bare chat-only setup (no DOCX conversion / DOCX export, no document
# tools), use `pnpm dev` instead — that's a single-service start with no
# Python dependency.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEAMSUZIE_DIR="$(cd "$ROOT_DIR/../open_teamsuzie" 2>/dev/null && pwd || true)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
log()  { echo -e "${GREEN}[dev-up]${NC} $*"; }
warn() { echo -e "${YELLOW}[dev-up]${NC} $*"; }
err()  { echo -e "${RED}[dev-up]${NC} $*" >&2; }

if [ -z "${TEAMSUZIE_DIR:-}" ] || [ ! -d "$TEAMSUZIE_DIR" ]; then
  err "expected sibling Team Suzie clone at $ROOT_DIR/../open_teamsuzie"
  err "see README.md → Layout"
  exit 1
fi

LOG_DIR="$ROOT_DIR/.dev-logs"
mkdir -p "$LOG_DIR"

# --- Postgres + Redis (Docker) ---
# shared-auth needs Postgres (users/orgs) and Redis (sessions). Boot them via
# docker-compose if Docker is around; skip silently otherwise so a user with
# their own Postgres/Redis running on the configured URIs isn't blocked.
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.yml"
if [ -f "$COMPOSE_FILE" ] && command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    log "starting Postgres + Redis (docker compose, logs: $LOG_DIR/docker.log)"
    docker compose -f "$COMPOSE_FILE" up -d >"$LOG_DIR/docker.log" 2>&1 || {
      warn "docker compose up failed — continuing. Tail of log:"
      tail -20 "$LOG_DIR/docker.log" >&2 || true
    }
  else
    warn "docker is present but 'docker compose' subcommand not available — skipping infra boot"
  fi
else
  warn "docker not found — skipping Postgres/Redis boot. Make sure they're already running on the ports in .env (defaults: 5433, 6380)."
fi

CHILD_PIDS=()
cleanup() {
  if [ "${#CHILD_PIDS[@]}" -gt 0 ]; then
    log "stopping background services…"
    for pid in "${CHILD_PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        # Send SIGTERM to the entire process group so children (uvicorn,
        # tsx, etc.) shut down too — not just the wrapper bash script.
        kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      fi
    done
  fi
}
trap cleanup EXIT

# --- markitdown-agent (Python, port 3013) ---
log "starting markitdown-agent (logs: $LOG_DIR/markitdown-agent.log)"
# setsid puts the child in its own process group so we can SIGTERM the group
# on cleanup. macOS doesn't ship setsid; fall back to plain backgrounding.
if command -v setsid >/dev/null 2>&1; then
  setsid bash "$TEAMSUZIE_DIR/apps/agents/markitdown-agent/dev.sh" \
    >"$LOG_DIR/markitdown-agent.log" 2>&1 &
else
  bash "$TEAMSUZIE_DIR/apps/agents/markitdown-agent/dev.sh" \
    >"$LOG_DIR/markitdown-agent.log" 2>&1 &
fi
CHILD_PIDS+=($!)

# Wait until the agent is healthy or 60s elapses. Fail fast if it died.
log "waiting for markitdown-agent to come up…"
for i in $(seq 1 60); do
  if ! kill -0 "${CHILD_PIDS[0]}" 2>/dev/null; then
    err "markitdown-agent process died on startup. Tail of log:"
    tail -30 "$LOG_DIR/markitdown-agent.log" >&2
    exit 1
  fi
  if curl -fsS http://localhost:3013/health >/dev/null 2>&1; then
    log "markitdown-agent ready (http://localhost:3013)"
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    warn "markitdown-agent /health didn't respond within 60s — continuing anyway. tail of log:"
    tail -30 "$LOG_DIR/markitdown-agent.log" >&2 || true
  fi
done

# --- Scopic (Express + Vite, ports 17501 + 17502) ---
log "starting Scopic (foreground). Ctrl+C to stop everything."
cd "$ROOT_DIR"
pnpm dev
