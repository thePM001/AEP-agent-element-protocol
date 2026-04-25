import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AEPAssistant } from "../../src/assist/assistant.js";
import { getPreset, getPresetNames, generatePolicyYaml } from "../../src/assist/presets.js";
import { getExplanation, findBestMatch, getAvailableTopics } from "../../src/assist/explanations.js";
import { generateClaudeCodeCommand, generateCursorRule, generateCodexAgentSection } from "../../src/assist/slash-commands.js";

const TEST_DIR = join(process.cwd(), ".test-assist-" + Date.now());

describe("AEP Assistant", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("presets", () => {
    it("returns all four preset names", () => {
      const names = getPresetNames();
      expect(names).toEqual(["strict", "standard", "relaxed", "audit"]);
    });

    it("strict preset has low initial trust", () => {
      const p = getPreset("strict");
      expect(p.trust.initial_score).toBe(200);
      expect(p.ring.default).toBe(2);
      expect(p.intent.on_drift).toBe("deny");
      expect(p.quantum.enabled).toBe(true);
      expect(p.streaming.enabled).toBe(true);
    });

    it("standard preset has moderate trust", () => {
      const p = getPreset("standard");
      expect(p.trust.initial_score).toBe(500);
      expect(p.intent.on_drift).toBe("warn");
    });

    it("relaxed preset has high trust and Ring 1", () => {
      const p = getPreset("relaxed");
      expect(p.trust.initial_score).toBe(600);
      expect(p.ring.default).toBe(1);
      expect(p.intent.tracking).toBe(false);
    });

    it("audit preset is Ring 3 read-only", () => {
      const p = getPreset("audit");
      expect(p.ring.default).toBe(3);
      expect(p.session.auto_bundle).toBe(true);
    });

    it("generates valid policy YAML for each preset", () => {
      for (const name of getPresetNames()) {
        const yaml = generatePolicyYaml(name, `test-${name}`, false);
        expect(yaml).toContain('version: "2.2"');
        expect(yaml).toContain(`name: "test-${name}"`);
        expect(yaml).toContain("capabilities:");
        expect(yaml).toContain("session:");
        expect(yaml).toContain("trust:");
      }
    });

    it("multi-agent policy includes identity config", () => {
      const yaml = generatePolicyYaml("standard", "multi", true);
      expect(yaml).toContain("identity:");
      expect(yaml).toContain("require_agent_identity: true");
    });
  });

  describe("setup", () => {
    it("generates claude-code files", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleSetup("claude-code", "standard", false);
      expect(result.filesCreated).toBeDefined();
      expect(result.filesCreated!.length).toBeGreaterThanOrEqual(3);
      expect(existsSync(join(TEST_DIR, "agent.policy.yaml"))).toBe(true);
      expect(existsSync(join(TEST_DIR, ".claude", "settings.json"))).toBe(true);
      expect(existsSync(join(TEST_DIR, ".claude", "commands", "aepassist.md"))).toBe(true);
      expect(existsSync(join(TEST_DIR, "CLAUDE.md"))).toBe(true);
    });

    it("generates cursor files", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleSetup("cursor", "relaxed", false);
      expect(result.filesCreated).toBeDefined();
      expect(existsSync(join(TEST_DIR, "agent.policy.yaml"))).toBe(true);
      expect(existsSync(join(TEST_DIR, ".cursor", "mcp.json"))).toBe(true);
      expect(existsSync(join(TEST_DIR, ".cursor", "rules", "aepassist.mdc"))).toBe(true);
    });

    it("generates codex files", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleSetup("codex", "audit", false);
      expect(result.filesCreated).toBeDefined();
      expect(existsSync(join(TEST_DIR, "agent.policy.yaml"))).toBe(true);
      expect(existsSync(join(TEST_DIR, "AGENTS.md"))).toBe(true);
    });

    it("strict preset policy has low trust and deny drift", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      assistant.handleSetup("claude-code", "strict", false);
      const content = readFileSync(join(TEST_DIR, "agent.policy.yaml"), "utf-8");
      expect(content).toContain("initial_score: 200");
      expect(content).toContain("on_drift: deny");
    });
  });

  describe("status", () => {
    it("reports no governance when policy missing", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleStatus();
      expect(result.message).toContain("No governance active");
    });

    it("reports governance status when policy exists", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      assistant.handleSetup("claude-code", "standard", false);
      const result = assistant.handleStatus();
      expect(result.message).toContain("AEP Governance Status");
      expect(result.message).toContain("Trust:");
      expect(result.message).toContain("Ring:");
    });
  });

  describe("intent detection", () => {
    it("detects setup intent", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      expect(assistant.detectIntent("setup governance").type).toBe("setup");
      expect(assistant.detectIntent("initialize AEP").type).toBe("setup");
    });

    it("detects status intent", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      // Need active governance for status detection
      assistant.handleSetup("claude-code", "standard", false);
      expect(assistant.detectIntent("show status").type).toBe("status");
      expect(assistant.detectIntent("check current state").type).toBe("status");
    });

    it("detects emergency intent", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      expect(assistant.detectIntent("kill everything").type).toBe("emergency");
      expect(assistant.detectIntent("stop everything now").type).toBe("emergency");
    });

    it("detects settings intent", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      assistant.handleSetup("claude-code", "standard", false);
      expect(assistant.detectIntent("enable streaming validation").type).toBe("settings");
      expect(assistant.detectIntent("turn off drift detection").type).toBe("settings");
    });

    it("detects explain intent", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      assistant.handleSetup("claude-code", "standard", false);
      expect(assistant.detectIntent("what is streaming validation").type).toBe("explain");
      expect(assistant.detectIntent("explain how trust works").type).toBe("explain");
    });

    it("detects report intent", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      assistant.handleSetup("claude-code", "standard", false);
      expect(assistant.detectIntent("generate report").type).toBe("report");
      expect(assistant.detectIntent("compliance export").type).toBe("report");
    });

    it("detects proof intent", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      assistant.handleSetup("claude-code", "standard", false);
      expect(assistant.detectIntent("generate proof bundle").type).toBe("proof");
    });

    it("detects covenant intent", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      assistant.handleSetup("claude-code", "standard", false);
      expect(assistant.detectIntent("create covenant").type).toBe("covenant");
    });

    it("detects identity intent", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      assistant.handleSetup("claude-code", "standard", false);
      expect(assistant.detectIntent("create identity").type).toBe("identity");
    });

    it("returns setup when no governance active and unknown input", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      expect(assistant.detectIntent("hello").type).toBe("setup");
    });
  });

  describe("explanations", () => {
    it("has explanations for all major topics", () => {
      const topics = getAvailableTopics();
      expect(topics.length).toBeGreaterThanOrEqual(15);
      for (const topic of topics) {
        const explanation = getExplanation(topic);
        expect(explanation).toBeTruthy();
        expect(explanation!.length).toBeGreaterThan(50);
      }
    });

    it("findBestMatch works for partial queries", () => {
      expect(findBestMatch("trust score")).toBe("trust");
      expect(findBestMatch("execution ring")).toBe("rings");
      expect(findBestMatch("covenant rules")).toBe("covenants");
      expect(findBestMatch("drift detection")).toBe("drift");
    });

    it("findBestMatch returns null for unknown topics", () => {
      expect(findBestMatch("xyzzy")).toBeNull();
    });
  });

  describe("settings changes", () => {
    it("enables streaming validation", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      assistant.handleSetup("claude-code", "relaxed", false);
      const result = assistant.handleSettingsChange("enable streaming");
      expect(result.message).toContain("Settings updated");
      const content = readFileSync(join(TEST_DIR, "agent.policy.yaml"), "utf-8");
      expect(content).toContain("streaming:");
    });

    it("rejects unrecognised settings", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      assistant.handleSetup("claude-code", "standard", false);
      const result = assistant.handleSettingsChange("enable warp drive");
      expect(result.message).toContain("not recognised");
    });

    it("reports no governance when policy missing", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleSettingsChange("enable streaming");
      expect(result.message).toContain("No governance active");
    });
  });

  describe("slash commands", () => {
    it("generates Claude Code command file", () => {
      const content = generateClaudeCodeCommand();
      expect(content).toContain("/aepassist");
      expect(content).toContain("AEP");
      expect(content.length).toBeGreaterThan(100);
    });

    it("generates Cursor rule file", () => {
      const content = generateCursorRule();
      expect(content).toContain("/aepassist");
      expect(content).toContain("AEP");
    });

    it("generates Codex agent section", () => {
      const content = generateCodexAgentSection();
      expect(content).toContain("/aepassist");
      expect(content).toContain("AEP");
    });
  });

  describe("emergency", () => {
    it("returns CLI guidance without gateway", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleEmergency(false);
      expect(result.message).toContain("npx aep kill");
    });

    it("includes rollback flag when requested", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleEmergency(true);
      expect(result.message).toContain("--rollback");
    });
  });

  describe("report guidance", () => {
    it("returns CLI command for report generation", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleReport("json");
      expect(result.message).toContain("npx aep report");
      expect(result.message).toContain("--format json");
    });

    it("lists supported formats", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleReport("text");
      expect(result.message).toContain("text");
      expect(result.message).toContain("json");
      expect(result.message).toContain("csv");
      expect(result.message).toContain("html");
    });
  });

  describe("proof bundle guidance", () => {
    it("returns proof bundle operations", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleProof();
      expect(result.message).toContain("Proof bundle");
      expect(result.message).toContain("generateProofBundle");
      expect(result.message).toContain("verify");
    });
  });

  describe("task tree guidance", () => {
    it("returns task decomposition operations", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleTasks();
      expect(result.message).toContain("Task decomposition");
      expect(result.message).toContain("--tree");
      expect(result.message).toContain("decomposition");
    });
  });

  describe("identity guidance", () => {
    it("returns identity operations", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleIdentity();
      expect(result.message).toContain("Agent identity");
      expect(result.message).toContain("Ed25519");
      expect(result.message).toContain("create");
      expect(result.message).toContain("verify");
    });
  });

  describe("covenant guidance", () => {
    it("returns covenant operations", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleCovenant();
      expect(result.message).toContain("Covenant");
      expect(result.message).toContain("permit");
      expect(result.message).toContain("forbid");
      expect(result.message).toContain("require");
    });

    it("explains forbid-wins-over-permit rule", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      const result = assistant.handleCovenant();
      expect(result.message).toContain("Forbid always wins over permit");
    });
  });

  describe("process", () => {
    it("handles unknown input gracefully", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      assistant.handleSetup("claude-code", "standard", false);
      const result = assistant.process("random unrelated text");
      expect(result.message).toContain("Available commands");
    });

    it("routes explain queries correctly", () => {
      const assistant = new AEPAssistant({ workDir: TEST_DIR });
      assistant.handleSetup("claude-code", "standard", false);
      const result = assistant.process("what is trust scoring");
      expect(result.message).toContain("Trust");
      expect(result.message).toContain("0-1000");
    });
  });
});
