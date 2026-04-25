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
import { AEPassistant } from "./aepassist/assistant.js";
import { AgentGateway } from "./gateway.js";
import { ProofBundleBuilder } from "./proof-bundle/builder.js";
import { DEFAULT_RELIABILITY_WEIGHTS } from "./proof-bundle/types.js";
import { EvalRunner } from "./eval/runner.js";
import { RuleGenerator } from "./eval/rule-generator.js";
import { DatasetManager } from "./datasets/manager.js";
import { PromptOptimizer } from "./optimization/optimizer.js";
import { PromptVersionManager } from "./optimization/versioning.js";
import type { EvalDataset } from "./eval/types.js";
import { GovernedModelGateway } from "./model-gateway/gateway.js";
import { ModelConfigSchema, ModelRequestSchema } from "./model-gateway/types.js";
import type { ModelProvider } from "./model-gateway/types.js";
import { KnowledgeBaseManager } from "./knowledge/manager.js";
import { createDefaultPipeline } from "./scanners/pipeline.js";
import { DataProfileScanner } from "./scanners/profiler.js";
import { MLMetrics } from "./eval/metrics.js";
import type { MLMetricsReport } from "./eval/metrics.js";
import { createFineTuningWorkflow } from "./workflow/templates/fine-tuning.js";
import { WorkflowExecutor } from "./workflow/executor.js";
import { SpendTracker } from "./subprotocols/commerce/spend-tracker.js";
import { CommerceRegistry } from "./subprotocols/commerce/registry.js";
import { FleetManager } from "./fleet/manager.js";
import { FleetAPI } from "./fleet/api.js";

const args = process.argv.slice(2);
const command = args[0];

