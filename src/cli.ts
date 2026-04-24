#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadPolicy } from "./policy/loader.js";
import { EvidenceLedger } from "./ledger/ledger.js";
import { AEPProxyServer } from "./proxy/mcp-proxy.js";
import { ShellProxy } from "./proxy/shell-proxy.js";

const args = process.argv.slice(2);
const command = args[0];

function usage(): void {
  console.log(`AEP -- Agent Element Protocol v2.1

Usage:
  aep init <agent>              Set up AEP governance for an agent
  aep proxy --policy <file>     Start MCP proxy server
  aep exec <policy> <command>   Execute command through shell proxy
  aep validate <policy>         Validate a policy file
  aep report <ledger-file>      View audit report for a session ledger

Agents:
  claude-code    Generate CLAUDE.md, settings.json and agent.policy.yaml
  cursor         Generate mcp.json, rules and agent.policy.yaml
  codex          Generate AGENTS.md and agent.policy.yaml

Options:
  --help         Show this help message
  --version      Show version
`);
}

function version(): void {
  console.log("aep 2.1.0");
}

async function main(): Promise<void> {
  if (!command || command === "--help") {
    usage();
    return;
  }

  if (command === "--version") {
    version();
    return;
  }

  switch (command) {
    case "init":
      handleInit(args[1]);
      break;
    case "proxy":
      handleProxy(args);
      break;
    case "exec":
      handleExec(args);
      break;
    case "validate":
      handleValidate(args[1]);
      break;
    case "report":
      handleReport(args[1]);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

function handleInit(agent: string | undefined): void {
  if (!agent) {
    console.error("Usage: aep init <claude-code|cursor|codex>");
    process.exit(1);
  }

  const cwd = process.cwd();
  const policyContent = generateDefaultPolicy();

  switch (agent) {
    case "claude-code": {
      const claudeDir = join(cwd, ".claude");
      if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

      writeFileSync(
        join(claudeDir, "settings.json"),
        JSON.stringify(
          {
            permissions: {
              "aep-governed": true,
              "policy-file": "./agent.policy.yaml",
            },
          },
          null,
          2
        ) + "\n"
      );

      writeFileSync(
        join(cwd, "CLAUDE.md"),
        `# AEP Governance

This project uses the Agent Element Protocol (AEP) for governed agent interactions.

## Rules

- All actions are evaluated against \`agent.policy.yaml\` before execution.
- An evidence ledger records every action with SHA-256 hash chaining.
- AEP element mutations are structurally validated (z-bands, prefixes, parent-child).
- Forbidden patterns in the policy file are blocked automatically.
- Session limits (action count, rate, runtime) are enforced per session.

## Quick Start

Run \`npx aep proxy --policy ./agent.policy.yaml\` to start a governed session.
`
      );

      writeFileSync(join(cwd, "agent.policy.yaml"), policyContent);
      console.log("Created .claude/settings.json, CLAUDE.md and agent.policy.yaml");
      break;
    }

    case "cursor": {
      const cursorDir = join(cwd, ".cursor");
      const rulesDir = join(cursorDir, "rules");
      if (!existsSync(rulesDir)) mkdirSync(rulesDir, { recursive: true });

      writeFileSync(
        join(cursorDir, "mcp.json"),
        JSON.stringify(
          {
            mcpServers: {
              aep: {
                command: "npx",
                args: ["aep", "proxy", "--policy", "./agent.policy.yaml"],
              },
            },
          },
          null,
          2
        ) + "\n"
      );

      writeFileSync(
        join(rulesDir, "aep-governance.mdc"),
        `# AEP Governance Rules

All agent actions in this project are governed by the Agent Element Protocol.
Actions are evaluated against \`agent.policy.yaml\` before execution.
Forbidden patterns are blocked. Session limits are enforced.
An immutable evidence ledger records every action for audit.
`
      );

      writeFileSync(join(cwd, "agent.policy.yaml"), policyContent);
      console.log("Created .cursor/mcp.json, .cursor/rules/aep-governance.mdc and agent.policy.yaml");
      break;
    }

    case "codex": {
      writeFileSync(
        join(cwd, "AGENTS.md"),
        `# AEP Governance

This project uses the Agent Element Protocol (AEP).
All actions are governed by \`agent.policy.yaml\`.
Run \`npx aep proxy --policy ./agent.policy.yaml\` for governed sessions.
Evidence ledger provides full audit trail with hash-chain integrity.
`
      );

      writeFileSync(join(cwd, "agent.policy.yaml"), policyContent);
      console.log("Created AGENTS.md and agent.policy.yaml");
      break;
    }

    default:
      console.error(`Unknown agent: ${agent}. Use: claude-code, cursor or codex`);
      process.exit(1);
  }
}

function handleProxy(args: string[]): void {
  const policyIdx = args.indexOf("--policy");
  if (policyIdx === -1 || !args[policyIdx + 1]) {
    console.error("Usage: aep proxy --policy <file>");
    process.exit(1);
  }

  const policyPath = resolve(args[policyIdx + 1]);
  const policy = loadPolicy(policyPath);
  const ledgerDir = resolve("./ledgers");

  const proxy = new AEPProxyServer({
    policy,
    backends: [],
    ledgerDir,
  });

  const session = proxy.start({ source: "cli" });
  console.log(`AEP Proxy started.`);
  console.log(`  Policy: ${policy.name} (v${policy.version})`);
  console.log(`  Session: ${session.id}`);
  console.log(`  Ledger: ${ledgerDir}/${session.id}.jsonl`);
  console.log(`\nListening for MCP tool calls on stdin...`);
  console.log(`Press Ctrl+C to stop.\n`);

  // Read JSON-RPC from stdin
  let buffer = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.method === "tools/call") {
          proxy
            .handleToolCall({
              name: msg.params?.name ?? "",
              arguments: msg.params?.arguments ?? {},
            })
            .then((result) => {
              const response = {
                jsonrpc: "2.0",
                id: msg.id,
                result,
              };
              process.stdout.write(JSON.stringify(response) + "\n");
            });
        }
      } catch {
        // Skip malformed lines
      }
    }
  });

  process.on("SIGINT", () => {
    const report = proxy.stop("SIGINT");
    if (report) {
      console.log(`\nSession terminated. ${report.totalActions} actions evaluated.`);
      console.log(`  Allowed: ${report.allowed}, Denied: ${report.denied}, Gated: ${report.gated}`);
    }
    process.exit(0);
  });
}

