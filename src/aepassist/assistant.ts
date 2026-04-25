// /aepassist interactive assistant
// Invoked via /aepassist in Claude Code, Cursor or any MCP-connected agent

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AgentGateway } from "../gateway.js";
import { loadPolicy } from "../policy/loader.js";
import { generatePolicyYaml, getPreset } from "../assist/presets.js";
import { AgentIdentityManager } from "../identity/manager.js";
import { generateKeyPairSync } from "node:crypto";
import { parseAEPassistInput } from "./parser.js";
import type {
  AEPassistResponse,
  ProjectType,
  GovernancePreset,
  EmergencyAction,
  ReportFormat,
} from "./types.js";

const MAIN_MENU = `AEP Assistant - What would you like to do?

  1. setup      First-time project setup (3 questions)
  2. status     Show current governance status
  3. preset     Switch governance preset
  4. emergency  Kill switch and rollback controls
  5. covenant   Create or view covenants
  6. identity   Manage agent identity
  7. report     Generate audit report
  8. help       Show this menu`;

const PROJECT_TYPES: ProjectType[] = ["ui", "api", "workflow", "infrastructure"];
const PRESETS: GovernancePreset[] = ["strict", "standard", "relaxed", "audit"];

export class AEPassistant {
  private gateway: AgentGateway;
  private workDir: string;

  constructor(gateway: AgentGateway, workDir?: string) {
    this.gateway = gateway;
    this.workDir = workDir ?? process.cwd();
  }

  handle(input: string): AEPassistResponse {
    const parsed = parseAEPassistInput(input);

    switch (parsed.mode) {
      case "setup":
        return this.handleSetup(parsed.args);
      case "status":
        return this.handleStatus();
      case "preset":
        return this.handlePreset(parsed.args[0]);
      case "emergency":
        return this.handleEmergency(parsed.args[0] as EmergencyAction | undefined);
      case "covenant":
        return this.handleCovenant(parsed.args[0] as CovenantAction | undefined, parsed.args.slice(1));
      case "identity":
        return this.handleIdentity(parsed.args[0] as IdentityAction | undefined);
      case "report":
        return this.handleReport(parsed.args[0] as ReportFormat | undefined);
      case "help":
      default:
        return this.showMenu(parsed.args[0]);
    }
  }

  private showMenu(unknownInput?: string): AEPassistResponse {
    let message = MAIN_MENU;
    if (unknownInput) {
      message = `Unrecognised command: "${unknownInput}"\n\n${MAIN_MENU}`;
    }
    return {
      mode: "help",
      message,
      actions: ["setup", "status", "preset", "emergency", "covenant", "identity", "report"],
    };
  }

  handleSetup(args: string[]): AEPassistResponse {
    // Phase 1: ask project type
    if (args.length === 0) {
      return {
        mode: "setup",
        message: "First-time project setup.",
        prompt: "What type of project? (ui / api / workflow / infrastructure)",
        actions: PROJECT_TYPES,
      };
    }

    const projectType = args[0].toLowerCase();
    if (!PROJECT_TYPES.includes(projectType as ProjectType)) {
      return {
        mode: "setup",
        message: `Invalid project type: "${args[0]}". Choose: ui, api, workflow or infrastructure.`,
        prompt: "What type of project? (ui / api / workflow / infrastructure)",
        actions: PROJECT_TYPES,
      };
    }

    // Phase 2: ask governance preset
    if (args.length === 1) {
      return {
        mode: "setup",
        message: `Project type: ${projectType}.`,
        prompt: "Which governance preset? (strict / standard / relaxed / audit)",
        actions: PRESETS,
      };
    }

    const preset = args[1].toLowerCase();
    if (!PRESETS.includes(preset as GovernancePreset)) {
      return {
        mode: "setup",
        message: `Invalid preset: "${args[1]}". Choose: strict, standard, relaxed or audit.`,
        prompt: "Which governance preset? (strict / standard / relaxed / audit)",
        actions: PRESETS,
      };
    }

    // Phase 3: ask trust scoring
    if (args.length === 2) {
      return {
        mode: "setup",
        message: `Project type: ${projectType}. Preset: ${preset}.`,
        prompt: "Enable trust scoring? (yes / no)",
        actions: ["yes", "no"],
      };
    }

    const trustAnswer = args[2].toLowerCase();
    const enableTrust = trustAnswer === "yes" || trustAnswer === "y" || trustAnswer === "true";

    // Execute setup
    return this.executeSetup(projectType as ProjectType, preset as GovernancePreset, enableTrust);
  }

