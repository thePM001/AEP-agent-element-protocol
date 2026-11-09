import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  groupLrpsByCategory,
  listComplianceModules,
  listPlatformContracts,
  listPlatformMandatoryPolicies,
  loadLrpCatalog,
  loadLrpModule,
  platformWritingAuthority,
  selectLrpsDefault,
  selectLrpsInteractive,
} from "../lib/lrp.mjs";

const EXPECTED_LRPS = ["eu-ai-act", "gdpr", "soc2-type2", "hipaa", "nist-ai-rmf", "iso-42001"];

describe("loadLrpCatalog", () => {
  it("reads lrp/catalog.json with the regulation LRPs and platform contracts", () => {
    const catalog = loadLrpCatalog();
    expect(catalog.version).toBe("2.9.0");
    expect(catalog.lrps.map((l) => l.id)).toEqual(EXPECTED_LRPS);
    expect(catalog.correctwriting_en).toMatchObject({ id: "correctwriting-en", priority: 255, mandatory: true });
  });

  it("every LRP names a module manifest that loads and matches its id", () => {
    const catalog = loadLrpCatalog();
    for (const lrp of catalog.lrps) {
      const mod = loadLrpModule(lrp.module_manifest);
      expect(mod, lrp.module_manifest).not.toBeNull();
      expect(JSON.stringify(mod)).toContain(lrp.id);
    }
  });
});

describe("loadLrpModule", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("returns null for a missing manifest", () => {
    expect(loadLrpModule("AEP-Components/platform-core/lrp/modules/none.json")).toBeNull();
  });

  it("reads an absolute path as is", () => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    const file = join(dir, "m.json");
    writeFileSync(file, JSON.stringify({ id: "custom", rules: [1, 2] }));
    expect(loadLrpModule(file)).toEqual({ id: "custom", rules: [1, 2] });
  });

  it("throws on a manifest that is not JSON", () => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    const file = join(dir, "bad.json");
    writeFileSync(file, "{ not json");
    expect(() => loadLrpModule(file)).toThrow(SyntaxError);
  });
});

describe("catalog helpers", () => {
  const catalog = loadLrpCatalog();

  it("lists kernel contracts and features apart from LRPs", () => {
    const ids = listPlatformContracts(catalog).map((c) => c.id);
    expect(ids).toContain("dynaep-action-lattice");
    expect(ids).toContain("lattice-channel-default");
    expect(ids.some((id) => EXPECTED_LRPS.includes(id))).toBe(false);
    expect(listPlatformMandatoryPolicies(catalog)).toEqual([]);
  });

  it("returns empty lists for a bare catalog", () => {
    expect(listPlatformContracts({})).toEqual([]);
    expect(listPlatformMandatoryPolicies({})).toEqual([]);
    expect(selectLrpsDefault({})).toEqual([]);
    expect(listComplianceModules({})).toEqual([]);
    expect(groupLrpsByCategory({})).toEqual({ compliance: [] });
  });

  it("groups LRPs by category and defaults the category to compliance", () => {
    const groups = groupLrpsByCategory({
      lrps: [{ id: "a" }, { id: "b", category: "sector" }, { id: "c", category: "compliance" }],
    });
    expect(groups.compliance.map((l) => l.id)).toEqual(["a", "c"]);
    expect(groups.sector.map((l) => l.id)).toEqual(["b"]);
  });

  it("selects default-enabled LRPs only", () => {
    expect(selectLrpsDefault(catalog)).toEqual([]);
    expect(
      selectLrpsDefault({ lrps: [{ id: "x", default_enabled: true }, { id: "y", default_enabled: false }] }),
    ).toEqual(["x"]);
  });

  it("describes compliance modules with nulls for missing fields", () => {
    const mods = listComplianceModules(catalog);
    expect(mods.map((m) => m.id)).toEqual(EXPECTED_LRPS);
    expect(mods[0]).toEqual({
      id: "eu-ai-act",
      name: "EU AI Act",
      framework: "EU AI Act",
      jurisdiction: "European Union",
      gap_ref: "AEP-Policy-System/reference/eu-ai-act.gap",
      module_manifest: "AEP-Components/platform-core/lrp/modules/eu-ai-act.json",
      priority: 155,
      default_enabled: false,
    });
    expect(listComplianceModules({ lrps: [{ id: "z", name: "Z", category: "compliance" }] })).toEqual([
      {
        id: "z",
        name: "Z",
        framework: "Z",
        jurisdiction: null,
        gap_ref: null,
        module_manifest: null,
        priority: undefined,
        default_enabled: undefined,
      },
    ]);
  });
});

