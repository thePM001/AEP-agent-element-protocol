import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AEPProxyServer } from "../../src/proxy/mcp-proxy.js";
import type { Policy } from "../../src/policy/types.js";

const TEST_DIR = join(
  import.meta.dirname ?? __dirname,
  "../../.test-proxy-ledgers"
);

function makePolicy(): Policy {
  return {
    version: "2.1",
    name: "proxy-test",
    capabilities: [
      { tool: "file:read", scope: { paths: ["src/**"] } },
      {
        tool: "aep:create_element",
        scope: {
          element_prefixes: ["CP", "PN"],
          z_bands: ["20-29", "10-19"],
        },
      },
    ],
    limits: { max_aep_mutations: 50 },
    gates: [],
    forbidden: [{ pattern: "\\.env", reason: "secrets" }],
    session: {
      max_actions: 50,
      rate_limit: { max_per_minute: 30 },
      escalation: [],
    },
    evidence: { enabled: true, dir: TEST_DIR },
  };
}

describe("AEPProxyServer", () => {
  let proxy: AEPProxyServer;

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    proxy = new AEPProxyServer({
      policy: makePolicy(),
      backends: [],
      ledgerDir: TEST_DIR,
    });
    proxy.start({ source: "test" });
  });

  afterEach(() => {
    proxy.stop();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("intercepts and allows valid tool calls", async () => {
    const result = await proxy.handleToolCall({
      name: "file:read",
      arguments: { path: "src/main.ts" },
    });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text ?? "";
    expect(text).toContain("forwarded");
  });

  it("blocks forbidden patterns", async () => {
    const result = await proxy.handleToolCall({
      name: "file:read",
      arguments: { path: ".env" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("denied");
  });

  it("blocks unconfigured tools", async () => {
    const result = await proxy.handleToolCall({
      name: "network:fetch",
      arguments: { url: "http://example.com" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("denied");
  });

  it("validates AEP elements on mutation", async () => {
    const result = await proxy.handleToolCall({
      name: "aep:create_element",
      arguments: {
        id: "CP-00010",
        type: "component",
        z: 25,
        parent: "PN-00001",
      },
    });
    expect(result.isError).toBeUndefined();
  });

  it("rejects AEP elements with wrong z-band", async () => {
    const result = await proxy.handleToolCall({
      name: "aep:create_element",
      arguments: {
        id: "CP-00010",
        type: "component",
        z: 50,
        parent: "PN-00001",
      },
    });
    expect(result.isError).toBe(true);
    // Policy denies before structural validation because z=50 is outside allowed bands [20-29, 10-19]
    expect(result.content[0].text).toContain("denied");
  });

  it("returns error when no session active", async () => {
    proxy.stop();
    const freshProxy = new AEPProxyServer({
      policy: makePolicy(),
      backends: [],
      ledgerDir: TEST_DIR,
    });
    const result = await freshProxy.handleToolCall({
      name: "file:read",
      arguments: { path: "src/main.ts" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No active session");
  });

  it("generates session report on stop", () => {
    const report = proxy.stop("test done");
    expect(report).not.toBeNull();
    expect(report?.terminationReason).toBe("test done");
  });
});
