// AEP Interactive Assistant
// Conversational interface over existing AEP capabilities

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AgentGateway } from "../gateway.js";
import { loadPolicy } from "../policy/loader.js";
import { EvidenceLedger } from "../ledger/ledger.js";
import type { Policy } from "../policy/types.js";
import type { AssistPreset, AssistAgent, AssistStatus, AssistIntent } from "./types.js";
import { getPreset, generatePolicyYaml } from "./presets.js";
import { getExplanation, findBestMatch, getAvailableTopics } from "./explanations.js";
import { generateClaudeCodeCommand, generateCursorRule, generateCodexAgentSection } from "./slash-commands.js";

export interface AssistantOptions {
  workDir?: string;
  gateway?: AgentGateway;
  policyPath?: string;
}

export interface AssistResponse {
  message: string;
  filesCreated?: string[];
  filesModified?: string[];
  error?: string;
}

export class AEPAssistant {
  private workDir: string;
  private gateway: AgentGateway | null;
  private policyPath: string;

  constructor(options: AssistantOptions = {}) {
    this.workDir = options.workDir ?? process.cwd();
    this.gateway = options.gateway ?? null;
    this.policyPath = options.policyPath ?? join(this.workDir, "agent.policy.yaml");
  }

  isGovernanceActive(): boolean {
    return existsSync(this.policyPath);
  }

  detectIntent(input: string): AssistIntent {
    const lower = input.toLowerCase().trim();

    // Emergency - check first
    if (/\b(kill|stop everything|emergency|terminate all|shut down)\b/.test(lower)) {
      return { type: "emergency", detail: lower };
    }

    // Setup
    if (/\b(setup|init|initialise|initialize|first time|get started|configure|install)\b/.test(lower)) {
      return { type: "setup", detail: lower };
    }
    if (!this.isGovernanceActive()) {
      return { type: "setup" };
    }

    // Status
    if (/\b(status|state|show|overview|dashboard|how am i|current|check)\b/.test(lower)) {
      return { type: "status", detail: lower };
    }

    // Settings changes
    if (/\b(enable|disable|turn on|turn off|set|change|modify|update|make it|switch to|adjust)\b/.test(lower)) {
      return { type: "settings", detail: lower };
    }

    // Reports
    if (/\b(report|audit|compliance|export|what happened|show me what|generate report)\b/.test(lower)) {
      return { type: "report", detail: lower };
    }

    // Proof bundles
    if (/\b(proof|bundle|package|package this|sign session)\b/.test(lower)) {
      return { type: "proof", detail: lower };
    }

    // Tasks
    if (/\b(task|subtask|decomposition|task tree|show tasks)\b/.test(lower)) {
      return { type: "tasks", detail: lower };
    }

    // Identity
    if (/\b(identity|agent card|create identity|verify identity|key pair)\b/.test(lower)) {
      return { type: "identity", detail: lower };
    }

    // Covenant
    if (/\b(covenant|create covenant|define behaviour|define behavior|permit|forbid)\b/.test(lower)) {
      return { type: "covenant", detail: lower };
    }

    // Explain
    if (/\b(what is|how does|how do|explain|tell me about|describe|help with)\b/.test(lower)) {
      return { type: "explain", detail: lower };
    }

    return { type: "unknown", detail: lower };
  }

  handleSetup(agent: AssistAgent, preset: AssistPreset, multiAgent: boolean): AssistResponse {
    const filesCreated: string[] = [];

    // Generate policy YAML
    const policyName = `${preset}-${agent}-policy`;
    const policyContent = generatePolicyYaml(preset, policyName, multiAgent);
    writeFileSync(this.policyPath, policyContent);
    filesCreated.push(this.policyPath);

    // Generate agent-specific files
    switch (agent) {
      case "claude-code": {
        const claudeDir = join(this.workDir, ".claude");
        const commandsDir = join(claudeDir, "commands");
        if (!existsSync(commandsDir)) mkdirSync(commandsDir, { recursive: true });

        writeFileSync(
          join(claudeDir, "settings.json"),
          JSON.stringify({ permissions: { "aep-governed": true, "policy-file": "./agent.policy.yaml" } }, null, 2) + "\n"
        );
        filesCreated.push(join(claudeDir, "settings.json"));

        writeFileSync(join(commandsDir, "aepassist.md"), generateClaudeCodeCommand());
        filesCreated.push(join(commandsDir, "aepassist.md"));

        writeFileSync(
          join(this.workDir, "CLAUDE.md"),
          generateClaudeMd()
        );
        filesCreated.push(join(this.workDir, "CLAUDE.md"));
        break;
      }

      case "cursor": {
        const cursorDir = join(this.workDir, ".cursor");
        const rulesDir = join(cursorDir, "rules");
        if (!existsSync(rulesDir)) mkdirSync(rulesDir, { recursive: true });

        writeFileSync(
          join(cursorDir, "mcp.json"),
          JSON.stringify({
            mcpServers: {
              aep: { command: "npx", args: ["aep", "proxy", "--policy", "./agent.policy.yaml"] },
            },
          }, null, 2) + "\n"
        );
        filesCreated.push(join(cursorDir, "mcp.json"));

        writeFileSync(join(rulesDir, "aepassist.mdc"), generateCursorRule());
        filesCreated.push(join(rulesDir, "aepassist.mdc"));
        break;
      }

      case "codex": {
        writeFileSync(
          join(this.workDir, "AGENTS.md"),
          `# AEP Governance\n\nThis project uses the Agent Element Protocol for governed agent interactions.\n\n${generateCodexAgentSection()}`
        );
        filesCreated.push(join(this.workDir, "AGENTS.md"));
        break;
      }
    }

    return {
      message: `AEP governance activated with ${preset} preset for ${agent}.\n\nTrust: ${getPreset(preset).trust.initial_score}/1000\nRing: ${getPreset(preset).ring.default}\nDrift tracking: ${getPreset(preset).intent.tracking ? "on" : "off"}\nStreaming validation: ${getPreset(preset).streaming.enabled ? "on" : "off"}\n\nPolicy written to ${this.policyPath}\nType /aepassist to check status or change settings.`,
      filesCreated,
    };
  }

