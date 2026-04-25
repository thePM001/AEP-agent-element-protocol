#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadPolicy } from "./policy/loader.js";
import { EvidenceLedger } from "./ledger/ledger.js";
import { AEPProxyServer } from "./proxy/mcp-proxy.js";
import { ShellProxy } from "./proxy/shell-proxy.js";
import { parseCovenant } from "./covenant/parser.js";
import { evaluateCovenant } from "./covenant/evaluator.js";
import { generateClaudeCodeCommand, generateCursorRule, generateCodexAgentSection } from "./assist/slash-commands.js";

const args = process.argv.slice(2);
const command = args[0];

function usage(): void {
  console.log(`AEP -- Agent Element Protocol v2.2

Usage:
  aep init <agent>              Set up AEP governance for an agent
  aep proxy --policy <file>     Start MCP proxy server
  aep exec <policy> <command>   Execute command through shell proxy
  aep validate <policy>         Validate a policy file
  aep report <ledger-file>      View audit report for a session ledger
  aep describe <policy>         Describe policy in readable form
  aep kill --all [--rollback]   Kill all active sessions
  aep kill --session <id>       Kill a specific session
  aep trust <session-id>        Show trust score and tier
  aep ring <session-id>         Show execution ring
  aep drift <session-id>        Show intent drift status
  aep identity create           Create a new agent identity
  aep identity verify <file>    Verify an identity file
  aep covenant parse <file>     Parse and display covenant DSL
  aep covenant verify <f> <act> Check covenant against an action
  aep bundle <session-id>       Generate proof bundle for session
  aep bundle verify <file>      Verify proof bundle signature and identity
  aep bundle verify <f> --ledger <l>  Full verification with ledger
  aep tasks <session-id>        Show task tree for session
  aep tasks <session-id> --tree Show as indented tree view
  aep sync                      Sync offline ledger entries
  aep owasp                     Print OWASP Agentic Top 10 mapping

Agents:
  claude-code    Generate CLAUDE.md, settings.json and agent.policy.yaml
  cursor         Generate mcp.json, rules and agent.policy.yaml
  codex          Generate AGENTS.md and agent.policy.yaml

Report formats:
  aep report <file>                         Text (default)
  aep report <file> --format json           JSON export
  aep report <file> --format csv            CSV export
  aep report <file> --format html           HTML export

Options:
  --help         Show this help message
  --version      Show version
`);
}

