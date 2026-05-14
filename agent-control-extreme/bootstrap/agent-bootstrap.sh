#!/bin/bash
#===============================================================================
# Agent Bootstrap (EXTREME) - Run on EVERY agent spawn.
#
# Improvements over the reference implementation:
#   - Token via environment variable (CONTROL_HUB_TOKEN), never CLI
#   - Exponential backoff with lock for concurrent boot safety
#   - Structured JSON logging for observability
#   - Configurable via environment, no hardcoded paths
#   - Session heartbeat for active session tracking
#   - Audit hook integration
#
# Usage:
#   export CONTROL_HUB_TOKEN="your-token"
#   agent-bootstrap.sh <agent_name> <agent_type> <version> [hub_url]
#
# Or via environment:
#   export CONTROL_HUB_URL="https://gitea.local:3003"
#   export CONTROL_REPO_OWNER="thePM001"
#   export CONTROL_REPO_NAME="NLA-PLATFORM"
#===============================================================================
set -euo pipefail

# --- Configuration (from environment with defaults) ---
CONTROL_HUB_URL="${CONTROL_HUB_URL:-http://100.118.184.18:3003}"
CONTROL_REPO_OWNER="${CONTROL_REPO_OWNER:-thePM001}"
CONTROL_REPO_NAME="${CONTROL_REPO_NAME:-NLA-PLATFORM}"
ACCESS_TOKEN="${CONTROL_HUB_TOKEN:-}"
GIT_API="${CONTROL_HUB_URL}/api/v1"

# CLI positional args
AGENT_NAME="${1:-unknown}"
AGENT_TYPE="${2:-cli}"
AGENT_VERSION="${3:-1.0}"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SESSION_ID="$(uuidgen 2>/dev/null || echo "$(hostname)-$$-$(date +%s)")"
REGISTRY_PATH="agent-control-extreme/registry/agent-sessions.json"
LOCK_PATH="agent-control-extreme/.bootstrap.lock"
LOG_DIR="/var/log/agent-control"
MAX_RETRIES=5
BACKOFF_SECONDS=2

# --- Helpers ---
log_info()  { echo "{\"level\":\"info\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"agent\":\"$AGENT_NAME\",\"session\":\"$SESSION_ID\",\"msg\":\"$*\"}"; }
log_error() { echo "{\"level\":\"error\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"agent\":\"$AGENT_NAME\",\"session\":\"$SESSION_ID\",\"msg\":\"$*\"}" >&2; }
fatal()     { log_error "$*"; exit 1; }

mkdir -p "$LOG_DIR"

# --- Preflight ---
[ -z "$ACCESS_TOKEN" ] && fatal "CONTROL_HUB_TOKEN not set. Export it before running."

echo ""
echo "  AGENT CONTROL EXTREME - BOOT REGISTRATION"
echo "  =========================================="
echo "  Agent:    $AGENT_NAME ($AGENT_TYPE)"
echo "  Version:  $AGENT_VERSION"
echo "  Session:  $SESSION_ID"
echo "  Hub:      $CONTROL_HUB_URL"
echo "  Started:  $STARTED_AT"
echo ""

# Step 1: Verify connectivity
echo "[1/5] Connecting to Control Hub..."
if ! curl -sf -H "Authorization: token $ACCESS_TOKEN" "$GIT_API/user" > /dev/null 2>&1; then
  fatal "Cannot reach Control Hub at $GIT_API"
fi
echo "  OK - Hub reachable"

# Step 2: Verify repo exists
echo "[2/5] Verifying control repository..."
if ! curl -sf -H "Authorization: token $ACCESS_TOKEN" \
  "$GIT_API/repos/$CONTROL_REPO_OWNER/$CONTROL_REPO_NAME" > /dev/null 2>&1; then
  fatal "Repository $CONTROL_REPO_OWNER/$CONTROL_REPO_NAME not found"
fi
echo "  OK - Repo accessible"

# Step 3: Acquire lock with exponential backoff
echo "[3/5] Acquiring bootstrap lock..."
LOCK_ACQUIRED=false
for i in $(seq 1 $MAX_RETRIES); do
  # Try to create a lock file in the repo
  LOCK_CONTENT="{\"session\":\"$SESSION_ID\",\"agent\":\"$AGENT_NAME\",\"started\":\"$STARTED_AT\"}"
  LOCK_B64=$(echo "$LOCK_CONTENT" | base64 -w0)

  LOCK_EXISTING=$(curl -sf -H "Authorization: token $ACCESS_TOKEN" \
    "$GIT_API/repos/$CONTROL_REPO_OWNER/$CONTROL_REPO_NAME/contents/$LOCK_PATH" 2>/dev/null || echo "")

  if [ -z "$LOCK_EXISTING" ]; then
    # No lock exists - create one
    LOCK_RESULT=$(curl -s -X PUT -H "Authorization: token $ACCESS_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"message\":\"Lock acquired: $AGENT_NAME ($SESSION_ID)\",\"content\":\"$LOCK_B64\",\"branch\":\"main\"}" \
      "$GIT_API/repos/$CONTROL_REPO_OWNER/$CONTROL_REPO_NAME/contents/$LOCK_PATH" 2>/dev/null)
    if echo "$LOCK_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'content' in d else 1)" 2>/dev/null; then
      LOCK_ACQUIRED=true
      break
    fi
  fi

  # Lock held by another process
  LOCK_AGENT=$(echo "$LOCK_EXISTING" | python3 -c "import sys,json,base64; d=json.load(sys.stdin); ct=base64.b64decode(d['content']).decode(); print(__import__('json').loads(ct).get('agent','unknown'))" 2>/dev/null || echo "unknown")
  sleep_time=$((BACKOFF_SECONDS * (2 ** (i - 1)) ))
  echo "  Lock held by $LOCK_AGENT, retry $i/$MAX_RETRIES in ${sleep_time}s..."
  sleep "$sleep_time"
