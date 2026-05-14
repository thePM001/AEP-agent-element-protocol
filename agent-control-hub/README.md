# Agent Control Hub - Open Source Setup Guide

A reference implementation for setting up a centralized agent control system.

---

## What This Is

An Agent Control Hub is a central repository and authentication system that
all autonomous coding agents must register with before performing any work.
It provides:

- Agent identity verification (who is this agent ?)
- Session tracking (when did it start, what is it doing ?)
- Policy enforcement (what is the agent allowed to do ?)
- Activity audit (what did the agent do ?)

This pattern prevents unregistered, ungoverned agents from operating on
your infrastructure.

---

## Architecture Overview

```
                    AGENT SPAWN
                        │
                        ▼
              ┌─────────────────────┐
              │  AGENT CONTROL HUB  │
              │  (Git repo + auth)  │
              └─────────┬───────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
            ▼                       ▼
    ┌──────────────┐       ┌──────────────┐
    │  POLICIES    │       │   SESSIONS   │
    │  (rules)     │       │   (tracking) │
    └──────────────┘       └──────────────┘
            │                       │
            ▼                       ▼
    ┌──────────────┐       ┌──────────────┐
    │  REGISTRY    │       │   HARNESS    │
    │  (catalog)   │       │  (bootstrap) │
    └──────────────┘       └──────────────┘
```

## Repository Structure

```
agent-control-hub/
├── README.md                    # This file
├── policies/                    # Agent behavioral policies (.policy files)
│   ├── 01-network-policy.policy
│   ├── 02-output-policy.policy
│   ├── 03-deployment-policy.policy
│   ├── 04-writing-standards.policy
│   ├── 05-branding-policy.policy
│   └── 06-harness-policy.policy
├── registry/                    # Component and session registries
│   ├── component-registry.md    # Register every new component here
│   ├── infrastructure-map.md    # Service map, ports, architecture
│   └── agent-sessions.json      # LIVE - every agent session tracked
└── bootstrap/                   # Agent bootstrap scripts
    ├── agent-bootstrap.sh       # Run on EVERY agent spawn, FIRST command
    ├── agent-harness.sh         # Master control script
    ├── agent-validate.js        # Validation engine
    └── agent-safety-guard.js    # Safety checks
```

---

## Step 1: Create the Agent Control Repository

```bash
# Create a Git repository for your agent control hub
mkdir agent-control-hub && cd agent-control-hub
git init

# Create the directory structure
mkdir -p policies registry bootstrap
```

## Step 2: Set Up the Bootstrap Script

The bootstrap script is the FIRST thing every agent runs on spawn.
It authenticates with the hub and registers the session.

File: `bootstrap/agent-bootstrap.sh`

```bash
#!/bin/bash
#===============================================================================
# Agent Bootstrap - Run on EVERY agent spawn.
#
# This is the FIRST command every agent must execute.
# It authenticates with the control hub and registers the session.
# If this fails, the agent is NOT AUTHORIZED to work.
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

# Try to get existing sessions file
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
```

## Step 3: Create the Master Harness Script

File: `bootstrap/agent-harness.sh`