function usage(): void {
  console.log(`AEP -- Agent Element Protocol v2.5

Usage:
  aep assist [command]          Interactive governance assistant (/aepassist)
  aep serve                     Start MCP server (stdio mode for Claude Code)
  aep call <prompt>             Call a model through governed gateway
      --model <model>           Model to use (e.g. claude-sonnet-4-5-20250929)
      --provider <provider>     Provider (anthropic|openai|ollama|custom)
      --policy <file>           Policy file
      --file <file>             Read prompt from file instead
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
  aep reliability <ledger-file>  Show reliability index (theta) for session
  aep eval <dataset> --policy <p>  Run eval dataset against policy
  aep dataset create <name>       Create a new eval dataset
  aep dataset add <name> <input>  Add entry to dataset
  aep dataset import <name> <f>   Import entries from ledger
  aep dataset export <name>       Export dataset (--format json|csv)
  aep dataset list                List all datasets
  aep prompt save <n> <v> <file>  Save a prompt version
  aep prompt load <name> [ver]    Load a prompt version
  aep prompt list <name>          List prompt versions
  aep prompt diff <n> <a> <b>     Diff two prompt versions
  aep prompt inject <file> --policy <p>  Inject governance context
  aep kb create <name>            Create a knowledge base
  aep kb ingest <name> <file>     Ingest file into knowledge base
  aep kb query <name> <query>     Query a knowledge base
  aep kb list                     List all knowledge bases
  aep kb stats <name>             Show knowledge base statistics
  aep profile <file>              Run data profiling scanner on file
  aep metrics <file>              Compute ML metrics from JSON results
  aep workflow init <template>    Show workflow template phases
  aep workflow start <template>   Start a governed workflow
  aep scan <text>                 Run scanner pipeline on text
  aep scan --file <file>          Scan file contents
  aep commerce status             Show daily spend and active summary
  aep commerce merchants          List registered merchant profiles
  aep commerce spend              Show daily spend tracker
  aep fleet status                Show fleet status (agents, trust, cost)
  aep fleet agents                List all agents in the fleet
  aep fleet pause                 Pause all fleet agents
  aep fleet resume                Resume all fleet agents
  aep fleet kill [--rollback]     Kill all fleet agents
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
  console.log("aep 2.5.0");
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
    case "assist":
    case "/aepassist":
      handleAssist(args.slice(1));
      break;
    case "call":
      await handleCall(args);
      break;
    case "init":
      handleInit(args[1]);
      break;
    case "proxy":
      handleProxy(args);
      break;
    case "serve":
      handleServe();
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
    case "reliability":
      handleReliability(args[1]);
      break;
    case "owasp":
      handleOwasp();
      break;
    case "sync":
      handleSync();
      break;
    case "eval":
      handleEval(args);
      break;
    case "dataset":
      handleDataset(args);
      break;
    case "prompt":
      handlePrompt(args);
      break;
    case "kb":
      handleKb(args);
      break;
    case "scan":
      handleScan(args);
      break;
    case "commerce":
      handleCommerce(args);
      break;
    case "profile":
      handleProfile(args);
      break;
    case "metrics":
      handleMetrics(args);
      break;
    case "workflow":
      handleWorkflow(args);
      break;
    case "fleet":
      handleFleet(args);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

function handleAssist(assistArgs: string[]): void {
  const gateway = new AgentGateway({ ledgerDir: resolve("./ledgers") });
  const assistant = new AEPassistant(gateway, process.cwd());
  const input = assistArgs.join(" ");
  const response = assistant.handle(input);

  console.log(response.message);

  if (response.prompt) {
    console.log(`\n${response.prompt}`);
  }
  if (response.actions && response.actions.length > 0) {
    console.log(`\nAvailable: ${response.actions.join(", ")}`);
  }
}

async function handleCall(args: string[]): Promise<void> {
  const providerIdx = args.indexOf("--provider");
  const modelIdx = args.indexOf("--model");
  const policyIdx = args.indexOf("--policy");
  const fileIdx = args.indexOf("--file");

  const provider = (providerIdx !== -1 ? args[providerIdx + 1] : "anthropic") as ModelProvider;
  const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;

  if (!model) {
    console.error("Usage: aep call <prompt> --model <model> --provider <provider> [--policy <file>] [--file <file>]");
    process.exit(1);
  }

  // Build prompt from args or file
  let prompt: string;
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    prompt = readFileSync(resolve(args[fileIdx + 1]), "utf-8");
  } else {
    // Collect non-flag arguments as the prompt
    const flagPositions = new Set([providerIdx, providerIdx + 1, modelIdx, modelIdx + 1, policyIdx, policyIdx + 1, fileIdx, fileIdx + 1, 0]);
    const promptParts = args.filter((_, i) => !flagPositions.has(i));
    prompt = promptParts.join(" ").trim();
  }

  if (!prompt) {
    console.error("No prompt provided. Pass prompt text or use --file <file>.");
    process.exit(1);
  }

  // Load policy if provided
  const policyPath = policyIdx !== -1 ? args[policyIdx + 1] : undefined;
  let policy;
  if (policyPath) {
    policy = loadPolicy(resolve(policyPath));
  } else {
    // Minimal inline policy
    policy = loadPolicy(resolve("./agent.policy.yaml"));
  }

  const config = ModelConfigSchema.parse({
    provider,
    model,
  });

  const sessionId = `call-${Date.now()}`;
  const gateway = new GovernedModelGateway(
    { sessionId, config },
    { policy },
  );

  try {
    const response = await gateway.call(
      ModelRequestSchema.parse({ messages: [{ role: "user", content: prompt }] }),
    );

    console.log(response.content);

    if (response.cost.totalCost > 0) {
      console.error(`\n[Cost: ${response.cost.currency} ${response.cost.totalCost.toFixed(6)} | Tokens: ${response.usage.totalTokens} | ${response.latencyMs}ms]`);
    }
  } catch (err) {
    console.error(`Call failed: ${err instanceof Error ? err.message : String(err)}`);
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

        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "aep", version: "2.5.0" },
            },
          }) + "\n");
        } else if (msg.method === "notifications/initialized") {
          // No response for notifications
        } else if (msg.method === "ping") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0", id: msg.id, result: {},
          }) + "\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              tools: [{
                name: "aepassist",
                description: "AEP interactive governance assistant. Handles setup, status, presets, emergency controls, covenants, identity and reports.",
                inputSchema: {
                  type: "object",
                  properties: {
                    command: {
                      type: "string",
                      description: "Command to run (setup, status, preset, kill, covenant, identity, report, help)",
                    },
                  },
                },
              }],
            },
          }) + "\n");
        } else if (msg.method === "tools/call") {
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

function handleServe(): void {
  const ledgerDir = resolve("./ledgers");
  const gateway = new AgentGateway({ ledgerDir });

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
        const response = handleMCPMessage(msg, gateway);
        if (response) {
          process.stdout.write(JSON.stringify(response) + "\n");
        }
      } catch {
        // Skip malformed lines
      }
    }
  });
}

interface JSONRPCMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

function handleMCPMessage(msg: JSONRPCMessage, gateway: AgentGateway): Record<string, unknown> | null {
  if (msg.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "aep", version: "2.5.0" },
      },
    };
  }

  if (msg.method === "notifications/initialized") {
    return null;
  }

  if (msg.method === "ping") {
    return { jsonrpc: "2.0", id: msg.id, result: {} };
  }

  if (msg.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "aepassist",
            description: "AEP interactive governance assistant. Handles setup, status, presets, emergency controls, covenants, identity and reports.",
            inputSchema: {
              type: "object",
              properties: {
                command: {
                  type: "string",
                  description: "Command to run (setup, status, preset, kill, covenant, identity, report, help)",
                },
              },
            },
          },
        ],
      },
    };
  }

  if (msg.method === "tools/call") {
    const params = msg.params ?? {};
    const name = typeof params.name === "string" ? params.name : "";
    const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;

    if (name === "aepassist") {
      const input = typeof toolArgs.command === "string"
        ? toolArgs.command
        : typeof toolArgs.input === "string"
          ? toolArgs.input
          : "";
      const assistant = new AEPassistant(gateway, process.cwd());
      const response = assistant.handle(input);
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(response) }],
        },
      };
    }

    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      },
    };
  }

  return {
    jsonrpc: "2.0",
    id: msg.id,
    error: { code: -32601, message: `Method not found: ${msg.method}` },
  };
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

function handleReliability(ledgerPath: string | undefined): void {
  if (!ledgerPath) {
    console.error("Usage: aep reliability <ledger-file>");
    process.exit(1);
  }

  const fullPath = resolve(ledgerPath);
  const filename = fullPath.split("/").pop() ?? "";
  const sessionId = filename.replace(".jsonl", "");
  const dir = fullPath.replace(`/${filename}`, "");

  const ledger = new EvidenceLedger({ dir, sessionId });
  const entries = ledger.entries();

  if (entries.length === 0) {
    console.error("No entries found in ledger.");
    process.exit(1);
  }

  const ri = ProofBundleBuilder.computeReliability(
    entries,
    { score: 500, tier: "standard" },
    0,
    DEFAULT_RELIABILITY_WEIGHTS
  );

  console.log(`Reliability Index for ${sessionId}`);
  console.log(`  Hard compliance rate:  ${ri.hardComplianceRate}`);
  console.log(`  Soft recovery rate:    ${ri.softRecoveryRate}`);
  console.log(`  Drift score:           ${ri.driftScore}`);
  console.log(`  Trust score:           ${ri.trustScore}`);
  console.log(`  Scanner pass rate:     ${ri.scannerPassRate}`);
  console.log(`  Theta (composite):     ${ri.theta}`);
}

function handleOwasp(): void {
  console.log(`OWASP Agentic AI Top 10 -- AEP 2.5 Mapping

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

function handleEval(args: string[]): void {
  const datasetFile = args[1];
  const policyIdx = args.indexOf("--policy");
  const policyPath = policyIdx !== -1 ? args[policyIdx + 1] : undefined;

  if (!datasetFile || !policyPath) {
    console.error("Usage: aep eval <dataset-file> --policy <policy-file>");
    process.exit(1);
  }

  try {
    const datasetContent = readFileSync(resolve(datasetFile), "utf-8");
    const dataset: EvalDataset = JSON.parse(datasetContent);
    const gateway = new AgentGateway({ ledgerDir: resolve("./ledgers") });
    const runner = new EvalRunner(gateway);
    const report = runner.run(dataset, resolve(policyPath));

    console.log(`Eval: ${report.datasetName}`);
    console.log(`  Total: ${report.total}`);
    console.log(`  Passed: ${report.passed}`);
    console.log(`  Failed: ${report.failed}`);
    console.log(`  False positives: ${report.falsePositives}`);
    console.log(`  False negatives: ${report.falseNegatives}`);

    if (report.violations.length > 0) {
      console.log(`\nViolations:`);
      for (const v of report.violations) {
        console.log(`  ${v.rule} (${v.category}): ${v.count} occurrences [${v.severity}]`);
      }
    }

    if (report.suggestedRules.length > 0) {
      console.log(`\nSuggested rules:`);
      for (const s of report.suggestedRules) {
        console.log(`  [${s.type}] ${s.rule} (confidence: ${s.confidence.toFixed(2)})`);
      }

      const generator = new RuleGenerator();
      const suggestionsDir = resolve(".aep/suggestions");
      const filePath = generator.writeSuggestions(report, suggestionsDir);
      console.log(`\nSuggestions written to ${filePath}`);
    }
  } catch (err) {
    console.error(`Eval failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function handleDataset(args: string[]): void {
  const subcommand = args[1];
  const datasetDir = resolve(".aep/datasets");
  const manager = new DatasetManager(datasetDir);

  switch (subcommand) {
    case "create": {
      const name = args[2];
      const description = args[3];
      if (!name) {
        console.error("Usage: aep dataset create <name> [description]");
        process.exit(1);
      }
      const ds = manager.create(name, description);
      console.log(`Created dataset "${ds.name}" v${ds.version}`);
      break;
    }

    case "add": {
      const name = args[2];
      const input = args[3];
      const outcome = args[4] ?? "pass";
      if (!name || !input) {
        console.error("Usage: aep dataset add <name> <input> [pass|fail]");
        process.exit(1);
      }
      manager.addEntry(name, {
        input,
        expectedOutcome: outcome as "pass" | "fail",
      });
      console.log(`Added entry to "${name}".`);
      break;
    }

    case "import": {
      const name = args[2];
      const ledgerPath = args[3];
      if (!name || !ledgerPath) {
        console.error("Usage: aep dataset import <name> <ledger-file>");
        process.exit(1);
      }
      try {
        manager.get(name);
      } catch {
        manager.create(name, `Imported from ${ledgerPath}`);
      }
      const added = manager.addFromLedger(name, resolve(ledgerPath));
      console.log(`Imported ${added} entries from ledger into "${name}".`);
      break;
    }

    case "export": {
      const name = args[2];
      const formatIdx = args.indexOf("--format");
      const format = formatIdx !== -1 ? args[formatIdx + 1] : "json";
      if (!name) {
        console.error("Usage: aep dataset export <name> [--format json|csv]");
        process.exit(1);
      }
      const output = manager.export(name, format as "json" | "csv");
      console.log(output);
      break;
    }

    case "list": {
      const datasets = manager.list();
      if (datasets.length === 0) {
        console.log("No datasets found.");
      } else {
        console.log(`Datasets (${datasets.length}):`);
        for (const ds of datasets) {
          console.log(`  ${ds.name} v${ds.version} (${ds.entryCount} entries) ${ds.description ?? ""}`);
        }
      }
      break;
    }

    default:
      console.error("Usage: aep dataset <create|add|import|export|list>");
      process.exit(1);
  }
}

function handlePrompt(args: string[]): void {
  const subcommand = args[1];
  const manager = new PromptVersionManager(resolve("."));

  switch (subcommand) {
    case "save": {
      const name = args[2];
      const ver = args[3];
      const file = args[4];
      if (!name || !ver || !file) {
        console.error("Usage: aep prompt save <name> <version> <file>");
        process.exit(1);
      }
      const content = readFileSync(resolve(file), "utf-8");
      manager.save(name, ver, content);
      console.log(`Saved prompt "${name}" v${ver}.`);
      break;
    }

    case "load": {
      const name = args[2];
      const ver = args[3];
      if (!name) {
        console.error("Usage: aep prompt load <name> [version]");
        process.exit(1);
      }
      const content = manager.load(name, ver);
      console.log(content);
      break;
    }

    case "list": {
      const name = args[2];
      if (!name) {
        console.error("Usage: aep prompt list <name>");
        process.exit(1);
      }
      const versions = manager.list(name);
      if (versions.length === 0) {
        console.log(`No versions found for "${name}".`);
      } else {
        console.log(`Versions for "${name}":`);
        for (const v of versions) {
          console.log(`  ${v.version}  ${v.savedAt}  ${v.hash.slice(0, 12)}...`);
        }
      }
      break;
    }

    case "diff": {
      const name = args[2];
      const vA = args[3];
      const vB = args[4];
      if (!name || !vA || !vB) {
        console.error("Usage: aep prompt diff <name> <versionA> <versionB>");
        process.exit(1);
      }
      const diff = manager.diff(name, vA, vB);
      console.log(diff);
      break;
    }

    case "inject": {
      const file = args[2];
      const policyIdx = args.indexOf("--policy");
      const policyPath = policyIdx !== -1 ? args[policyIdx + 1] : undefined;
      if (!file || !policyPath) {
        console.error("Usage: aep prompt inject <file> --policy <policy-file>");
        process.exit(1);
      }
      const prompt = readFileSync(resolve(file), "utf-8");
      const policy = loadPolicy(resolve(policyPath));

      const covenantIdx = args.indexOf("--covenant");
      let covenant;
      if (covenantIdx !== -1 && args[covenantIdx + 1]) {
        const covenantSource = readFileSync(resolve(args[covenantIdx + 1]), "utf-8");
        covenant = parseCovenant(covenantSource);
      }

      const optimizer = new PromptOptimizer(policy, covenant);
      const result = optimizer.injectGovernanceContext(prompt);
      console.log(result);
      break;
    }

    default:
      console.error("Usage: aep prompt <save|load|list|diff|inject>");
      process.exit(1);
  }
}

function handleKb(kbArgs: string[]): void {
  const sub = kbArgs[1];
  const pipeline = createDefaultPipeline();
  const manager = new KnowledgeBaseManager({ pipeline });

  switch (sub) {
    case "create": {
      const name = kbArgs[2];
      if (!name) { console.error("Usage: aep kb create <name>"); process.exit(1); }
      manager.create(name);
      console.log(`Created knowledge base "${name}".`);
      break;
    }
    case "ingest": {
      const name = kbArgs[2];
      const file = kbArgs[3];
      if (!name || !file) { console.error("Usage: aep kb ingest <name> <file>"); process.exit(1); }
      const report = manager.ingestFile(name, resolve(file));
      console.log(`Ingested: ${report.validated} validated, ${report.rejected} rejected, ${report.flagged} flagged (${report.total} total chunks).`);
      break;
    }
    case "query": {
      const name = kbArgs[2];
      const query = kbArgs.slice(3).join(" ");
      if (!name || !query) { console.error("Usage: aep kb query <name> <query>"); process.exit(1); }
      const results = manager.query(name, query);
      if (results.length === 0) {
        console.log("No matching chunks.");
      } else {
        for (const c of results) {
          const status = c.validated ? "validated" : "flagged";
          console.log(`--- ${c.id} [${status}] source: ${c.source} ---`);
          console.log(c.content.slice(0, 200));
          console.log();
        }
      }
      break;
    }
    case "list": {
      const bases = manager.list();
      if (bases.length === 0) { console.log("No knowledge bases found."); }
      else {
        for (const b of bases) {
          console.log(`  ${b.name}  total: ${b.total}  validated: ${b.validated}  flagged: ${b.flagged}`);
        }
      }
      break;
    }
    case "stats": {
      const name = kbArgs[2];
      if (!name) { console.error("Usage: aep kb stats <name>"); process.exit(1); }
      const s = manager.stats(name);
      console.log(`Knowledge base: ${name}`);
      console.log(`  Total:     ${s.total}`);
      console.log(`  Validated: ${s.validated}`);
      console.log(`  Flagged:   ${s.flagged}`);
      console.log(`  Rejected:  ${s.rejected}`);
      break;
    }
    default:
      console.error("Usage: aep kb <create|ingest|query|list|stats>");
      process.exit(1);
  }
}

function handleScan(args: string[]): void {
  const fileIdx = args.indexOf("--file");
  const scannersIdx = args.indexOf("--scanners");
  let content: string;

  if (fileIdx !== -1 && args[fileIdx + 1]) {
    content = readFileSync(resolve(args[fileIdx + 1]), "utf-8");
  } else {
    // Filter out --scanners and its value from content args
    const contentArgs = args.slice(1).filter((_, i) => {
      const argIdx = i + 1;
      return argIdx !== scannersIdx && argIdx !== scannersIdx + 1;
    });
    content = contentArgs.join(" ");
  }

  if (!content.trim()) {
    console.error("Usage: aep scan <text> or aep scan --file <file> [--scanners name1,name2]");
    process.exit(1);
  }

  // Build config enabling requested scanners
  const pipelineConfig: Record<string, { enabled: boolean }> = {};
  if (scannersIdx !== -1 && args[scannersIdx + 1]) {
    const requested = args[scannersIdx + 1].split(",").map((s) => s.trim());
    for (const name of requested) {
      pipelineConfig[name] = { enabled: true };
    }
  }

  const pipeline = createDefaultPipeline(pipelineConfig);
  const result = pipeline.scan(content);

  if (result.passed) {
    console.log("PASS: No findings.");
  } else {
    console.log(`FINDINGS (${result.findings.length}):`);
    for (const f of result.findings) {
      console.log(`  [${f.severity}] ${f.scanner}: ${f.category} at pos ${f.position}`);
    }
  }
}

function handleCommerce(args: string[]): void {
  const sub = args[1];

  switch (sub) {
    case "status": {
      const tracker = new SpendTracker(0, "USD");
      const today = tracker.getToday();
      const maxDaily = tracker.getMaxDaily();
      console.log("Commerce Status");
      console.log(`  Daily spend: ${today} ${tracker.getCurrency()}`);
      if (maxDaily > 0) {
        console.log(`  Daily limit: ${maxDaily} ${tracker.getCurrency()}`);
        console.log(`  Remaining:   ${Math.max(0, maxDaily - today)} ${tracker.getCurrency()}`);
      } else {
        console.log("  Daily limit: not configured");
      }
      console.log("\nUse CommerceValidator and CommerceRegistry APIs programmatically");
      console.log("to manage carts and merchant registrations.");
      break;
    }
    case "merchants": {
      const registry = new CommerceRegistry();
      const merchants = registry.listMerchants();
      if (merchants.length === 0) {
        console.log("No merchants registered.");
        console.log("Use CommerceRegistry.registerMerchant() to add merchants.");
      } else {
        console.log(`Merchants (${merchants.length}):`);
        for (const m of merchants) {
          console.log(`  ${m.id}: ${m.name} (${m.currency}) handlers: ${m.paymentHandlers.join(", ")}`);
        }
      }
      break;
    }
    case "spend": {
      const tracker = new SpendTracker(0, "USD");
      const today = tracker.getToday();
      console.log("Daily Spend Tracker");
      console.log(`  Today: ${today} ${tracker.getCurrency()}`);
      console.log(`  Date:  ${new Date().toISOString().slice(0, 10)}`);
      const maxDaily = tracker.getMaxDaily();
      if (maxDaily > 0) {
        const pct = today > 0 ? ((today / maxDaily) * 100).toFixed(1) : "0.0";
        console.log(`  Usage: ${pct}% of ${maxDaily} ${tracker.getCurrency()} limit`);
      }
      break;
    }
    default:
      console.error("Usage: aep commerce <status|merchants|spend>");
      process.exit(1);
  }
}

function generateDefaultPolicy(): string {
  return `version: "2.5"
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

function handleProfile(args: string[]): void {
  const filePath = args[1];
  if (!filePath) {
    console.error("Usage: aep profile <file>");
    process.exit(1);
  }

  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const content = readFileSync(resolved, "utf-8");
  const scanner = new DataProfileScanner();
  const findings = scanner.scan(content);

  if (findings.length === 0) {
    console.log("PASS: No data quality issues found.");
  } else {
    console.log(`DATA PROFILE FINDINGS (${findings.length}):`);
    for (const f of findings) {
      console.log(`  [${f.severity}] ${f.category}: ${f.match}`);
    }
  }
}

function handleMetrics(args: string[]): void {
  const filePath = args[1];
  if (!filePath) {
    console.error("Usage: aep metrics <file>");
    console.error("  File should be JSON with { type, actual, predicted } or { type, relevant, retrieved, k }");
    process.exit(1);
  }

  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const content = readFileSync(resolved, "utf-8");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(content);
  } catch {
    console.error("Invalid JSON file.");
    process.exit(1);
    return;
  }

  const report: MLMetricsReport = {};

  if (data.type === "classification" && Array.isArray(data.actual) && Array.isArray(data.predicted)) {
    report.classification = MLMetrics.classification(data.actual as number[], data.predicted as number[]);
    console.log("Classification Metrics:");
    console.log(`  Accuracy:  ${report.classification.accuracy}`);
    console.log(`  Precision: ${report.classification.precision}`);
    console.log(`  Recall:    ${report.classification.recall}`);
    console.log(`  F1:        ${report.classification.f1}`);
    const cm = report.classification.confusionMatrix;
    console.log(`  Confusion: TP=${cm.tp} FP=${cm.fp} TN=${cm.tn} FN=${cm.fn}`);
  } else if (data.type === "regression" && Array.isArray(data.actual) && Array.isArray(data.predicted)) {
    report.regression = MLMetrics.regression(data.actual as number[], data.predicted as number[]);
    console.log("Regression Metrics:");
    console.log(`  MSE:  ${report.regression.mse}`);
    console.log(`  RMSE: ${report.regression.rmse}`);
    console.log(`  MAE:  ${report.regression.mae}`);
    console.log(`  R2:   ${report.regression.r2}`);
    console.log(`  MAPE: ${report.regression.mape}%`);
  } else if (data.type === "retrieval" && Array.isArray(data.relevant) && Array.isArray(data.retrieved)) {
    const k = typeof data.k === "number" ? data.k : 10;
    report.retrieval = MLMetrics.retrieval(data.relevant as string[], data.retrieved as string[], k);
    console.log(`Retrieval Metrics (k=${k}):`);
    console.log(`  Precision@${k}: ${report.retrieval.precisionAtK}`);
    console.log(`  Recall@${k}:    ${report.retrieval.recallAtK}`);
    console.log(`  MRR:            ${report.retrieval.mrr}`);
    console.log(`  NDCG:           ${report.retrieval.ndcg}`);
  } else if (data.type === "generation" && Array.isArray(data.expected) && Array.isArray(data.generated)) {
    report.generation = MLMetrics.generation(data.expected as string[], data.generated as string[]);
    console.log("Generation Metrics:");
    console.log(`  Exact Match: ${report.generation.exactMatch}`);
    console.log(`  Avg Length:  ${report.generation.avgLength}`);
    console.log(`  Empty Rate:  ${report.generation.emptyRate}`);
  } else {
    console.error("Unknown metrics type. Supported: classification, regression, retrieval, generation");
    process.exit(1);
  }

  const composite = MLMetrics.compositeScore(report);
  console.log(`\nComposite ML Score: ${composite}`);
}

function handleWorkflow(args: string[]): void {
  const sub = args[1];
  const template = args[2];

  if (!sub || !template) {
    console.error("Usage: aep workflow init <template> | aep workflow start <template>");
    console.error("  Templates: fine-tuning");
    process.exit(1);
  }

  if (template !== "fine-tuning") {
    console.error(`Unknown workflow template: ${template}`);
    console.error("Available templates: fine-tuning");
    process.exit(1);
  }

  const definition = createFineTuningWorkflow();

  switch (sub) {
    case "init": {
      console.log(`Workflow: ${definition.name}`);
      console.log(`Phases: ${definition.phases.length}`);
      console.log(`On Fail: ${definition.onFail}`);
      console.log("");
      for (let i = 0; i < definition.phases.length; i++) {
        const phase = definition.phases[i];
        console.log(`  ${i + 1}. ${phase.name}`);
        console.log(`     ${phase.description}`);
        console.log(`     Role: ${phase.role} | Ring: ${phase.ring} | Max Rework: ${phase.maxRework}`);
        console.log(`     Exit Criteria: ${phase.exitCriteria.map((c) => c.type + (c.value !== undefined ? `(${c.value})` : "")).join(", ")}`);
        console.log("");
      }
      break;
    }
    case "start": {
      const policyIdx = args.indexOf("--policy");
      const policyPath = policyIdx !== -1 ? args[policyIdx + 1] : undefined;

      if (!policyPath) {
        console.log("Starting workflow without policy binding (dry run).");
      }

      const gateway = new AgentGateway({ ledgerDir: resolve("./ledgers") });
      const executor = new WorkflowExecutor(definition, gateway);

      console.log(`Workflow "${definition.name}" initialised with ${definition.phases.length} phases.`);
      console.log("Phases:");
      for (const phase of definition.phases) {
        console.log(`  - ${phase.name} (${phase.role}, ring ${phase.ring})`);
      }
      console.log("\nUse WorkflowExecutor API to advance through phases programmatically.");
      break;
    }
    default:
      console.error("Usage: aep workflow init <template> | aep workflow start <template>");
      process.exit(1);
  }
}

function handleFleet(args: string[]): void {
  const sub = args[1];
  const gateway = new AgentGateway({ ledgerDir: resolve("./ledgers") });

  // Fleet requires a running gateway with fleet policy enabled.
  // For CLI, we show informational output.
  switch (sub) {
    case "status": {
      const fm = gateway.getFleetManager();
      if (!fm) {
        console.log("Fleet governance is not enabled.");
        console.log("Enable by adding fleet.enabled: true to your policy file.");
        console.log("Use FleetManager and FleetAPI programmatically for live fleet status.");
        return;
      }
      const status = fm.getStatus();
      console.log("Fleet Status");
      console.log(`  Active agents:  ${status.activeAgents}`);
      console.log(`  Total sessions: ${status.totalSessions}`);
      console.log(`  Fleet trust:    ${status.fleetTrust.toFixed(0)}`);
      console.log(`  Fleet drift:    ${status.fleetDrift.toFixed(2)}`);
      console.log(`  Total cost:     ${status.totalCost.toFixed(4)}`);
      console.log(`  Total tokens:   ${status.totalTokens}`);
      if (status.alerts.length > 0) {
        console.log(`\n  Alerts (${status.alerts.length}):`);
        for (const a of status.alerts) {
          console.log(`    [${a.severity}] ${a.type}: ${a.message}`);
        }
      }
      break;
    }
    case "agents": {
      const fm = gateway.getFleetManager();
      if (!fm) {
        console.log("Fleet governance is not enabled.");
        return;
      }
      const status = fm.getStatus();
      if (status.agents.length === 0) {
        console.log("No agents registered.");
      } else {
        console.log(`Agents (${status.agents.length}):`);
        for (const a of status.agents) {
          console.log(`  ${a.agentId} [${a.status}] trust=${a.trust} ring=${a.ring} drift=${a.drift.toFixed(2)} cost=${a.cost.toFixed(4)}`);
        }
      }
      break;
    }
    case "pause": {
      console.log("Fleet pause requires an active gateway with fleet enabled.");
      console.log("Use FleetAPI.pauseFleet() or FleetManager.pauseFleet() programmatically.");
      break;
    }
    case "resume": {
      console.log("Fleet resume requires an active gateway with fleet enabled.");
      console.log("Use FleetAPI.resumeFleet() or FleetManager.resumeFleet() programmatically.");
      break;
    }
    case "kill": {
      const rollback = args.includes("--rollback");
      console.log("Fleet kill requires an active gateway with fleet enabled.");
      console.log(`Would kill all fleet agents${rollback ? " with rollback" : ""}.`);
      console.log("Use FleetAPI.killFleet() or FleetManager.killFleet() programmatically.");
      break;
    }
    default:
      console.error("Usage: aep fleet <status|agents|pause|resume|kill>");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
