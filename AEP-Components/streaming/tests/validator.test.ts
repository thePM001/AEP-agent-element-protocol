import { describe, it, expect } from "vitest";
import { AEPStreamValidator } from "../lib/validator.js";
import { validatePolicy } from "../../policy-engine/lib/policy/loader.js";
import { ScannerPipeline } from "../../scanners/lib/pipeline.js";
import type { Finding, Scanner } from "../../scanners/lib/types.js";

class WordScanner implements Scanner {
  readonly name = "word";
  constructor(private readonly word: string, private readonly severity: "hard" | "soft") {}
  scan(content: string): Finding[] {
    const i = content.indexOf(this.word);
    return i < 0 ? [] : [{ scanner: "word", category: "w", severity: this.severity, match: this.word, position: i }];
  }
}

const registry = {
  zBands: { CP: [10, 19] as [number, number] },
  parentRules: { CP: { requireParent: true }, SH: { requireParent: false } },
};

describe("AEPStreamValidator", () => {
  it("lets output through when nothing is configured", () => {
    const v = new AEPStreamValidator({});
    expect(v.onChunk("x", "anything at all")).toEqual({ continue: true });
  });

  it("aborts on a covenant forbid action and exposes an aborted signal", () => {
    const v = new AEPStreamValidator({
      covenant: {
        name: "safety",
        rules: [
          { type: "permit", action: "read", conditions: [] },
          { type: "forbid", action: "drop_table", conditions: [] },
        ],
      },
    });
    expect(v.onChunk("read", "read rows").continue).toBe(true);
    const verdict = v.onChunk("table", "now drop_table");
    expect(verdict.continue).toBe(false);
    expect(verdict.violation).toEqual({
      rule: "covenant:forbid:drop_table",
      reason: 'Covenant "safety" forbids "drop_table"',
    });
    expect(verdict.abortSignal?.aborted).toBe(true);
    v.reset();
    expect(v.onChunk("x", "clean").continue).toBe(true);
    const again = v.onChunk("x", "drop_table");
    expect(again.abortSignal).not.toBe(verdict.abortSignal);
    expect(again.abortSignal?.aborted).toBe(true);
  });

  it("aborts when output references a protected element", () => {
    const v = new AEPStreamValidator({
      scene: { elements: [{ id: "CP-00001", protected: true }, { id: "CP-00002" }] },
    });
    expect(v.onChunk("", 'move "CP-00002"').continue).toBe(true);
    expect(v.onChunk("", 'move "CP-00001"').violation?.rule).toBe("aep:protected-element:CP-00001");
  });

  it("checks z values against the registry band of the nearest id", () => {
    const v = new AEPStreamValidator({ registry });
    expect(v.onChunk("", '{"id": "CP-00003", "z": 15, "parent": "SH-00001"}').continue).toBe(true);
    const bad = v.onChunk("", '{"id": "CP-00003", "z": 25, "parent": "SH-00001"}');
    expect(bad.violation).toEqual({
      rule: "aep:z-band:CP",
      reason: 'Z-index 25 outside allowed band [10-19] for prefix "CP"',
    });
    expect(v.onChunk("", '{"id": "ZZ-00003", "z": 999, "parent": "SH-00001"}').continue).toBe(true);
    const far = `{"id": "CP-00003", "parent": "SH-00001", "note": "${"x".repeat(250)}", "z": 99}`;
    expect(v.onChunk("", far).continue).toBe(true);
  });

  it("flags elements that need a parent but have parent null, even across lines", () => {
    const v = new AEPStreamValidator({ registry });
    const verdict = v.onChunk("", '{"id": "CP-00004",\n  "label": "x",\n  "parent": null}');
    expect(verdict.violation).toEqual({
      rule: "aep:structural:orphan:CP-00004",
      reason: 'Element "CP-00004" (prefix "CP") requires a parent but has null',
    });
    expect(v.onChunk("", '{"id": "SH-00004", "parent": null}').continue).toBe(true);
  });

  it("applies policy forbidden patterns as regex with a literal fallback", () => {
    const policy = validatePolicy({
      version: "1",
      name: "s",
      capabilities: [],
      limits: {},
      session: { max_actions: 1 },
      forbidden: [{ pattern: "pass(word)?\\s*=", reason: "credential in output" }, { pattern: "[unclosed" }],
    });
    const v = new AEPStreamValidator({ policy });
    expect(v.onChunk("", "password = x").violation).toEqual({
      rule: "policy:forbidden:pass(word)?\\s*=",
      reason: "credential in output",
    });
    expect(v.onChunk("", "see [unclosed bracket").violation).toEqual({
      rule: "policy:forbidden:[unclosed",
      reason: 'Matched forbidden pattern "[unclosed"',
    });
    expect(v.onChunk("", "harmless").continue).toBe(true);
  });

  it("aborts on hard scanner findings only", () => {
    const v = new AEPStreamValidator({
      scannerPipeline: new ScannerPipeline([new WordScanner("leak", "hard"), new WordScanner("meh", "soft")]),
    });
    expect(v.onChunk("", "meh").continue).toBe(true);
    expect(v.onChunk("", "a leak").violation).toEqual({
      rule: "scanner:word:w",
      reason: 'Content scanner "word" detected: leak',
    });
  });

  it("reports the covenant violation first when several checks fail", () => {
    const v = new AEPStreamValidator({
      covenant: { name: "c", rules: [{ type: "forbid", action: "CP-00001", conditions: [] }] },
      scene: { elements: [{ id: "CP-00001", protected: true }] },
    });
    expect(v.onChunk("", "CP-00001").violation?.rule).toBe("covenant:forbid:CP-00001");
  });
});