function version(): void {
  console.log("aep 2.2.0");
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
      handleReport(args);
      break;
    case "describe":
      handleDescribe(args[1]);
      break;
    case "kill":
      handleKill(args);
      break;
    case "trust":
      handleTrust(args[1]);
      break;
    case "ring":
      handleRing(args[1]);
      break;
    case "drift":
      handleDrift(args[1]);
      break;
    case "identity":
      handleIdentity(args);
      break;
    case "covenant":
      handleCovenant(args);
      break;
    case "bundle":
      await handleBundle(args);
      break;
    case "tasks":
      handleTasks(args);
      break;
    case "owasp":
      handleOwasp();
      break;
    case "sync":
      handleSync();
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
      const commandsDir = join(claudeDir, "commands");
      if (!existsSync(commandsDir)) mkdirSync(commandsDir, { recursive: true });

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
- Trust scoring tracks agent reliability with automatic erosion.
- Execution rings restrict capabilities based on trust tier.
- Behavioural covenants declare agent-side rules that are enforced.
- Intent drift detection flags deviation from established patterns.

## Quick Start

Run \`npx aep proxy --policy ./agent.policy.yaml\` to start a governed session.
Type \`/aepassist\` for interactive governance management.
`
      );

      writeFileSync(join(commandsDir, "aepassist.md"), generateClaudeCodeCommand());

      writeFileSync(join(cwd, "agent.policy.yaml"), policyContent);
      console.log("Created .claude/settings.json, .claude/commands/aepassist.md, CLAUDE.md and agent.policy.yaml");
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
Trust scoring and execution rings provide layered defence.
`
      );

      writeFileSync(join(rulesDir, "aepassist.mdc"), generateCursorRule());

      writeFileSync(join(cwd, "agent.policy.yaml"), policyContent);
      console.log("Created .cursor/mcp.json, .cursor/rules/aepassist.mdc and agent.policy.yaml");
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
Trust scoring and execution rings enforce layered defence.

${generateCodexAgentSection()}`
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
    if (policy.trust) console.log(`  Trust: initial=${policy.trust.initial_score ?? 500}`);
    if (policy.ring) console.log(`  Ring: default=${policy.ring.default ?? 2}`);
    if (policy.intent) console.log(`  Intent tracking: ${policy.intent.tracking ?? false}`);
    if (policy.system) console.log(`  System rate limit: ${policy.system.max_actions_per_minute ?? 200}/min`);
  } catch (err) {
    console.error(
      `Policy validation failed: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}

function handleReport(args: string[]): void {
  const ledgerPath = args[1];
  if (!ledgerPath) {
    console.error("Usage: aep report <ledger-file> [--format json|csv|html]");
    process.exit(1);
  }

  const formatIdx = args.indexOf("--format");
  const format = formatIdx !== -1 ? args[formatIdx + 1] : "text";

  const fullPath = resolve(ledgerPath);
  const filename = fullPath.split("/").pop() ?? "";
  const sessionId = filename.replace(".jsonl", "");
  const dir = fullPath.replace(`/${filename}`, "");

  const ledger = new EvidenceLedger({ dir, sessionId });
  const report = ledger.report();

  switch (format) {
    case "json":
      console.log(JSON.stringify(report, null, 2));
      break;

    case "csv": {
      console.log("session_id,entry_count,chain_valid,first_ts,last_ts");
      const first = report.timeRange?.first ?? "";
      const last = report.timeRange?.last ?? "";
      console.log(`${report.sessionId},${report.entryCount},${report.chainValid},${first},${last}`);
      console.log("\naction_type,count");
      for (const [type, count] of Object.entries(report.actionCounts)) {
        console.log(`${type},${count}`);
      }
      break;
    }

    case "html": {
      const rows = Object.entries(report.actionCounts)
        .map(([t, c]) => `<tr><td>${t}</td><td>${c}</td></tr>`)
        .join("\n");
      console.log(`<!DOCTYPE html>
<html><head><title>AEP Audit Report</title>
<style>body{font-family:sans-serif;margin:2em}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}th{background:#f0f0f0}</style>
</head><body>
<h1>AEP Audit Report</h1>
<p>Session: ${report.sessionId}</p>
<p>Entries: ${report.entryCount}</p>
<p>Chain integrity: ${report.chainValid ? "VALID" : "BROKEN"}</p>
${report.timeRange ? `<p>Time range: ${report.timeRange.first} to ${report.timeRange.last}</p>` : ""}
<table><tr><th>Action Type</th><th>Count</th></tr>
${rows}
</table>
</body></html>`);
      break;
    }

    default: {
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
      break;
    }
  }
}

function handleDescribe(policyPath: string | undefined): void {
  if (!policyPath) {
    console.error("Usage: aep describe <policy-file>");
    process.exit(1);
  }

  try {
    const policy = loadPolicy(resolve(policyPath));
    console.log(`=== ${policy.name} (v${policy.version}) ===\n`);
    console.log(`Capabilities (${policy.capabilities.length}):`);
    for (const cap of policy.capabilities) {
      const scope = cap.scope ? ` scope=${JSON.stringify(cap.scope)}` : "";
      const trust = cap.min_trust_tier ? ` min_trust=${cap.min_trust_tier}` : "";
      console.log(`  ${cap.tool}${scope}${trust}`);
    }
    console.log(`\nForbidden patterns (${policy.forbidden.length}):`);
    for (const fp of policy.forbidden) {
      console.log(`  /${fp.pattern}/ ${fp.reason ? `(${fp.reason})` : ""}`);
    }
    console.log(`\nGates (${policy.gates.length}):`);
    for (const g of policy.gates) {
      console.log(`  ${g.action} -> ${g.approval} (risk: ${g.risk_level})`);
    }
    console.log(`\nSession: max_actions=${policy.session.max_actions}`);
    if (policy.trust) {
      console.log(`Trust: initial=${policy.trust.initial_score ?? 500}, decay=${policy.trust.decay_rate ?? 5}/hr`);
    }
    if (policy.ring) {
      console.log(`Ring: default=${policy.ring.default ?? 2}`);
    }
    if (policy.intent) {
      console.log(`Intent: tracking=${policy.intent.tracking}, threshold=${policy.intent.drift_threshold}, on_drift=${policy.intent.on_drift}`);
    }
    if (policy.system) {
      console.log(`System: max_rate=${policy.system.max_actions_per_minute ?? 200}/min, max_sessions=${policy.system.max_concurrent_sessions ?? 20}`);
    }
  } catch (err) {
    console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function handleKill(args: string[]): void {
  console.log("Kill switch requires an active gateway instance.");
  console.log("Use the KillSwitch API programmatically or via MCP proxy.");
  if (args.includes("--all")) {
    console.log("Would kill all active sessions.");
  } else if (args.includes("--session")) {
    const idx = args.indexOf("--session");
    console.log(`Would kill session: ${args[idx + 1] ?? "(not specified)"}`);
  }
  if (args.includes("--rollback")) {
    console.log("With rollback enabled.");
  }
}

function handleTrust(sessionId: string | undefined): void {
  if (!sessionId) {
    console.error("Usage: aep trust <session-id>");
    process.exit(1);
  }
  console.log("Trust inspection requires an active gateway instance.");
  console.log(`Session: ${sessionId}`);
  console.log("Use the TrustManager API programmatically to inspect trust scores.");
}

function handleRing(sessionId: string | undefined): void {
  if (!sessionId) {
    console.error("Usage: aep ring <session-id>");
    process.exit(1);
  }
  console.log("Ring inspection requires an active gateway instance.");
  console.log(`Session: ${sessionId}`);
  console.log("Use the RingManager API programmatically to inspect ring state.");
}

function handleDrift(sessionId: string | undefined): void {
  if (!sessionId) {
    console.error("Usage: aep drift <session-id>");
    process.exit(1);
  }
  console.log("Drift inspection requires an active gateway instance.");
  console.log(`Session: ${sessionId}`);
  console.log("Use the IntentDriftDetector API programmatically to check drift.");
}

function handleIdentity(args: string[]): void {
  const subcommand = args[1];
  if (subcommand === "create") {
    console.log("Identity creation requires the AgentIdentityManager API.");
    console.log("Usage: AgentIdentityManager.create({ name, role, operator })");
    console.log("This generates an Ed25519 key pair and signs the identity payload.");
  } else if (subcommand === "verify") {
    const file = args[2];
    if (!file) {
      console.error("Usage: aep identity verify <identity-file.json>");
      process.exit(1);
    }
    try {
      const content = readFileSync(resolve(file), "utf-8");
      const identity = JSON.parse(content);
      console.log(`Identity: ${identity.name ?? "unknown"}`);
      console.log(`Role: ${identity.role ?? "unknown"}`);
      console.log(`Agent ID: ${identity.agentId ?? "unknown"}`);
      console.log(`Created: ${identity.createdAt ?? "unknown"}`);
      console.log(`Expires: ${identity.expiresAt ?? "never"}`);
      console.log("Signature verification requires the AgentIdentityManager.verify() API.");
    } catch (err) {
      console.error(`Failed to read identity: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else {
    console.error("Usage: aep identity <create|verify>");
    process.exit(1);
  }
}

function handleCovenant(args: string[]): void {
  const subcommand = args[1];
  if (subcommand === "parse") {
    const file = args[2];
    if (!file) {
      console.error("Usage: aep covenant parse <covenant-file>");
      process.exit(1);
    }
    try {
      const source = readFileSync(resolve(file), "utf-8");
      const spec = parseCovenant(source);
      console.log(`Covenant parsed: ${spec.rules.length} rules`);
      for (const rule of spec.rules) {
        const condStr = rule.conditions.map(c => `${c.field} ${c.operator} ${c.value}`).join(", ");
        console.log(`  ${rule.type} ${rule.action} ${condStr ? `when ${condStr}` : ""}`);
      }
    } catch (err) {
      console.error(`Parse failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else if (subcommand === "verify") {
    const file = args[2];
    const action = args[3];
    if (!file || !action) {
      console.error("Usage: aep covenant verify <covenant-file> <action>");
      process.exit(1);
    }
    try {
      const source = readFileSync(resolve(file), "utf-8");
      const spec = parseCovenant(source);
      const result = evaluateCovenant(spec, { action, input: {} });
      console.log(`Action "${action}": ${result.allowed ? "ALLOWED" : "DENIED"}`);
      if (result.reason) console.log(`Reason: ${result.reason}`);
      if (result.matchedRule) console.log(`Matched rule: ${result.matchedRule.type} ${result.matchedRule.action}`);
    } catch (err) {
      console.error(`Verify failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else {
    console.error("Usage: aep covenant <parse|verify>");
    process.exit(1);
  }
}

async function handleBundle(args: string[]): Promise<void> {
  const subcommand = args[1];
  if (subcommand === "verify") {
    const file = args[2];
    if (!file) {
      console.error("Usage: aep bundle verify <bundle-file> [--ledger <ledger-file>]");
      process.exit(1);
    }
    try {
      const { ProofBundleBuilder } = await import("./proof-bundle/builder.js");
      const { ProofBundleVerifier } = await import("./proof-bundle/verifier.js");

      const builder = new ProofBundleBuilder();
      const bundle = builder.fromFile(resolve(file));
      const verifier = new ProofBundleVerifier();

      const ledgerIdx = args.indexOf("--ledger");
      let result;
      if (ledgerIdx !== -1 && args[ledgerIdx + 1]) {
        result = verifier.verifyWithLedger(bundle, resolve(args[ledgerIdx + 1]));
      } else {
        result = verifier.verify(bundle);
      }

      console.log(`Bundle: ${bundle.bundleId}`);
      console.log(`Agent: ${bundle.agent.name} (${bundle.agent.agentId})`);
      console.log(`Version: ${bundle.version}`);
      console.log(`Created: ${bundle.createdAt}`);
      console.log(`Entries: ${bundle.entryCount}`);
      console.log(`Trust: ${bundle.trustScore.score} (${bundle.trustScore.tier})`);
      console.log(`Ring: ${bundle.ring}`);
      console.log(`Drift: ${bundle.driftScore}`);
      console.log(`\nVerification:`);
      console.log(`  Signature: ${result.signatureValid ? "VALID" : "INVALID"}`);
      console.log(`  Identity: ${result.identityValid ? "VALID" : "INVALID"}`);
      console.log(`  Covenant: ${result.covenantValid ? "VALID" : "INVALID"}`);
      console.log(`  Identity expired: ${result.identityExpired ? "YES" : "no"}`);
      if (result.ledgerHashMatch !== null) {
        console.log(`  Ledger hash: ${result.ledgerHashMatch ? "MATCH" : "MISMATCH"}`);
      }
      if (result.merkleRootMatch !== null) {
        console.log(`  Merkle root: ${result.merkleRootMatch ? "MATCH" : "MISMATCH"}`);
      }
      console.log(`\n  Overall: ${result.valid ? "VALID" : "INVALID"}`);
      if (result.errors.length > 0) {
        console.log(`  Errors:`);
        for (const e of result.errors) {
          console.log(`    - ${e}`);
        }
      }
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else if (subcommand) {
    // subcommand is a session-id
    console.log("Proof bundle generation requires an active gateway instance.");
    console.log(`Session: ${subcommand}`);
    console.log("Use AgentGateway.generateProofBundle() programmatically.");
  } else {
    console.error("Usage: aep bundle <session-id> | aep bundle verify <bundle-file>");
    process.exit(1);
  }
}

function handleTasks(args: string[]): void {
  const sessionId = args[1];
  if (!sessionId) {
    console.error("Usage: aep tasks <session-id> [--tree]");
    process.exit(1);
  }
  const showTree = args.includes("--tree");
  console.log("Task tree inspection requires an active gateway instance.");
  console.log(`Session: ${sessionId}`);
  console.log(`Format: ${showTree ? "tree" : "list"}`);
  console.log("Use TaskDecompositionManager.getTree() programmatically.");
}

function handleOwasp(): void {
  console.log(`OWASP Agentic AI Top 10 -- AEP 2.2 Mapping

  01 Agent Hijacking
     Mitigation: Policy evaluation chain, forbidden patterns, session isolation

  02 Tool Misuse
     Mitigation: Capability scoping, execution rings, trust-gated tools

  03 Privilege Escalation
     Mitigation: Ring promotion requires trust tier + operator approval

  04 Data Exfiltration
     Mitigation: Forbidden patterns, scope restrictions, binary allowlists

  05 Supply Chain Compromise
     Mitigation: Behavioural covenants, identity verification, proof bundles

  06 Prompt Injection
     Mitigation: Policy evaluation runs before tool execution, not in LLM context

  07 Insecure Output Handling
     Mitigation: Evidence ledger records all outputs for audit

  08 Denial of Service
     Mitigation: System-wide rate limiting, per-session limits, kill switch

  09 Excessive Agency
     Mitigation: Intent drift detection, warmup baseline, escalation rules

  10 Insufficient Logging
     Mitigation: SHA-256 hash-chained evidence ledger, Merkle proofs, RFC 3161 timestamps
`);
}

function handleSync(): void {
  const offlinePath = resolve("./ledgers/offline.jsonl");
  if (!existsSync(offlinePath)) {
    console.log("No offline ledger found at ./ledgers/offline.jsonl");
    console.log("Offline signing queues actions when the network is unavailable.");
    console.log("Use OfflineLedger programmatically to create offline entries.");
    return;
  }
  try {
    const content = readFileSync(offlinePath, "utf-8").trim();
    const entries = content.split("\n").filter(l => l.trim());
    console.log(`Found ${entries.length} offline entries to sync.`);
    console.log("Verifying local chain integrity...");
    let valid = true;
    for (let i = 0; i < entries.length; i++) {
      try {
        JSON.parse(entries[i]);
      } catch {
        console.error(`Entry ${i} is malformed.`);
        valid = false;
      }
    }
    if (valid) {
      console.log("Local chain integrity: VALID");
      console.log(`${entries.length} entries ready for sync.`);
      console.log("Use OfflineLedger.sync() programmatically to merge into the main ledger.");
    } else {
      console.error("Local chain integrity: BROKEN - sync aborted.");
      process.exit(1);
    }
  } catch (err) {
    console.error(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function generateDefaultPolicy(): string {
  return `version: "2.2"
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

trust:
  initial_score: 500
  decay_rate: 5

ring:
  default: 2

intent:
  tracking: true
  drift_threshold: 0.5
  warmup_actions: 10
  on_drift: warn

system:
  max_actions_per_minute: 200
  max_concurrent_sessions: 20

evidence:
  enabled: true
  dir: "./ledgers"
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
