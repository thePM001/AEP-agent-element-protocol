// CC-17: the TypeScript helpers enforce writing.gap through the Base Node kernel
// (aep-lattice-log) and fail closed when the kernel cannot answer.

import {
  assertGovernedProseDraft,
  epscomEnforceWriting,
  epscomEnforceWritingValue,
  epscomLintWriting,
  lintGovernedProse,
  lintGovernedProseStrict,
} from "../../lattice-channels/lib/lattice-transport.mjs";
import { latticeLogBin } from "./support/paths.mjs";

// Built from code points so this source file stays ASCII.
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

describe("CC-17 EPSCOM kernel writing.gap enforcement (aep-lattice-log)", () => {
  const opts = () => ({ latticeLogBin: latticeLogBin() });

  it("CC-17 the kernel names each rule a draft breaks with its line", () => {
    const draft = `First line is clean.\nThe dock ${EM} the kernel ${EN} the wall.\nRed, white, and blue.`;
    const found = lintGovernedProse(draft, opts()).map((v) => [v.rule, v.line]);
    expect(found).toEqual(
      expect.arrayContaining([
        ["no_em_dashes", 2],
        ["no_en_dashes", 2],
        ["no_oxford_comma", 3],
      ]),
    );
    expect(found.every(([, line]) => line !== 1)).toBe(true);
    expect(epscomLintWriting(draft, opts()).ok).toBe(false);
  });

  it("CC-17 the kernel fixes a draft and reports how many findings it corrected", () => {
    const result = epscomEnforceWriting(`Ports ${EM} sealed only.`, opts());
    expect(result.ok).toBe(true);
    expect(result.authority).toBe("correctwriting-en");
    expect(result.text).not.toContain(EM);
    expect(result.violations_corrected).toBeGreaterThan(0);
    expect(lintGovernedProse(result.text, opts())).toEqual([]);
  });

  it("CC-17 a strict draft with a finding is blocked and a clean draft passes unchanged", () => {
    expect(() => assertGovernedProseDraft(`One ${EM} two.`, opts())).toThrow(/no_em_dashes/);
    expect(assertGovernedProseDraft("One and two.", opts())).toBe("One and two.");
  });

  it("CC-17 JSON values are enforced string by string", () => {
    const value = { title: `A ${EM} B`, items: [`x ${EN} y`, 3, true], nested: { ok: "fine" } };
    const fixed = epscomEnforceWritingValue(value, opts());
    expect(JSON.stringify(fixed)).not.toMatch(/[\u2013\u2014]/u);
    expect(fixed.items.slice(1)).toEqual([3, true]);
    expect(fixed.nested).toEqual({ ok: "fine" });
  });

  it("CC-17 a missing kernel fails closed instead of passing the draft", () => {
    const missing = { latticeLogBin: "/nonexistent/aep-lattice-log" };
    const prior = process.env.AEP_EPSCOM_ALLOW_JS_FALLBACK;
    delete process.env.AEP_EPSCOM_ALLOW_JS_FALLBACK;
    try {
      const strict = lintGovernedProseStrict("Plain clean text.", missing);
      expect(strict.map((v) => v.rule)).toContain("epscom_kernel_unavailable");
      expect(lintGovernedProse("Plain clean text.", missing).map((v) => v.rule)).toEqual([
        "epscom_kernel_unavailable",
      ]);
      expect(() => epscomEnforceWriting("Plain clean text.", missing)).toThrow();
    } finally {
      if (prior !== undefined) process.env.AEP_EPSCOM_ALLOW_JS_FALLBACK = prior;
    }
  });
});
