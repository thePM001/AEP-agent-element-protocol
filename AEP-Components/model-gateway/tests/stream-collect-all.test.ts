import { afterEach, describe, it, expect } from "vitest";
import { rmSync } from "node:fs";
import { GovernedModelGateway } from "../lib/gateway.js";
import { ProviderRegistry } from "../lib/registry.js";
import { ScannerPipeline } from "../../scanners/lib/pipeline.js";
import type { Finding, Scanner } from "../../scanners/lib/types.js";
import type { GovernedChunk } from "../lib/types.js";
import { ScriptedAdapter, collect, makeConfig, makeLedger, makePolicy, makeRequest } from "./fakes.js";

class TwoHardScanner implements Scanner {
  name = "two-hard";
  scan(_content: string): Finding[] {
    return [
      { scanner: "two-hard", category: "injection", severity: "hard", match: "one", position: 0 },
      { scanner: "two-hard", category: "toxicity", severity: "hard", match: "two", position: 1 },
    ];
  }
}

describe("model gateway stream collect-all", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("returns both hard categories and refuses the yield", async () => {
    const made = makeLedger();
    dir = made.dir;
    const registry = new ProviderRegistry();
    registry.register(new ScriptedAdapter(["x"], ["hello"]));
    const gw = new GovernedModelGateway(
      {
        config: makeConfig({ provider: "custom", model: "fake" }),
        sessionId: "s1",
        scanInput: false,
        scanOutput: true,
        optimisePrompts: false,
      },
      {
        policy: makePolicy(),
        scanner: new ScannerPipeline([new TwoHardScanner()]),
        registry,
        ledger: made.ledger,
      },
    );
    const chunks: GovernedChunk[] = await collect(gw.stream(makeRequest({ messages: [{ role: "user", content: "hi" }] })));
    expect(chunks).toHaveLength(1);
    const last = chunks[chunks.length - 1];
    expect(last?.governance?.aborted).toBe(true);
    expect(last?.content).toBe("");
    const reason = last?.governance?.reason ?? "";
    expect(reason).toContain("injection");
    expect(reason).toContain("toxicity");
    const findings = last?.governance?.findings ?? [];
    expect(findings).toEqual(["two-hard:injection", "two-hard:toxicity"]);
    const abort = made.ledger.entries().find((e) => e.type === "stream:abort");
    expect(abort?.data.findings).toEqual(["two-hard:injection", "two-hard:toxicity"]);
    expect(abort?.data.chunksProcessed).toBe(1);
  });
});
