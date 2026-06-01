#!/bin/bash
#===============================================================================
# Agent Bootstrap - Run on EVERY agent spawn.
#
# This is the FIRST command every agent must execute.
# It authenticates with the control hub and registers the session.
# If this fails, the agent is NOT AUTHORIZED to work.
#
# Usage: agent-bootstrap.sh <agent_name> <agent_type> <version>
#===============================================================================
set -euo pipefail

CONTROL_REPO_URL="${1:-https://your-git-server/org/agent-control-hub.git}"
ACCESS_TOKEN="${2:-your-access-token}"
API_BASE="${CONTROL_REPO_URL%.git}"
API_BASE="${API_BASE#https://}"
GIT_API="https://$API_BASE/api/v1"

AGENT_NAME="${3:-unknown}"
AGENT_TYPE="${4:-cli}"
AGENT_VERSION="${5:-1.0}"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SESSION_ID="$(uuidgen 2>/dev/null || echo "$(hostname)-$$-$(date +%s)")"
REGISTRY_PATH="registry/agent-sessions.json"

echo ""
echo "============================================="
echo " AGENT CONTROL HUB - BOOT REGISTRATION"
echo "============================================="
echo " Agent:      $AGENT_NAME ($AGENT_TYPE)"
echo " Version:    $AGENT_VERSION"
echo " Session:    $SESSION_ID"
echo " Started:    $STARTED_AT"
echo ""

# Step 1: Verify connectivity
echo "[1/3] Connecting to Control Hub..."
if ! curl -sf -H "Authorization: token $ACCESS_TOKEN" "$GIT_API/user" > /dev/null 2>&1; then
  echo "  FAILED: Cannot reach Control Hub at $GIT_API"
  echo "  Agent NOT authorized. Fix connection and re-spawn."
  exit 1
fi
echo "  OK - Control Hub reachable"

# Step 2: Verify control repo exists
echo "[2/3] Verifying control repository..."
REPO_OWNER=$(basename $(dirname $API_BASE))
REPO_NAME=$(basename $API_BASE)
if ! curl -sf -H "Authorization: token $ACCESS_TOKEN" "$GIT_API/repos/$REPO_OWNER/$REPO_NAME" > /dev/null 2>&1; then
  echo "  FAILED: Control repository not found"
  exit 1
fi
echo "  OK - Repository accessible"

# Step 3: Register session
echo "[3/3] Registering agent session..."

EXISTING=$(curl -sf -H "Authorization: token $ACCESS_TOKEN" \
  "$GIT_API/repos/$REPO_OWNER/$REPO_NAME/contents/$REGISTRY_PATH" 2>/dev/null || echo "")

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
  'status': 'active'
}
print(json.dumps(data, indent=2))
" 2>/dev/null)
  B64=$(echo "$UPDATED" | base64 -w0)
  curl -s -X PUT -H "Authorization: token $ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d "{\"message\":\"Agent boot: $AGENT_NAME ($SESSION_ID)\",\"content\":\"$B64\",\"sha\":\"$SHA\",\"branch\":\"main\"}" \
    "$GIT_API/repos/$REPO_OWNER/$REPO_NAME/contents/$REGISTRY_PATH" > /dev/null 2>&1
else
  INITIAL=$(cat <<JSON
{
  "registry_version": "1.0",
  "created_at": "$STARTED_AT",
  "sessions": {
    "$SESSION_ID": {
      "agent": "$AGENT_NAME",
      "type": "$AGENT_TYPE",
      "version": "$AGENT_VERSION",
      "session_id": "$SESSION_ID",
      "started_at": "$STARTED_AT",
      "host": "$(hostname)",
      "pid": "$$",
      "status": "active"
    }
  }
}
JSON
)
  B64=$(echo "$INITIAL" | base64 -w0)
  curl -s -X PUT -H "Authorization: token $ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d "{\"message\":\"Agent boot: initial session\",\"content\":\"$B64\",\"branch\":\"main\"}" \
    "$GIT_API/repos/$REPO_OWNER/$REPO_NAME/contents/$REGISTRY_PATH" > /dev/null 2>&1
fi

echo "  OK - Session $SESSION_ID registered"
echo ""
echo "============================================="
echo " AGENT AUTHORIZED"
echo "============================================="
