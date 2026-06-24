# CI/CD Integration Guide

This guide shows how to integrate aep-caw session reports into your CI/CD pipelines.

## Overview

When running AI agents in CI/CD pipelines, aep-caw captures all activity for auditing. After the agent completes, generate a report to:

- Verify the agent behaved as expected
- Detect policy violations or anomalies
- Create an audit trail for compliance
- Debug failed runs

## GitHub Actions Example

```yaml
name: AI Agent Task

on:
  workflow_dispatch:
    inputs:
      task:
        description: 'Task for the AI agent'
        required: true

jobs:
  run-agent:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install aep-caw
        run: |
          curl -fsSL https://aep-caw.dev/install.sh | bash
          echo "$HOME/.local/bin" >> $GITHUB_PATH

      - name: Start aep-caw and create session
        id: session
        run: |
          aep-caw server &
          sleep 2
          SESSION=$(aep-caw session create --workspace . --policy ci-agent --json | jq -r '.id')
          echo "id=$SESSION" >> $GITHUB_OUTPUT

      - name: Run AI agent
        env:
          AEP_CAW_SESSION: ${{ steps.session.outputs.id }}
        run: |
          # Your AI agent command here
          aep-caw exec $AEP_CAW_SESSION -- your-agent-cli "${{ inputs.task }}"

      - name: Generate session report
        if: always()
        run: |
          aep-caw report ${{ steps.session.outputs.id }} \
            --level=detailed \
            --output=session-report.md

      - name: Upload report as artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: aep-caw-session-report
          path: session-report.md

      - name: Add report to job summary
        if: always()
        run: |
          echo "## Session Report" >> $GITHUB_STEP_SUMMARY
          cat session-report.md >> $GITHUB_STEP_SUMMARY

      - name: Cleanup session
        if: always()
        run: aep-caw session destroy ${{ steps.session.outputs.id }}
```

## GitLab CI Example

```yaml
ai-agent-task:
  stage: build
  image: ubuntu:22.04
  variables:
    AEP_CAW_SESSION: ""
  before_script:
    - curl -fsSL https://aep-caw.dev/install.sh | bash
    - export PATH="$HOME/.local/bin:$PATH"
    - aep-caw server &
    - sleep 2
    - export AEP_CAW_SESSION=$(aep-caw session create --workspace . --policy ci-agent --json | jq -r '.id')
  script:
    - aep-caw exec $AEP_CAW_SESSION -- your-agent-cli "do the task"
  after_script:
    - aep-caw report $AEP_CAW_SESSION --level=detailed --output=session-report.md
    - aep-caw session destroy $AEP_CAW_SESSION || true
  artifacts:
    when: always
    paths:
      - session-report.md
    reports:
      dotenv: agent.env
```

## Docker Container Integration

When running aep-caw in containers, proper startup sequencing is important to avoid race conditions between the daemon and shell shim.

### Non-Interactive Shell Enforcement

By default, the shell shim bypasses policy when stdin is not a TTY. This preserves binary stdin/stdout for piped data (e.g., `docker exec -i container sh -c "cat > /file" < binary`). In CI/CD environments where all commands are non-interactive but still need enforcement, use `--force` during shim installation:

```bash
aep-caw shim install-shell \
  --root / \
  --shim /usr/bin/aep-caw-shell-shim \
  --bash \
  --force \
  --i-understand-this-modifies-the-host
```

This writes `/etc/aep-caw/shim.conf` with `force=true`. The shim reads this file at startup, so it works regardless of how the shell is spawned (unlike env vars or profile scripts that may not be sourced for non-interactive SSH sessions).

Alternatively, set `AEP_CAW_SHIM_FORCE=1` in the process environment for per-process enforcement.

### Basic Dockerfile