describe("platformWritingAuthority", () => {
  it("returns the correctwriting_en record of the shipped catalog", () => {
    expect(platformWritingAuthority(loadLrpCatalog())).toMatchObject({
      id: "correctwriting-en",
      name: "CORRECTWRITING_EN Core Regulations",
      priority: 255,
    });
  });

  it("falls back to a legacy epscom record and prefers correctwriting_en", () => {
    expect(platformWritingAuthority({ epscom: { id: "old" } })).toEqual({ id: "old" });
    expect(platformWritingAuthority({ epscom: { id: "old" }, correctwriting_en: { id: "new" } })).toEqual({ id: "new" });
  });

  it("throws a clear error when neither record exists or the record has no id", () => {
    const msg = "LRP catalog has no platform writing authority record (correctwriting_en)";
    expect(() => platformWritingAuthority({})).toThrow(msg);
    expect(() => platformWritingAuthority(undefined)).toThrow(msg);
    expect(() => platformWritingAuthority({ correctwriting_en: { name: "no id" } })).toThrow(msg);
  });
});

describe("selectLrpsInteractive", () => {
  const originalLog = console.log;
  afterEach(() => {
    console.log = originalLog;
  });
  const quiet = () => {
    const lines = [];
    console.log = (...args) => {
      lines.push(args.join(" "));
    };
    return { lines };
  };

  it("asks once per compliance LRP and returns the accepted ids", async () => {
    const catalog = loadLrpCatalog();
    const asked = [];
    const promptYesNo = async (_rl, question, def) => {
      asked.push({ question, def });
      return question.includes("(gdpr)") || question.includes("(hipaa)");
    };
    const out = quiet();
    const selected = await selectLrpsInteractive(catalog, {}, promptYesNo);
    expect(selected).toEqual(["gdpr", "hipaa"]);
    expect(asked).toHaveLength(EXPECTED_LRPS.length);
    expect(asked[0]).toEqual({
      question: "  Enable EU AI Act (eu-ai-act) [EU AI Act] (European Union)?",
      def: false,
    });
    expect(out.lines.join("\n")).toContain("EPSCOM: CORRECTWRITING_EN Core Regulations");
    expect(out.lines.join("\n")).toContain("  - dynAEP Action Lattice (dynaep-action-lattice)");
  });

  it("still works with a legacy catalog that names the authority epscom", async () => {
    const out = quiet();
    const selected = await selectLrpsInteractive(
      { epscom: { id: "legacy", name: "Legacy", priority: 9 }, lrps: [{ id: "only", name: "Only" }] },
      {},
      async () => true,
    );
    expect(selected).toEqual(["only"]);
    expect(out.lines.join("\n")).toContain("EPSCOM: Legacy (mandatory platform authority, priority 9; not an LRP)");
  });

  it("fails with a clear error when the catalog has no writing authority", async () => {
    await expect(selectLrpsInteractive({ lrps: [] }, {}, async () => true)).rejects.toThrow(
      "LRP catalog has no platform writing authority record (correctwriting_en)",
    );
  });

  it("prompts nothing for a catalog without LRPs", async () => {
    quiet();
    let calls = 0;
    const bare = { correctwriting_en: { id: "cw", name: "CW", priority: 1 } };
    expect(await selectLrpsInteractive(bare, {}, async () => (calls += 1) > 0)).toEqual([]);
    expect(calls).toBe(0);
  });
});