  handleStatus(): AssistResponse {
    if (!this.isGovernanceActive()) {
      return { message: "No governance active. Run setup to configure AEP." };
    }

    try {
      const policy = loadPolicy(this.policyPath);
      const status = this.buildStatus(policy);

      let msg = `AEP Governance Status\n\n`;
      msg += `Policy: ${policy.name} (v${policy.version})\n`;
      if (policy.trust) {
        msg += `Trust: ${policy.trust.initial_score ?? 500}/1000 (erosion: ${policy.trust.decay_rate ?? 5}/hr)\n`;
      }
      if (policy.ring) {
        msg += `Ring: ${policy.ring.default ?? 2}\n`;
      }
      if (policy.intent?.tracking) {
        msg += `Drift: tracking on (threshold: ${policy.intent.drift_threshold}, warmup: ${policy.intent.warmup_actions} actions, on drift: ${policy.intent.on_drift})\n`;
      } else {
        msg += `Drift: tracking off\n`;
      }
      msg += `Capabilities: ${policy.capabilities.length}\n`;
      msg += `Forbidden patterns: ${policy.forbidden.length}\n`;
      msg += `Gates: ${policy.gates.length}\n`;
      msg += `Session limit: ${policy.session.max_actions} actions\n`;
      if (policy.system) {
        msg += `System limit: ${policy.system.max_actions_per_minute}/min across all sessions\n`;
      }
      if (policy.streaming?.enabled) {
        msg += `Streaming validation: on (abort on violation: ${policy.streaming.abort_on_violation})\n`;
      }
      if (policy.quantum?.enabled) {
        msg += `Post-quantum signatures: on\n`;
      }
      if (policy.decomposition?.enabled) {
        msg += `Task decomposition: on (max depth: ${policy.decomposition.max_depth})\n`;
      }
      if (policy.identity?.require_agent_identity) {
        msg += `Agent identity: required\n`;
      }

      msg += `\nAvailable actions: status, settings, explain, report, proof, tasks, identity, covenant, emergency`;

      return { message: msg };
    } catch (err) {
      return {
        message: "Failed to read policy.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  handleExplain(query: string): AssistResponse {
    const topic = findBestMatch(query);
    if (!topic) {
      const topics = getAvailableTopics();
      return {
        message: `No matching topic found. Available topics:\n${topics.map(t => `  - ${t}`).join("\n")}`,
      };
    }
    const explanation = getExplanation(topic);
    return { message: explanation ?? "No explanation available." };
  }

  handleSettingsChange(description: string): AssistResponse {
    if (!this.isGovernanceActive()) {
      return { message: "No governance active. Run setup first." };
    }

    try {
      const content = readFileSync(this.policyPath, "utf-8");
      let modified = content;

      const lower = description.toLowerCase();

      // Handle common settings changes
      if (/enable streaming/.test(lower)) {
        if (!modified.includes("streaming:")) {
          modified += "\nstreaming:\n  enabled: true\n  abort_on_violation: true\n";
        } else {
          modified = modified.replace(/enabled:\s*false/, "enabled: true");
        }
      } else if (/disable streaming/.test(lower)) {
        modified = modified.replace(/streaming:[\s\S]*?(?=\n\w|\n$|$)/, "streaming:\n  enabled: false\n  abort_on_violation: false\n");
      } else if (/enable drift|turn on drift/.test(lower)) {
        modified = modified.replace(/tracking:\s*false/, "tracking: true");
      } else if (/disable drift|turn off drift/.test(lower)) {
        modified = modified.replace(/tracking:\s*true/, "tracking: false");
      } else if (/make it strict/.test(lower)) {
        const newContent = generatePolicyYaml("strict", "strict-policy", false);
        modified = newContent;
      } else if (/make it relaxed/.test(lower)) {
        const newContent = generatePolicyYaml("relaxed", "relaxed-policy", false);
        modified = newContent;
      } else if (/enable quantum/.test(lower)) {
        if (!modified.includes("quantum:")) {
          modified += "\nquantum:\n  enabled: true\n";
        } else {
          modified = modified.replace(/enabled:\s*false/, "enabled: true");
        }
      } else if (/enable decomposition|enable task/.test(lower)) {
        if (!modified.includes("decomposition:")) {
          modified += "\ndecomposition:\n  enabled: true\n  max_depth: 5\n  max_children: 10\n  scope_inheritance: intersection\n  completion_gate: true\n";
        }
      } else {
        return { message: `Setting change not recognised: "${description}". Try: enable/disable streaming, enable/disable drift, make it strict, make it relaxed, enable quantum, enable decomposition.` };
      }

      writeFileSync(this.policyPath, modified);
      return {
        message: `Settings updated. Change applied to ${this.policyPath}.`,
        filesModified: [this.policyPath],
      };
    } catch (err) {
      return {
        message: "Failed to update settings.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  handleEmergency(withRollback: boolean): AssistResponse {
    if (this.gateway) {
      const killSwitch = this.gateway.getKillSwitch();
      const result = killSwitch.killAll("emergency", { rollback: withRollback });
      return {
        message: `Kill switch activated. ${result.sessionsTerminated} session(s) terminated.${withRollback ? " Rollback executed." : ""} All affected agents set to trust score 0.`,
      };
    }
    return {
      message: "Kill switch requires an active gateway instance. Use the CLI: npx aep kill --all" + (withRollback ? " --rollback" : ""),
    };
  }

  handleReport(format: string): AssistResponse {
    return {
      message: `Generate a report with: npx aep report <ledger-file> --format ${format}\n\nSupported formats: text, json, csv, html`,
    };
  }

  handleProof(): AssistResponse {
    return {
      message: `Proof bundle operations:\n\n  Generate: Use AgentGateway.generateProofBundle(sessionId, privateKey) programmatically.\n  Verify: npx aep bundle verify <bundle-file>\n  Verify with ledger: npx aep bundle verify <bundle-file> --ledger <ledger-file>`,
    };
  }

  handleTasks(): AssistResponse {
    return {
      message: `Task decomposition operations:\n\n  View tree: npx aep tasks <session-id> --tree\n  List tasks: npx aep tasks <session-id>\n\nTask decomposition must be enabled in policy (decomposition.enabled: true).`,
    };
  }

  handleIdentity(): AssistResponse {
    return {
      message: `Agent identity operations:\n\n  Create: npx aep identity create --name <name>\n  Verify: npx aep identity verify <identity-file>\n\nIdentity uses Ed25519 key pairs. The identity type is unified - it serves as agent card, capability advertisement and handshake credential.`,
    };
  }

  handleCovenant(): AssistResponse {
    return {
      message: `Covenant operations:\n\n  Parse: npx aep covenant parse <covenant-file>\n  Verify: npx aep covenant verify <covenant-file> <action>\n\nCovenant DSL uses three keywords:\n  permit <action> (conditions);\n  forbid <action> (conditions);\n  require <condition>;\n\nForbid always wins over permit. Unmatched actions are denied by default.`,
    };
  }

  process(input: string): AssistResponse {
    const intent = this.detectIntent(input);

    switch (intent.type) {
      case "setup":
        return {
          message: "Setup requires three answers:\n  1. Which agent ? (claude-code / cursor / codex)\n  2. Which preset ? (strict / standard / relaxed / audit)\n  3. Multiple agents ? (yes / no)\n\nCall handleSetup(agent, preset, multiAgent) with your choices.",
        };

      case "status":
        return this.handleStatus();

      case "settings":
        return this.handleSettingsChange(intent.detail ?? "");

      case "explain":
        return this.handleExplain(intent.detail ?? "");

      case "emergency":
        return {
          message: "Confirm emergency kill switch activation.\n  Kill all sessions: handleEmergency(false)\n  Kill all with rollback: handleEmergency(true)",
        };

      case "report":
        return this.handleReport("text");

      case "proof":
        return this.handleProof();

      case "tasks":
        return this.handleTasks();

      case "identity":
        return this.handleIdentity();

      case "covenant":
        return this.handleCovenant();

      default:
        return {
          message: "Available commands: setup, status, settings, explain, report, proof, tasks, identity, covenant, emergency.\n\nAsk about any AEP feature or type a command.",
        };
    }
  }

  private buildStatus(policy: Policy): AssistStatus {
    return {
      active: true,
      actionsAllowed: 0,
      actionsDenied: 0,
      actionsGated: 0,
      ledgerEntries: 0,
      chainValid: true,
    };
  }
}

function generateClaudeMd(): string {
  return `# AEP Governance

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
`;
}