```dockerfile
FROM debian:bookworm-slim

# Install aep-caw
RUN curl -fsSL https://aep-caw.dev/install.sh | bash

# Copy your configuration
COPY config.yaml /etc/aep-caw/config.yaml
COPY policies/ /etc/aep-caw/policies/

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

### Entrypoint Script with Health Check

The shell shim has built-in retry logic, but for reliable container startup, explicitly wait for the daemon to be ready:

```bash
#!/bin/bash
set -e

# Start the aep-caw server in the background
aep-caw server &

# Wait for the server to be ready (polls /health endpoint)
echo "Waiting for aep-caw server..."
until curl -sf http://127.0.0.1:18080/health >/dev/null 2>&1; do
    sleep 0.1
done
echo "aep-caw server ready"

# Create a session for the workspace
export AEP_CAW_SESSION=$(aep-caw session create --workspace /workspace --policy default --json | jq -r '.id')

# Execute the main command through the shell shim
exec aep-caw-shell-shim "$@"
```

### Docker Compose Example

```yaml
version: '3.8'

services:
  agent:
    build: .
    volumes:
      - ./workspace:/workspace
    environment:
      - AEP_CAW_LOG_LEVEL=info
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://127.0.0.1:18080/health"]
      interval: 5s
      timeout: 3s
      start_period: 10s
      retries: 3
    command: ["bash", "-c", "your-agent-command"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-agent
spec:
  template:
    spec:
      containers:
        - name: agent
          image: your-agent-image:latest
          command: ["/entrypoint.sh"]
          args: ["your-agent-command"]
          readinessProbe:
            httpGet:
              path: /health
              port: 18080
            initialDelaySeconds: 5
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: 18080
            initialDelaySeconds: 10
            periodSeconds: 10
          volumeMounts:
            - name: workspace
              mountPath: /workspace
      volumes:
        - name: workspace
          emptyDir: {}
```

### Race Condition Prevention

The shell shim (`aep-caw-shell-shim`) internally calls `aep-caw exec`, which has retry logic:
- On connection failure, it checks if auto-start is enabled
- If enabled, it starts the daemon and polls `/health` for up to 5 seconds

However, for production container deployments, explicit health checking is more reliable:

1. **Container orchestration health checks** - Let Kubernetes/Docker Compose manage readiness
2. **Explicit wait in entrypoint** - Use `until curl -sf http://127.0.0.1:18080/health; do sleep 0.1; done`
3. **Startup ordering** - In multi-container setups, use `depends_on` with health conditions

### Daytona Integration

For Daytona workspaces, add aep-caw to your devcontainer configuration:

```json
{
  "image": "your-base-image",
  "postCreateCommand": "curl -fsSL https://aep-caw.dev/install.sh | bash",
  "postStartCommand": "aep-caw daemon &",
  "customizations": {
    "aep-caw": {
      "policy": "daytona-workspace"
    }
  }
}
```

Or use the aep-caw-enabled base image:

```json
{
  "image": "ghcr.io/aep-caw/devcontainer:latest",
  "postStartCommand": "aep-caw daemon &"
}
```

## Best Practices

### 1. Always Generate Reports

Use `if: always()` or `when: always` to ensure reports are generated even when the agent fails. Failed runs often have the most interesting findings.

### 2. Use Detailed Level for Artifacts

For artifact storage, use `--level=detailed` to capture the full investigation data.

### 3. Add to Job Summary (GitHub Actions)

Append the report to `$GITHUB_STEP_SUMMARY` for inline viewing without downloading artifacts.

### 4. Fail on Critical Findings

Add a step to parse the report and fail the build if critical findings are detected:

```yaml
- name: Check for violations
  run: |
    if grep -q "\[CRITICAL\]" session-report.md; then
      echo "Critical findings detected!"
      exit 1
    fi
```

### 5. Policy Per Environment

Use different policies for different CI contexts:

```yaml
# For PR checks - stricter
aep-caw session create --policy pr-check

# For deployment agents - more permissive but audited
aep-caw session create --policy deploy-agent
```

## Troubleshooting

### "No sessions found"

The aep-caw server may have restarted or the session timed out. Use `--direct-db` for offline access.

### Report is empty or minimal

Check that your agent is actually running through aep-caw:

```bash
# Wrong - agent runs outside aep-caw
./my-agent

# Right - agent runs through aep-caw
aep-caw exec $SESSION -- ./my-agent
```

## Generating Policies from CI Runs

Use `policy generate` to create restrictive policies from observed CI behavior:

### Profile-Then-Lock Workflow

1. **Profile phase**: Run your CI with a permissive policy and audit logging
2. **Generate phase**: Create a policy from the observed behavior
3. **Lock phase**: Use the generated policy for future runs

### GitHub Actions Example

```yaml
name: Generate CI Policy

on:
  workflow_dispatch:
    inputs:
      profile_run:
        description: 'Profile a run to generate policy'
        type: boolean
        default: false

jobs:
  ci-with-policy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install aep-caw
        run: |
          curl -fsSL https://aep-caw.dev/install.sh | bash
          echo "$HOME/.local/bin" >> $GITHUB_PATH

      - name: Start aep-caw server
        run: |
          aep-caw server &
          sleep 2

      - name: Create session
        id: session
        run: |
          # Use permissive policy for profiling, generated policy for normal runs
          if [ "${{ inputs.profile_run }}" = "true" ]; then
            POLICY="audit-all"
          else
            POLICY="ci-generated"
          fi
          SESSION=$(aep-caw session create --workspace . --policy $POLICY --json | jq -r '.id')
          echo "id=$SESSION" >> $GITHUB_OUTPUT

      - name: Run build and AEP-NOSHIP/tests
        run: |
          aep-caw exec ${{ steps.session.outputs.id }} -- npm install
          aep-caw exec ${{ steps.session.outputs.id }} -- npm run build
          aep-caw exec ${{ steps.session.outputs.id }} -- npm test

      - name: Generate policy from profile run
        if: inputs.profile_run
        run: |
          aep-caw policy generate ${{ steps.session.outputs.id }} \
            --name=ci-generated \
            --threshold=5 \
            --output=configs/policies/ci-generated.yaml

          echo "Generated policy:"
          cat configs/policies/ci-generated.yaml

      - name: Upload generated policy
        if: inputs.profile_run
        uses: actions/upload-artifact@v4
        with:
          name: generated-policy
          path: configs/policies/ci-generated.yaml
```

### Best Practices for Policy Generation

#### 1. Profile Representative Runs

Generate policies from runs that exercise typical behavior:
- Include all common build paths
- Run the full test suite
- Include any network dependencies (npm, pip, docker)

#### 2. Review Before Committing

Always review generated policies before using them:

```yaml
# Generated policy will include comments like:
file_rules:
  # Provenance: 47 events (14:20:05 - 14:31:45)
  # Sample paths: /workspace/node_modules/lodash/index.js, ...
  - name: workspace-node_modules-glob
    paths: ["/workspace/node_modules/**"]
    operations: ["read", "write"]
    decision: allow

  # --- Blocked operations (commented for review) ---
  # BLOCKED: system file denied
  #   - name: etc-hosts
  #     paths: ["/etc/hosts"]
  #     operations: ["write"]
  #     decision: allow
```

#### 3. Use Appropriate Thresholds

- Lower threshold (3-5): Stricter policies, more specific rules
- Higher threshold (10-20): Looser policies, more glob patterns

#### 4. Handle Risky Commands

Generated policies flag risky commands with arg patterns:

```yaml
command_rules:
  # Provenance: 3 invocations (risky: network)
  - name: curl
    commands: ["curl"]
    args_patterns: ["^https?://registry\\.npmjs\\.org/"]
    decision: allow
```

#### 5. Iterate on the Policy

1. Generate initial policy from profile run
2. Use it for a few CI runs
3. If legitimate operations are blocked, re-profile and regenerate
4. Commit the stable policy to the repository