  private executeSetup(projectType: ProjectType, preset: GovernancePreset, enableTrust: boolean): AEPassistResponse {
    const aepDir = join(this.workDir, ".aep");
    if (!existsSync(aepDir)) {
      mkdirSync(aepDir, { recursive: true });
    }

    const policyName = `${projectType}-${preset}-policy`;
    let policyContent = generatePolicyYaml(preset, policyName, false);

    // Adjust trust based on user answer
    if (!enableTrust) {
      policyContent = policyContent.replace(
        /trust:\n\s+initial_score:\s*\d+\n\s+decay_rate:\s*\d+/,
        "trust:\n  initial_score: 500\n  decay_rate: 0"
      );
    }

    // Add project type comment
    policyContent = `# Project type: ${projectType}\n${policyContent}`;

    const policyPath = join(aepDir, "policy.yaml");
    writeFileSync(policyPath, policyContent);

    // Create covenants directory
    const covenantsDir = join(aepDir, "covenants");
    if (!existsSync(covenantsDir)) {
      mkdirSync(covenantsDir, { recursive: true });
    }

    // Create reports directory
    const reportsDir = join(aepDir, "reports");
    if (!existsSync(reportsDir)) {
      mkdirSync(reportsDir, { recursive: true });
    }

    const presetConfig = getPreset(preset);

    return {
      mode: "setup",
      message: `Setup complete. Policy written to .aep/policy.yaml

Project type: ${projectType}
Preset: ${preset}
Trust scoring: ${enableTrust ? "enabled" : "disabled (erosion rate 0)"}
Trust initial: ${presetConfig.trust.initial_score}/1000
Ring: ${presetConfig.ring.default}
Drift tracking: ${presetConfig.intent.tracking ? "on" : "off"}
Streaming validation: ${presetConfig.streaming.enabled ? "on" : "off"}`,
      actions: ["status", "preset", "covenant"],
    };
  }

