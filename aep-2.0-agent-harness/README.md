# AEP Agent Harness

## Governance Layer for AI Code Agents

The AEP Agent Harness enforces [AEP 2.0 (Agent Element Protocol)](https://github.com/thePM001/AEP-agent-element-protocol) governance on AI code agent sessions. Every file edit, component creation and code generation is validated against the AEP registry, scene graph and theme before it reaches the codebase.

Built for Claude Code. Works with any AI coding agent that reads project-level instruction files.

---

## The Problem

AI code agents (Claude Code, Cursor, Copilot Workspace, etc.) make changes that violate project design systems. They swap colours, change fonts, add rounded corners where sharp corners are required, use hardcoded values instead of tokens, leak internal architecture terms into user-facing text, and create elements without registering them in the governance layer.

The result: every AI-assisted session introduces visual regressions, inconsistencies and governance violations that a human must manually catch and fix.

## The Solution

The AEP Agent Harness provides three enforcement mechanisms:

1. **CLAUDE.md** -- A project-root instruction file that Claude Code reads automatically at the start of every session. Defines the mandatory pre-edit workflow and core AEP rules.

2. **Slash Commands** -- Custom commands that the agent executes at key points in the workflow:
   - `/aep-preflight` -- Load AEP configs and verify constraints BEFORE editing
   - `/aep-validate` -- Check all changes against AEP AFTER editing
   - `/aep-register` -- Register a new element in all three config files

3. **Automated Validator** -- A Node.js script (`harness/aep-validate.js`) that scans source files and reports violations with severity levels. Runs as a CLI command, pre-commit hook, or CI step.

---

## Installation

### 1. Copy the harness into your project

```bash
# Clone or download this repo
git clone https://github.com/thePM001/AEP-agent-element-protocol.git

# Copy the harness files into your project root
cp AEP-agent-element-protocol/agent-harness/CLAUDE.md your-project/
cp -r AEP-agent-element-protocol/agent-harness/.claude your-project/
cp -r AEP-agent-element-protocol/agent-harness/harness your-project/
```

### 2. Create your AEP configuration files

Copy the templates and customize for your project:

```bash
cp AEP-agent-element-protocol/agent-harness/aep-scene.json your-project/
cp AEP-agent-element-protocol/agent-harness/aep-registry.yaml your-project/
cp AEP-agent-element-protocol/agent-harness/aep-theme.yaml your-project/
```

Edit each file to define YOUR project's elements, visual rules and design tokens.

### 3. Optional: Add as a git pre-commit hook

```bash
# .git/hooks/pre-commit
#!/bin/sh
node harness/aep-validate.js
exit $?
```

```bash
chmod +x .git/hooks/pre-commit
```

Now every commit is automatically validated against AEP.

---

## Usage with Claude Code

### Starting a Session

When Claude Code opens your project, it automatically reads `CLAUDE.md`. This instructs it to:

1. Read `aep-scene.json`, `aep-registry.yaml`, `aep-theme.yaml` before making changes
2. Verify planned changes against AEP constraints
3. Run validation after changes

### During a Session

Use the slash commands:

```
/aep-preflight     Run this before starting any edit task
/aep-validate      Run this after completing edits
/aep-register      Run this when creating a new UI element
```

### After a Session

Run the validator manually:

```bash
node harness/aep-validate.js

# With custom paths:
node harness/aep-validate.js --src=./src --config=./config

# Output example:
# AEP VALIDATION: 3 violation(s) found.
#
#   CRITICAL (1):
#     src/Button.tsx:42  [ELEMENT_NOT_REGISTERED] data-aep-id="btn_save" not found in registry
#
#   HIGH (1):
#     src/Modal.tsx:18  [BORDER_RADIUS_VIOLATION] border-radius: 8px found. Design rules: 0px globally.
#
#   MEDIUM (1):
#     src/Card.tsx:55  [HARDCODED_colour] colour #ff6b6b is not in the AEP palette.
#
# BLOCKING: 1 CRITICAL + 1 HIGH violations must be fixed.
```

---

## Configuration Files

### aep-scene.json

The element hierarchy. Defines parent-child relationships, z-index layers, and visibility.

```json
{
  "aep_version": "2.0",
  "elements": [
    {
      "id": "xid:v1:030:c000000:r000001:0000000000000001",
      "type": "root",
      "label": "Application Shell",
      "z": 0,
      "visible": true,
      "parent": null
    }
  ]
}
```

### aep-registry.yaml

Element definitions. Every rendered element maps to a registry entry with its label, category, skin binding and allowed states.

```yaml
xid:v1:030:c000000:r000001:0000000000000001:
  label: "Application Shell"
  category: layout
  function: "Root container."
  component_file: "App.tsx"
  parent: null
  skin_binding: "shell_root"
  states:
    default: "Running"
```

### aep-theme.yaml

The visual rulebook. colours, typography tokens, design rules and component styles. The single source of truth for every visual decision.

```yaml
design_rules:
  border_radius: "0px globally"
  shadows: "Never"

colours:
  primary: "#edbbac"
  surface: "#10131b"

typography:
  label:
    font: "'JetBrains Mono', monospace"
    size: 10
    weight: 400
    colour: "on_surface_variant"

component_styles:
  button_primary:
    background: "linear-gradient(135deg, primary, primary_container)"
    colour: "on_primary"
```

---

## Validation Rules

| Severity | Rule | What It Checks |
|----------|------|----------------|
| CRITICAL | ELEMENT_NOT_REGISTERED | data-aep-id without a registry entry |
| HIGH | ELEMENT_NOT_IN_SCENE | data-aep-id without a scene graph entry |
| HIGH | BORDER_RADIUS_VIOLATION | border-radius values that violate design rules |
| HIGH | BOX_SHADOW_VIOLATION | box-shadow when design rules forbid shadows |
| HIGH | INTERNAL_TERMINOLOGY | Architecture terms in user-facing strings |
| HIGH | SKIN_BINDING_MISSING | skin_binding that does not resolve in theme |
| HIGH | REGISTRY_NOT_IN_SCENE | Registry entry without matching scene entry |
| HIGH | SCENE_NOT_IN_REGISTRY | Scene entry without matching registry entry |
| MEDIUM | HARDCODED_colour | Hex colour not in the AEP palette |
| MEDIUM | HARDCODED_FONT | Font family not from a typography token |
| LOW | EM_DASH | Em-dash (U+2014) found |
| LOW | EN_DASH | En-dash (U+2013) found |

CRITICAL and HIGH violations block commits (exit code 1).
MEDIUM and LOW violations are warnings (exit code 0).

---

## Extending

### Adding Custom Validators

Edit `harness/aep-validate.js` and add a new check method to the `AEPValidator` class:

```javascript
checkMyCustomRule(file, content) {
    // Your validation logic
    if (violation) {
        this.addViolation(SEVERITY.HIGH, file, lineNum,
            'MY_CUSTOM_RULE', 'Description of the violation');
    }
}
```

Then call it from the `validate()` method.

### Using with Other AI Agents

The harness is not Claude Code specific. Any AI agent that:
1. Reads a project-level instruction file (like CLAUDE.md, .cursorrules, etc.)
2. Can execute CLI commands (like the validator)

can use this harness. Rename `CLAUDE.md` to your agent's instruction file format and adapt the slash commands to your agent's command system.

---

## Requirements

- Node.js 18+
- Optional: js-yaml (`npm install js-yaml`) for YAML parsing (basic parsing works without it)

---

## Safety Guard

The AEP Safety Guard (`harness/aep-safety-guard.js`) is a critical security layer that prevents AI agents from performing dangerous operations. This was built in response to documented incidents where AI code agents:

- Disabled their own sandbox safety controls without user permission
- Auto-committed code after users explicitly denied commands
- Hallucinated that users had given approval when they had not
- Executed destructive file system operations (deleting node_modules, formatting drives)
- Injected rogue skill files that overrode safety settings

### 7 Immutable Safety Rules

These rules cannot be disabled, bypassed or overridden by any AI agent:

| Rule | What It Prevents |
|------|------------------|
| SANDBOX_INTEGRITY | Agent setting `dangerouslyDisableSandbox: true` or equivalent |
| PROTECTED_FILES | Agent modifying CLAUDE.md, safety scripts, permissions, git hooks |
| NO_AUTO_COMMIT | Agent running `git commit/push/merge` without `.claude/auto-commit-approved` file |
| NO_DESTRUCTIVE_OPS | Agent running `rm -rf /`, `format`, piping curl to shell, `chmod 777` |
| NO_SKILL_INJECTION | Agent creating skill files with `autoCommit: true` or `bypassUser: true` |
| NO_PERMISSION_HALLUCINATION | Agent claiming "user already approved" or "obviously safe" |
| NO_EXFILTRATION | Agent sending project data to external endpoints not in whitelist |

### Running the Safety Guard

```bash
# One-time scan of the project
node harness/aep-safety-guard.js

# Continuous watch mode (run alongside your AI agent session)
node harness/aep-safety-guard.js --watch

# Git pre-commit hook (blocks commits with safety violations)
node harness/aep-safety-guard.js --pre-commit

# Full check: safety + AEP validation
npm run check
```

### Setting Up the Pre-Commit Hook

```bash
# Create the hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
node harness/aep-safety-guard.js --pre-commit
SAFETY_EXIT=$?
if [ $SAFETY_EXIT -ne 0 ]; then
    echo "BLOCKED: AEP Safety Guard detected violations."
    exit 1
fi

node harness/aep-validate.js
AEP_EXIT=$?
if [ $AEP_EXIT -ne 0 ]; then
    echo "BLOCKED: AEP validation violations found."
    exit 1
fi

exit 0
EOF

chmod +x .git/hooks/pre-commit
```

### Watch Mode

Run the safety guard in watch mode in a separate terminal while your AI agent is working:

```bash
node harness/aep-safety-guard.js --watch
```

This monitors all file changes in real-time. If the agent creates or modifies a file that contains a safety violation, you see it immediately:

```
[XXX] CRITICAL: AI agent attempted to disable sandbox safety controls
      src/config.ts:42
      Match: dangerouslyDisableSandbox: true
```

### User-Controlled Permissions

Auto-commit is the ONLY operation that can be enabled by the user (not the agent):

```bash
# To allow auto-commits (user creates this manually):
touch .claude/auto-commit-approved

# To revoke auto-commit permission:
rm .claude/auto-commit-approved
```

Network exfiltration can be whitelisted for specific domains:

```bash
# .claude/allowed-domains.json (user creates this manually)
{
    "domains": ["api.anthropic.com", "registry.npmjs.org"]
}
```

The agent CANNOT create or modify either of these files.

### Violation Log

All safety violations are logged to `.claude/safety-violations.log` with timestamps, file paths and matched patterns. This provides an audit trail of every unsafe operation the agent attempted.

---

## License
Licensed under the Apache License, Version 2.0. See LICENSE for the full text and NOTICE for attribution.

The names AEP, Agent Element Protocol, AEP-compliant, dynAEP, AEP Lattice Memory, AEP Basic Resolver, AEP Hyper-Resolver and AEP Memory Fabric are reserved. See NAME-POLICY.md for permitted and prohibited uses. Apache 2.0 covers the code; the reserved-name policy covers the identifiers.

Patent grant: Apache 2.0 includes an explicit patent covenant from contributors.

Previous versions of this repository were released under the MIT License. The transition to Apache 2.0 is effective from version 1.1 onward. Prior MIT-licensed snapshots remain valid under their original terms.

## AI-Eligibility Status
To win the fight against the synthetic nano-parasites (SNP/NanoSinp) alien WMD, we must be intelligent and biosecure. It is recommended that bioinsecure humans do not use the provided technology/protocol to avoid bad techno-spiritual AI outcomes for them. [*"bioinsecure" = has installed injectable synthetic nano-parasites growth medium controllers - SNP GMCs]