function handleExec(args: string[]): void {
  const policyPath = args[1];
  const command = args.slice(2).join(" ");

  if (!policyPath || !command) {
    console.error("Usage: aep exec <policy> <command>");
    process.exit(1);
  }

  const policy = loadPolicy(resolve(policyPath));
  const proxy = new ShellProxy({
    policy,
    ledgerDir: resolve("./ledgers"),
  });

  proxy.start({ source: "cli-exec" });
  const result = proxy.evaluateCommand(command);

  if (result.allowed) {
    console.log(`ALLOWED: ${command}`);
    // In a real implementation, this would spawn the child process
  } else {
    console.error(`DENIED: ${command}`);
    console.error(`Reasons: ${result.reasons.join("; ")}`);
    process.exit(1);
  }

  proxy.stop();
}

function handleValidate(policyPath: string | undefined): void {
  if (!policyPath) {
    console.error("Usage: aep validate <policy-file>");
    process.exit(1);
  }

  try {
    const policy = loadPolicy(resolve(policyPath));
    console.log(`Policy "${policy.name}" (v${policy.version}) is valid.`);
    console.log(`  Capabilities: ${policy.capabilities.length}`);
    console.log(`  Forbidden patterns: ${policy.forbidden.length}`);
    console.log(`  Gates: ${policy.gates.length}`);
    console.log(`  Session max actions: ${policy.session.max_actions}`);
    if (policy.session.rate_limit) {
      console.log(
        `  Rate limit: ${policy.session.rate_limit.max_per_minute}/minute`
      );
    }
    console.log(`  Escalation rules: ${policy.session.escalation.length}`);
  } catch (err) {
    console.error(
      `Policy validation failed: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}

function handleReport(ledgerPath: string | undefined): void {
  if (!ledgerPath) {
    console.error("Usage: aep report <ledger-file>");
    process.exit(1);
  }

  const fullPath = resolve(ledgerPath);
  // Extract sessionId from filename
  const filename = fullPath.split("/").pop() ?? "";
  const sessionId = filename.replace(".jsonl", "");
  const dir = fullPath.replace(`/${filename}`, "");

  const ledger = new EvidenceLedger({ dir, sessionId });
  const report = ledger.report();

  console.log(`Session: ${report.sessionId}`);
  console.log(`Entries: ${report.entryCount}`);
  if (report.timeRange) {
    console.log(`Time range: ${report.timeRange.first} to ${report.timeRange.last}`);
  }
  console.log(`Chain integrity: ${report.chainValid ? "VALID" : "BROKEN"}`);
  console.log(`\nAction counts:`);
  for (const [type, count] of Object.entries(report.actionCounts)) {
    console.log(`  ${type}: ${count}`);
  }
}

function generateDefaultPolicy(): string {
  return `version: "2.1"
name: "default-agent-policy"

capabilities:
  - tool: "file:read"
    scope:
      paths: ["src/**", "tests/**", "docs/**"]
  - tool: "file:write"
    scope:
      paths: ["src/**", "tests/**"]
  - tool: "command:run"
    scope:
      binaries: ["npm", "node", "tsc", "git"]
  - tool: "aep:create_element"
    scope:
      element_prefixes: ["CP", "PN", "WD", "IC"]
      z_bands: ["20-29", "10-19"]
  - tool: "aep:update_element"
    scope:
      element_prefixes: ["CP", "PN", "WD"]
      exclude_ids: ["SH-00001"]

limits:
  max_runtime_ms: 600000
  max_files_changed: 50
  max_aep_mutations: 100

gates:
  - action: "file:delete"
    approval: human
    risk_level: high
  - action: "aep:delete_element"
    approval: human
    risk_level: high

forbidden:
  - pattern: "\\\\.env"
    reason: "Environment files may contain secrets"
  - pattern: "rm -rf /"
    reason: "Destructive filesystem operation"
  - pattern: "password|secret|api_key"
    reason: "Potential credential exposure"

session:
  max_actions: 100
  max_denials: 20
  rate_limit:
    max_per_minute: 30
  escalation:
    - after_actions: 50
      require: human_checkin
    - after_denials: 10
      require: pause

evidence:
  enabled: true
  dir: "./ledgers"
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