  handleStatus(): AEPassistResponse {
    const policyPath = join(this.workDir, ".aep", "policy.yaml");

    if (!existsSync(policyPath)) {
      // Also check legacy location
      const legacyPath = join(this.workDir, "agent.policy.yaml");
      if (!existsSync(legacyPath)) {
        return {
          mode: "status",
          message: "No governance active. Run /aepassist setup to configure.",
          actions: ["setup"],
        };
      }
    }

    const activePath = existsSync(policyPath) ? policyPath : join(this.workDir, "agent.policy.yaml");

    try {
      const policy = loadPolicy(activePath);
      const sessions = this.gateway.listActiveSessions();
      const sessionCount = sessions.length;

      let totalAllowed = 0;
      let totalDenied = 0;
      let totalGated = 0;

      for (const s of sessions) {
        totalAllowed += s.stats.actionsAllowed;
        totalDenied += s.stats.actionsDenied;
        totalGated += s.stats.actionsGated;
      }

      const totalEvaluated = totalAllowed + totalDenied + totalGated;

      // Trust and ring from policy defaults
      const trustScore = policy.trust?.initial_score ?? 500;
      const trustTier = this.getTrustTier(trustScore);
      const ring = policy.ring?.default ?? 2;

      // Covenants
      const covenantsDir = join(this.workDir, ".aep", "covenants");
      let covenantCount = 0;
      if (existsSync(covenantsDir)) {
        covenantCount = readdirSync(covenantsDir).filter(f => f.endsWith(".covenant")).length;
      }

      // Scanner status
      const scannersEnabled = policy.scanners?.enabled ?? false;

      // Drift status
      const driftTracking = policy.intent?.tracking ?? false;

      const msg = `AEP Governance Status

Active sessions: ${sessionCount}
Total actions evaluated: ${totalEvaluated}
  Allowed: ${totalAllowed}
  Denied: ${totalDenied}
  Gated: ${totalGated}

Trust: ${trustScore}/1000 (${trustTier})
Ring: ${ring}

Active covenants: ${covenantCount}
Scanners: ${scannersEnabled ? "enabled" : "disabled"}
Drift tracking: ${driftTracking ? "on" : "off"}

Policy: ${activePath}`;

      return {
        mode: "status",
        message: msg,
        actions: ["preset", "emergency", "report"],
      };
    } catch (err) {
      return {
        mode: "status",
        message: `Failed to read policy: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  handlePreset(preset?: string): AEPassistResponse {
    if (!preset) {
      return {
        mode: "preset",
        message: "Switch governance preset.",
        prompt: "Which preset? (strict / standard / relaxed / audit)",
        actions: PRESETS,
      };
    }

    const lower = preset.toLowerCase();
    if (!PRESETS.includes(lower as GovernancePreset)) {
      return {
        mode: "preset",
        message: `Invalid preset: "${preset}". Choose: strict, standard, relaxed or audit.`,
        prompt: "Which preset? (strict / standard / relaxed / audit)",
        actions: PRESETS,
      };
    }

    const aepDir = join(this.workDir, ".aep");
    if (!existsSync(aepDir)) {
      mkdirSync(aepDir, { recursive: true });
    }

    const policyPath = join(aepDir, "policy.yaml");
    const policyName = `${lower}-policy`;
    const policyContent = generatePolicyYaml(lower as GovernancePreset, policyName, false);
    writeFileSync(policyPath, policyContent);

    const config = getPreset(lower as GovernancePreset);

    return {
      mode: "preset",
      message: `Switched to ${lower} preset.

Trust: ${config.trust.initial_score}/1000
Ring: ${config.ring.default}
Drift: ${config.intent.tracking ? `on (threshold: ${config.intent.drift_threshold})` : "off"}
Streaming: ${config.streaming.enabled ? "on" : "off"}
Quantum signatures: ${config.quantum.enabled ? "on" : "off"}

Policy written to .aep/policy.yaml`,
      actions: ["status"],
    };
  }

  handleEmergency(action?: string): AEPassistResponse {
    if (!action) {
      return {
        mode: "emergency",
        message: `Emergency controls:

  kill           Terminate all active sessions
  kill-rollback  Terminate all sessions with full rollback
  pause          Pause all active sessions
  resume         Resume paused sessions`,
        prompt: "Which emergency action? (kill / kill-rollback / pause / resume)",
        actions: ["kill", "kill-rollback", "pause", "resume"],
      };
    }

    const killSwitch = this.gateway.getKillSwitch();
    const sessions = this.gateway.listActiveSessions();

    switch (action) {
      case "kill": {
        const result = killSwitch.killAll("emergency", { rollback: false });
        return {
          mode: "emergency",
          message: `Kill switch activated. ${result.sessionsTerminated} session(s) terminated. All trust scores reset to 0.`,
        };
      }

      case "kill-rollback": {
        const result = killSwitch.killAll("emergency", { rollback: true });
        return {
          mode: "emergency",
          message: `Kill switch activated with rollback. ${result.sessionsTerminated} session(s) terminated and rolled back. All trust scores reset to 0.`,
        };
      }

      case "pause": {
        let paused = 0;
        for (const s of sessions) {
          if (s.state === "active") {
            s.pause();
            paused++;
          }
        }
        return {
          mode: "emergency",
          message: `${paused} session(s) paused.`,
          actions: ["resume"],
        };
      }

      case "resume": {
        let resumed = 0;
        for (const s of sessions) {
          if (s.state === "paused") {
            this.gateway.resumeSession(s.id);
            resumed++;
          }
        }
        return {
          mode: "emergency",
          message: `${resumed} session(s) resumed.`,
        };
      }

      default:
        return {
          mode: "emergency",
          message: `Unknown emergency action: "${action}". Use: kill, kill-rollback, pause or resume.`,
          actions: ["kill", "kill-rollback", "pause", "resume"],
        };
    }
  }

  handleCovenant(action?: string, extraArgs?: string[]): AEPassistResponse {
    const covenantsDir = join(this.workDir, ".aep", "covenants");

    if (!action) {
      return {
        mode: "covenant",
        message: `Covenant operations:

  list    Show active covenants
  create  Create a new covenant
  view    View a specific covenant`,
        prompt: "Which covenant action? (list / create / view <name>)",
        actions: ["list", "create", "view"],
      };
    }

    switch (action) {
      case "list": {
        if (!existsSync(covenantsDir)) {
          return {
            mode: "covenant",
            message: "No covenants directory found. Run setup first or create a covenant.",
            actions: ["create", "setup"],
          };
        }
        const files = readdirSync(covenantsDir).filter(f => f.endsWith(".covenant"));
        if (files.length === 0) {
          return {
            mode: "covenant",
            message: "No covenants defined. Create one with /aepassist covenant create.",
            actions: ["create"],
          };
        }
        const list = files.map(f => `  ${f.replace(".covenant", "")}`).join("\n");
        return {
          mode: "covenant",
          message: `Active covenants:\n\n${list}`,
          actions: ["view", "create"],
        };
      }

      case "create": {
        if (!extraArgs || extraArgs.length === 0) {
          return {
            mode: "covenant",
            message: "Create a new behavioural covenant.",
            prompt: "Enter covenant name:",
          };
        }

        const name = extraArgs[0];
        if (extraArgs.length === 1) {
          return {
            mode: "covenant",
            message: `Creating covenant: ${name}`,
            prompt: `Add rules (permit/forbid/require format, one per line, empty to finish).

Example:
  permit file:read (paths in ["src/**"]);
  forbid file:delete (paths in ["/"]);
  require trust_tier >= "standard";`,
          };
        }

        // Rules provided as remaining args
        const rules = extraArgs.slice(1).join(" ");
        if (!existsSync(covenantsDir)) {
          mkdirSync(covenantsDir, { recursive: true });
        }

        const covenantContent = `covenant ${name} {\n  ${rules}\n}\n`;
        const filePath = join(covenantsDir, `${name}.covenant`);
        writeFileSync(filePath, covenantContent);

        return {
          mode: "covenant",
          message: `Covenant "${name}" written to .aep/covenants/${name}.covenant`,
          actions: ["list", "view"],
        };
      }

      case "view": {
        const name = extraArgs?.[0];
        if (!name) {
          return {
            mode: "covenant",
            message: "Specify a covenant name.",
            prompt: "Which covenant to view?",
          };
        }

        const filePath = join(covenantsDir, `${name}.covenant`);
        if (!existsSync(filePath)) {
          return {
            mode: "covenant",
            message: `Covenant "${name}" not found in .aep/covenants/.`,
            actions: ["list"],
          };
        }

        const content = readFileSync(filePath, "utf-8");
        return {
          mode: "covenant",
          message: `Covenant: ${name}\n\n${content}`,
          actions: ["list", "create"],
        };
      }

      default:
        return {
          mode: "covenant",
          message: `Unknown covenant action: "${action}". Use: list, create or view.`,
          actions: ["list", "create", "view"],
        };
    }
  }

  handleIdentity(action?: string): AEPassistResponse {
    if (!action) {
      return {
        mode: "identity",
        message: `Identity operations:

  show    Display current agent identity
  create  Generate new Ed25519 keypair
  export  Export identity as JSON`,
        prompt: "Which identity action? (show / create / export)",
        actions: ["show", "create", "export"],
      };
    }

    switch (action) {
      case "show": {
        const idPath = join(this.workDir, ".aep", "identity.json");
        if (!existsSync(idPath)) {
          return {
            mode: "identity",
            message: "No identity found. Create one with /aepassist identity create.",
            actions: ["create"],
          };
        }

        try {
          const content = readFileSync(idPath, "utf-8");
          const identity = JSON.parse(content);
          return {
            mode: "identity",
            message: `Agent Identity

  Name: ${identity.name ?? "unnamed"}
  Agent ID: ${identity.agentId ?? "unknown"}
  Role: ${identity.role ?? "unknown"}
  Public key: ${identity.publicKey ? identity.publicKey.slice(0, 32) + "..." : "none"}
  Created: ${identity.createdAt ?? "unknown"}
  Expires: ${identity.expiresAt ?? "never"}
  Capabilities: ${Array.isArray(identity.capabilities) ? identity.capabilities.join(", ") : "none"}`,
            actions: ["export", "create"],
          };
        } catch {
          return {
            mode: "identity",
            message: "Failed to read identity file.",
            actions: ["create"],
          };
        }
      }

      case "create": {
        const aepDir = join(this.workDir, ".aep");
        if (!existsSync(aepDir)) {
          mkdirSync(aepDir, { recursive: true });
        }

        const { privateKey } = generateKeyPairSync("ed25519");
        const privPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

        const identity = AgentIdentityManager.create({
          name: "aep-agent",
          version: "1.0.0",
          operator: "local",
          description: "AEP governed agent",
          capabilities: ["file:read", "file:write", "command:run"],
          covenants: [],
          endpoints: [],
          maxTrustTier: "trusted",
          defaultRing: 2,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        }, privPem);

        const idPath = join(aepDir, "identity.json");
        writeFileSync(idPath, JSON.stringify(identity, null, 2) + "\n");

        // Also store private key separately
        const keyPath = join(aepDir, "identity.key");
        writeFileSync(keyPath, privPem, { mode: 0o600 });

        return {
          mode: "identity",
          message: `Identity created.

  Agent ID: ${identity.agentId}
  Public key: ${identity.publicKey.slice(0, 40)}...
  Written to .aep/identity.json
  Private key: .aep/identity.key`,
          actions: ["show", "export"],
        };
      }

      case "export": {
        const idPath = join(this.workDir, ".aep", "identity.json");
        if (!existsSync(idPath)) {
          return {
            mode: "identity",
            message: "No identity to export. Create one first.",
            actions: ["create"],
          };
        }

        const content = readFileSync(idPath, "utf-8");
        return {
          mode: "identity",
          message: `Identity JSON:\n\n${content}`,
          actions: ["show"],
        };
      }

      default:
        return {
          mode: "identity",
          message: `Unknown identity action: "${action}". Use: show, create or export.`,
          actions: ["show", "create", "export"],
        };
    }
  }

  handleReport(format?: string): AEPassistResponse {
    if (!format) {
      return {
        mode: "report",
        message: `Generate audit report.

Formats: json, csv, html`,
        prompt: "Which format? (json / csv / html)",
        actions: ["json", "csv", "html"],
      };
    }

    const validFormats: ReportFormat[] = ["json", "csv", "html"];
    const lower = format.toLowerCase() as ReportFormat;

    if (!validFormats.includes(lower)) {
      return {
        mode: "report",
        message: `Invalid format: "${format}". Choose: json, csv or html.`,
        prompt: "Which format? (json / csv / html)",
        actions: ["json", "csv", "html"],
      };
    }

    const reportsDir = join(this.workDir, ".aep", "reports");
    if (!existsSync(reportsDir)) {
      mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${timestamp}.${lower}`;
    const filePath = join(reportsDir, filename);

    // Collect session data
    const sessions = this.gateway.listActiveSessions();
    const reportData = this.buildReportData(sessions);

    switch (lower) {
      case "json": {
        writeFileSync(filePath, JSON.stringify(reportData, null, 2) + "\n");
        break;
      }

      case "csv": {
        const header = "session_id,state,actions_allowed,actions_denied,actions_gated,trust_score,ring\n";
        const rows = reportData.sessions
          .map(s => `${s.id},${s.state},${s.allowed},${s.denied},${s.gated},${s.trustScore},${s.ring}`)
          .join("\n");
        writeFileSync(filePath, header + rows + "\n");
        break;
      }

      case "html": {
        const rows = reportData.sessions
          .map(s => `<tr><td>${s.id}</td><td>${s.state}</td><td>${s.allowed}</td><td>${s.denied}</td><td>${s.gated}</td></tr>`)
          .join("\n");
        const html = `<!DOCTYPE html>
<html><head><title>AEP Audit Report</title>
<style>body{font-family:sans-serif;margin:2em}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}th{background:#f0f0f0}</style>
</head><body>
<h1>AEP Audit Report</h1>
<p>Generated: ${reportData.timestamp}</p>
<p>Total sessions: ${reportData.totalSessions}</p>
<table>
<tr><th>Session</th><th>State</th><th>Allowed</th><th>Denied</th><th>Gated</th></tr>
${rows}
</table>
</body></html>`;
        writeFileSync(filePath, html);
        break;
      }
    }

    return {
      mode: "report",
      message: `Report written to .aep/reports/${filename}`,
      actions: ["status"],
    };
  }

  private buildReportData(sessions: ReturnType<AgentGateway["listActiveSessions"]>) {
    const sessionData = sessions.map(s => ({
      id: s.id,
      state: s.state,
      allowed: s.stats.actionsAllowed,
      denied: s.stats.actionsDenied,
      gated: s.stats.actionsGated,
      trustScore: 500,
      ring: 2,
    }));

    return {
      timestamp: new Date().toISOString(),
      totalSessions: sessions.length,
      sessions: sessionData,
    };
  }

  private getTrustTier(score: number): string {
    if (score >= 800) return "privileged";
    if (score >= 600) return "trusted";
    if (score >= 400) return "standard";
    if (score >= 200) return "provisional";
    return "untrusted";
  }
}