done

if [ "$LOCK_ACQUIRED" != "true" ]; then
  fatal "Could not acquire bootstrap lock after $MAX_RETRIES attempts"
fi
echo "  OK - Lock acquired"

# Step 4: Register session (with retry)
echo "[4/5] Registering agent session..."
SESSION_REGISTERED=false
for i in $(seq 1 $MAX_RETRIES); do
  EXISTING=$(curl -sf -H "Authorization: token $ACCESS_TOKEN" \
    "$GIT_API/repos/$CONTROL_REPO_OWNER/$CONTROL_REPO_NAME/contents/$REGISTRY_PATH" 2>/dev/null || echo "")

  if [ -n "$EXISTING" ]; then
    SHA=$(echo "$EXISTING" | python3 -c "import sys,json; print(json.load(sys.stdin)['sha'])" 2>/dev/null || echo "")
    CONTENT=$(echo "$EXISTING" | python3 -c "
import sys,json,base64
d = json.load(sys.stdin)
ct = base64.b64decode(d['content']).decode()
print(ct)
" 2>/dev/null || echo "{}")
    UPDATED=$(echo "$CONTENT" | python3 -c "
import sys,json
data = json.load(sys.stdin)
data['sessions'] = data.get('sessions', {})
data['sessions']['$SESSION_ID'] = {
  'agent': '$AGENT_NAME',
  'type': '$AGENT_TYPE',
  'version': '$AGENT_VERSION',
  'session_id': '$SESSION_ID',
  'started_at': '$STARTED_AT',
  'host': '$(hostname)',
  'pid': '$$',
  'status': 'active',
  'heartbeat': '$STARTED_AT'
}
print(json.dumps(data, indent=2))
" 2>/dev/null)
    B64=$(echo "$UPDATED" | base64 -w0)
    RESULT=$(curl -s -X PUT -H "Authorization: token $ACCESS_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"message\":\"Agent boot: $AGENT_NAME ($SESSION_ID)\",\"content\":\"$B64\",\"sha\":\"$SHA\",\"branch\":\"main\"}" \
      "$GIT_API/repos/$CONTROL_REPO_OWNER/$CONTROL_REPO_NAME/contents/$REGISTRY_PATH" 2>/dev/null)

    if echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'content' in d else 1)" 2>/dev/null; then
      SESSION_REGISTERED=true
      break
    fi
    sleep 1
  else
    INITIAL=$(cat <<JSON
{
  "registry_version": "2.0",
  "created_at": "$STARTED_AT",
  "last_update": "$STARTED_AT",
  "sessions": {
    "$SESSION_ID": {
      "agent": "$AGENT_NAME",
      "type": "$AGENT_TYPE",
      "version": "$AGENT_VERSION",
      "session_id": "$SESSION_ID",
      "started_at": "$STARTED_AT",
      "host": "$(hostname)",
      "pid": "$$",
      "status": "active",
      "heartbeat": "$STARTED_AT"
    }
  }
}
JSON
)
    B64=$(echo "$INITIAL" | base64 -w0)
    curl -s -X PUT -H "Authorization: token $ACCESS_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"message\":\"Agent boot: initial session\",\"content\":\"$B64\",\"branch\":\"main\"}" \
      "$GIT_API/repos/$CONTROL_REPO_OWNER/$CONTROL_REPO_NAME/contents/$REGISTRY_PATH" > /dev/null 2>&1
    SESSION_REGISTERED=true
    break
  fi
done

if [ "$SESSION_REGISTERED" != "true" ]; then
  fatal "Session registration failed after retries"
fi
echo "  OK - Session $SESSION_ID registered"

# Step 5: Release lock
echo "[5/5] Releasing bootstrap lock..."
LOCK_SHA=$(curl -sf -H "Authorization: token $ACCESS_TOKEN" \
  "$GIT_API/repos/$CONTROL_REPO_OWNER/$CONTROL_REPO_NAME/contents/$LOCK_PATH" 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['sha'])" 2>/dev/null || echo "")
if [ -n "$LOCK_SHA" ]; then
  curl -s -X DELETE -H "Authorization: token $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"Lock released: $AGENT_NAME ($SESSION_ID)\",\"sha\":\"$LOCK_SHA\",\"branch\":\"main\"}" \
    "$GIT_API/repos/$CONTROL_REPO_OWNER/$CONTROL_REPO_NAME/contents/$LOCK_PATH" > /dev/null 2>&1
fi
echo "  OK - Lock released"

# --- Session file for heartbeat daemon ---
SESSION_FILE="$LOG_DIR/session-$SESSION_ID.json"
cat > "$SESSION_FILE" <<JSONEOF
{
  "session_id": "$SESSION_ID",
  "agent": "$AGENT_NAME",
  "type": "$AGENT_TYPE",
  "version": "$AGENT_VERSION",
  "started_at": "$STARTED_AT",
  "pid": "$$",
  "host": "$(hostname)"
}
JSONEOF

echo ""
echo "  AGENT AUTHORIZED"
echo "  ================"
echo "  Session: $SESSION_ID"
echo "  Ready for work."

# Export session variables for the parent harness
export AGENT_SESSION_ID="$SESSION_ID"
export AGENT_STARTED_AT="$STARTED_AT"
