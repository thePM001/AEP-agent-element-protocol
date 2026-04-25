import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AEPassistant } from "../../src/aepassist/assistant.js";
import { AgentGateway } from "../../src/gateway.js";

const TEST_DIR = join(process.cwd(), ".test-aepassist-" + Date.now());
const LEDGER_DIR = join(TEST_DIR, "ledgers");

function makeGateway(): AgentGateway {
  return new AgentGateway({ ledgerDir: LEDGER_DIR });
}

describe("AEPassistant", () => {
  beforeEach(() => {
    mkdirSync(LEDGER_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("help / menu", () => {
    it("returns help menu for empty input", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("");
      expect(r.mode).toBe("help");
      expect(r.message).toContain("AEP Assistant");
      expect(r.actions).toBeDefined();
      expect(r.actions!.length).toBeGreaterThan(0);
    });

    it("returns help for /aepassist bare", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("/aepassist");
      expect(r.mode).toBe("help");
    });

    it("returns help for numeric 8", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("8");
      expect(r.mode).toBe("help");
    });

    it("flags unrecognised input", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("gibberish");
      expect(r.mode).toBe("help");
      expect(r.message).toContain("Unrecognised");
    });
  });

  describe("setup", () => {
    it("phase 1: asks for project type when no args", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("setup");
      expect(r.mode).toBe("setup");
      expect(r.prompt).toContain("project");
      expect(r.actions).toContain("ui");
      expect(r.actions).toContain("api");
    });

    it("rejects invalid project type", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("setup banana");
      expect(r.mode).toBe("setup");
      expect(r.message).toContain("Invalid project type");
    });

    it("phase 2: asks for preset when project type given", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("setup api");
      expect(r.mode).toBe("setup");
      expect(r.prompt).toContain("preset");
      expect(r.actions).toContain("strict");
    });

    it("rejects invalid preset", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("setup api banana");
      expect(r.mode).toBe("setup");
      expect(r.message).toContain("Invalid preset");
    });

    it("phase 3: asks about trust scoring", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("setup api standard");
      expect(r.mode).toBe("setup");
      expect(r.prompt).toContain("trust");
      expect(r.actions).toContain("yes");
    });

    it("completes full setup with trust enabled", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("setup ui strict yes");
      expect(r.mode).toBe("setup");
      expect(r.message).toContain("Setup complete");
      expect(r.message).toContain("ui");
      expect(r.message).toContain("strict");
      expect(r.message).toContain("enabled");

      const policyPath = join(TEST_DIR, ".aep", "policy.yaml");
      expect(existsSync(policyPath)).toBe(true);
    });

    it("completes full setup with trust disabled", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("setup workflow relaxed no");
      expect(r.mode).toBe("setup");
      expect(r.message).toContain("disabled");
    });

    it("creates .aep directory structure", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      a.handle("setup infrastructure standard yes");
      expect(existsSync(join(TEST_DIR, ".aep"))).toBe(true);
      expect(existsSync(join(TEST_DIR, ".aep", "covenants"))).toBe(true);
      expect(existsSync(join(TEST_DIR, ".aep", "reports"))).toBe(true);
    });

    it("works via numeric shortcut", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("1 api standard yes");
      expect(r.mode).toBe("setup");
      expect(r.message).toContain("Setup complete");
    });
  });

  describe("status", () => {
    it("reports no governance when no policy exists", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("status");
      expect(r.mode).toBe("status");
      expect(r.message).toContain("No governance active");
    });

    it("reports governance status when policy exists", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      a.handle("setup api standard yes");
      const r = a.handle("status");
      expect(r.mode).toBe("status");
      expect(r.message).toContain("AEP Governance Status");
      expect(r.message).toContain("Trust:");
      expect(r.message).toContain("Ring:");
    });
  });

  describe("preset", () => {
    it("asks for preset when none specified", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("preset");
      expect(r.mode).toBe("preset");
      expect(r.prompt).toContain("preset");
    });

    it("rejects invalid preset name", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("preset banana");
      expect(r.mode).toBe("preset");
      expect(r.message).toContain("Invalid preset");
    });

    it("switches to strict preset", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("preset strict");
      expect(r.mode).toBe("preset");
      expect(r.message).toContain("strict");
      expect(r.message).toContain("Policy written");
    });

    it("switches to audit preset", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("preset audit");
      expect(r.message).toContain("audit");
    });
  });

  describe("emergency", () => {
    it("shows emergency menu when no action specified", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("emergency");
      expect(r.mode).toBe("emergency");
      expect(r.actions).toContain("kill");
      expect(r.actions).toContain("pause");
    });

    it("kills all sessions", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("emergency kill");
      expect(r.mode).toBe("emergency");
      expect(r.message).toContain("Kill switch activated");
    });

    it("kills with rollback", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("emergency kill-rollback");
      expect(r.message).toContain("rollback");
    });

    it("pauses sessions", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("emergency pause");
      expect(r.message).toContain("paused");
    });

    it("resumes sessions", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("emergency resume");
      expect(r.message).toContain("resumed");
    });

    it("rejects unknown emergency action", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("emergency explode");
      expect(r.message).toContain("Unknown emergency action");
    });

    it("works via kill shortcut", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("kill");
      expect(r.mode).toBe("emergency");
      expect(r.message).toContain("Kill switch activated");
    });

    it("works via pause shortcut", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("pause");
      expect(r.mode).toBe("emergency");
    });
  });

  describe("covenant", () => {
    it("shows covenant menu when no action", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("covenant");
      expect(r.mode).toBe("covenant");
      expect(r.actions).toContain("list");
      expect(r.actions).toContain("create");
    });

    it("lists covenants when none exist", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      a.handle("setup api standard yes");
      const r = a.handle("covenant list");
      expect(r.message).toContain("No covenants defined");
    });

    it("lists covenants when directory missing", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("covenant list");
      expect(r.message).toContain("No covenants directory");
    });

    it("prompts for name when creating without one", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("covenant create");
      expect(r.prompt).toContain("covenant name");
    });

    it("prompts for rules when creating with name only", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("covenant create mytest");
      expect(r.message).toContain("Creating covenant");
    });

    it("creates a covenant file with rules", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("covenant create safety permit file:read;");
      expect(r.message).toContain("written");

      const filePath = join(TEST_DIR, ".aep", "covenants", "safety.covenant");
      expect(existsSync(filePath)).toBe(true);
    });

    it("views a covenant that exists", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      a.handle("covenant create mytest permit file:read;");
      const r = a.handle("covenant view mytest");
      expect(r.message).toContain("mytest");
    });

    it("reports not found for nonexistent covenant", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      mkdirSync(join(TEST_DIR, ".aep", "covenants"), { recursive: true });
      const r = a.handle("covenant view nope");
      expect(r.message).toContain("not found");
    });

    it("rejects unknown covenant action", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("covenant destroy");
      expect(r.message).toContain("Unknown covenant action");
    });
  });

  describe("identity", () => {
    it("shows identity menu when no action", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("identity");
      expect(r.mode).toBe("identity");
      expect(r.actions).toContain("show");
      expect(r.actions).toContain("create");
    });

    it("reports no identity when none exists", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("identity show");
      expect(r.message).toContain("No identity found");
    });

    it("creates an identity with Ed25519 keypair", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("identity create");
      expect(r.mode).toBe("identity");
      expect(r.message).toContain("Identity created");
      expect(r.message).toContain("Agent ID:");

      const idPath = join(TEST_DIR, ".aep", "identity.json");
      expect(existsSync(idPath)).toBe(true);

      const keyPath = join(TEST_DIR, ".aep", "identity.key");
      expect(existsSync(keyPath)).toBe(true);
    });

    it("shows an identity after creation", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      a.handle("identity create");
      const r = a.handle("identity show");
      expect(r.message).toContain("Agent Identity");
      expect(r.message).toContain("Public key:");
    });

    it("exports identity as JSON", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      a.handle("identity create");
      const r = a.handle("identity export");
      expect(r.message).toContain("Identity JSON:");
    });

    it("reports no identity to export when none exists", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("identity export");
      expect(r.message).toContain("No identity to export");
    });

    it("rejects unknown identity action", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("identity destroy");
      expect(r.message).toContain("Unknown identity action");
    });
  });

  describe("report", () => {
    it("asks for format when none specified", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("report");
      expect(r.mode).toBe("report");
      expect(r.actions).toContain("json");
      expect(r.actions).toContain("csv");
      expect(r.actions).toContain("html");
    });

    it("rejects invalid format", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("report xml");
      expect(r.message).toContain("Invalid format");
    });

    it("generates JSON report", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("report json");
      expect(r.message).toContain("Report written");
      expect(r.message).toContain(".json");

      const reportsDir = join(TEST_DIR, ".aep", "reports");
      expect(existsSync(reportsDir)).toBe(true);
    });

    it("generates CSV report", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("report csv");
      expect(r.message).toContain(".csv");
    });

    it("generates HTML report", () => {
      const a = new AEPassistant(makeGateway(), TEST_DIR);
      const r = a.handle("report html");
      expect(r.message).toContain(".html");
    });
  });

  describe("MCP tool integration", () => {
    it("handles aepassist tool call via proxy", async () => {
      const { AEPProxyServer } = await import("../../src/proxy/mcp-proxy.js");
      const { loadPolicy } = await import("../../src/policy/loader.js");

      // Create a minimal policy file
      const policyPath = join(TEST_DIR, "policy.yaml");
      writeFileSync(policyPath, `version: "2.2"
name: "test"
capabilities: []
limits: {}
gates: []
forbidden: []
session:
  max_actions: 10
  rate_limit:
    max_per_minute: 30
  escalation: []
evidence:
  enabled: true
  dir: "${LEDGER_DIR}"
`);
      const policy = loadPolicy(policyPath);
      const proxy = new AEPProxyServer({
        policy,
        backends: [],
        ledgerDir: LEDGER_DIR,
      });
      proxy.start({ source: "test" });

      const result = await proxy.handleToolCall({
        name: "aepassist",
        arguments: { input: "help" },
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBeDefined();
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.mode).toBe("help");
      expect(parsed.message).toContain("AEP Assistant");

      proxy.stop("test done");
    });
  });
});