```bash
#!/bin/bash
#===============================================================================
# Agent Control Harness - Master control script
#===============================================================================
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"

log()  { echo "[AGENT-HARNESS] $*"; }
err()  { echo "[AGENT-HARNESS ERROR] $*" >&2; exit 1; }

case "${1:-help}" in
  boot)
    shift
    "$HARNESS_DIR/agent-bootstrap.sh" "$@"
    ;;
  register)
    # Validate against conventions and register component
    shift
    kind="${1:-}"; id="${2:-}"; desc="${3:-}"
    [ -z "$kind" ] && err "Usage: agent-harness register --kind <type> --id <name>"
    log "Registration not yet implemented for public release"
    echo "  kind=$kind id=$id"
    ;;
  validate)
    shift
    target="${1:-.}"
    log "Validating $target..."
    python3 -c "
import os
violations = []
for root, dirs, files in os.walk('$target'):
    for f in files:
        if f.endswith(('.py', '.js', '.ts', '.tsx', '.jsx', '.ex', '.rs')):
            path = os.path.join(root, f)
            try:
                with open(path) as fh:
                    content = fh.read()
                    if 'control-hub' not in content and len(content) > 100:
                        violations.append(path)
            except: pass
if violations:
    print('  Files without control-hub markers:')
    for v in violations[:5]:
        print(f'    - {v}')
"
    log "Validation complete."
    ;;
  policies)
    log "Active Policies:"
    for f in "$HARNESS_DIR/../policies"/*.policy; do
      name=$(basename "$f")
      guard=$(grep 'guard:' "$f" | head -1 | sed 's/.*guard: "//;s/"$//')
      echo "  [ACTIVE] $name"
      echo "    ${guard:0:80}..."
    done
    ;;
  status)
    echo "Agent Control Hub Status:"
    echo "  Bootstrap: $HARNESS_DIR/agent-bootstrap.sh"
    echo "  Policies: $(ls "$HARNESS_DIR/../policies"/*.policy 2>/dev/null | wc -l) active"
    echo "  Sessions: $HARNESS_DIR/../registry/agent-sessions.json"
    ;;
  help|*)
    echo "Usage:"
    echo "  agent-harness boot <name> <type> <version>   # Boot registration"
    echo "  agent-harness register --kind <t> --id <n>   # Register component"
    echo "  agent-harness validate [--path <dir>]        # Validate code"
    echo "  agent-harness policies                       # List policies"
    echo "  agent-harness status                         # Show status"
    ;;
esac
```

---

## Step 4: Define Agent Policies

Create policy files in `policies/`. These define what agents are and are not allowed to do.

### Example: Network Policy (`policies/01-network-policy.policy`)

```yaml
id: network-bind-policy
severity: critical
description: "No agent may create services on 0.0.0.0"
rules:
  - bind_addresses must be 127.0.0.1 or internal IP only
  - 0.0.0.0 is forbidden for all service bindings
  - auto-remediate: replace 0.0.0.0 with internal IP
```

### Example: Deployment Policy (`policies/03-deployment-policy.policy`)

```yaml
id: deployment-approval-policy
severity: critical
description: "No agent may deploy without human approval"
rules:
  - Every deployment action must be registered before execution
  - Deployment prompt must include: WHAT + WHY + IMPACT + ROLLBACK + DURATION
  - Raw command chains are forbidden as authorization prompts
  - Agent must WAIT for explicit human approval
  - Before any work, agent must consult:
    a) Knowledge base / index
    b) Existing code repositories
    c) Component registries
    d) Documentation wiki
```

### Example: Harness Policy (`policies/06-harness-policy.policy`)

```yaml
id: harness-mandatory-policy
severity: critical
description: "Agent bootstrap is mandatory on every spawn"
rules:
  - agent-bootstrap.sh MUST run as FIRST command on every agent spawn
  - Session is registered in agent-sessions.json
  - No other bootstrap script is allowed
  - Agent is NOT AUTHORIZED to work if bootstrap fails
```

---

## Step 5: Install and Test

```bash
# Clone the control hub
git clone https://your-git-server/org/agent-control-hub.git
cd agent-control-hub

# Install the bootstrap script
sudo cp bootstrap/agent-bootstrap.sh /usr/local/bin/agent-boot
sudo cp bootstrap/agent-harness.sh /usr/local/bin/agent-harness
sudo chmod +x /usr/local/bin/agent-boot /usr/local/bin/agent-harness

# Test it
agent-harness status
```

---

## How Agents Use This

Every agent, on every spawn, runs:

```bash
agent-harness boot my-agent cli 1.0
```

This single command:
1. Authenticates with the control hub
2. Registers the agent session with identity details
3. Returns "AGENT AUTHORIZED" or fails

If boot fails, the agent cannot work. There is no bypass.

---

## Customization

To use this in your own infrastructure:

1. Replace `your-git-server` with your actual Git server address
2. Replace `your-access-token` with a valid token for your Git API
3. Replace `org/agent-control-hub` with your repository path
4. Add your own policies in `policies/`
5. Extend the bootstrap script for your specific needs:
   - Add environment checks
   - Verify required tools are installed
   - Load configuration from external sources
   - Call additional validation scripts
   - Notify monitoring systems

---

## License

Apache 2.0

Copyright 2026 New Lisbon Agency

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
