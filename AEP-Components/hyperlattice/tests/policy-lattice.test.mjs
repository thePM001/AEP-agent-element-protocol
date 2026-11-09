import { describe, expect, it } from "vitest";
import { buildPolicyLatticeView, platformWritingAuthority } from "../lib/policy-lattice.mjs";
import { formatPolicySystemForPrompt, loadPolicySystemContext } from "../lib/policy-system-context.mjs";

const AUTHORITY = { id: "correctwriting-en", name: "Core", priority: 255 };

const CATALOG = {
  correctwriting_en: AUTHORITY,
  platform_contracts: [
    { id: "dynaep-action-lattice", kind: "kernel_contract" },
    { id: "lattice-channel-default", kind: "kernel_contract" },
    { id: "gap-runtime-scanners", kind: "platform_feature" },
  ],
  platform_mandatory_policies: [{ id: "writing" }],
  lrps: [
    { id: "gdpr", name: "GDPR", priority: 154, category: "compliance", default_enabled: false, framework: "GDPR" },
    { id: "hipaa", name: "HIPAA", priority: 152, category: "compliance", default_enabled: true },
    { id: "custom", name: "Custom", category: "other", default_enabled: false },
  ],
};

describe("platformWritingAuthority", () => {
  it("reads correctwriting_en and falls back to the older epscom key", () => {
    expect(platformWritingAuthority(CATALOG)).toBe(AUTHORITY);
    expect(platformWritingAuthority({ epscom: { id: "epscom-core", priority: 1 } }).id).toBe("epscom-core");
  });

  it("throws a clear error when the catalog has no authority record", () => {
    expect(() => platformWritingAuthority({})).toThrow(/no platform writing authority record/);
    expect(() => platformWritingAuthority(undefined)).toThrow(/correctwriting_en/);
    expect(() => platformWritingAuthority({ correctwriting_en: { name: "no id" } })).toThrow();
  });
});

describe("buildPolicyLatticeView with an injected catalog", () => {
  it("uses default enabled lrps when none are requested", () => {
    const view = buildPolicyLatticeView([], CATALOG);
    expect(view.active_regulation_lrps.map((l) => l.id)).toEqual(["hipaa"]);
    expect(view.compliance_modules.map((m) => [m.id, m.enabled])).toEqual([
      ["gdpr", false],
      ["hipaa", true],
    ]);
  });

  it("keeps only requested lrps that exist in the catalog", () => {
    const view = buildPolicyLatticeView(["gdpr", "nope"], CATALOG);
    expect(view.active_regulation_lrps).toEqual([
      {
        id: "gdpr",
        name: "GDPR",
        priority: 154,
        framework: "GDPR",
        jurisdiction: null,
        gap_ref: null,
        module_manifest: null,
        docking_port: "regulation_module",
      },
    ]);
    expect(view.active_lrps[0]).toMatchObject({ id: "gdpr", mandatory: false, epscom_priority: 255, category: "compliance" });
  });

  it("binds the authority, the kernel contracts and the regulation lrps to channels", () => {
    const view = buildPolicyLatticeView(["gdpr"], CATALOG);
    expect(view.channel_bindings.map((b) => [b.contract_id, b.kind, b.docking_port, b.priority])).toEqual([
      ["correctwriting-en", "epscom", "regulation_module", 255],
      ["dynaep-action-lattice", "kernel_contract", "validation_engine", 200],
      ["lattice-channel-default", "kernel_contract", "validation_engine", 200],
      ["gdpr", "regulation_lrp", "regulation_module", 154],
    ]);
    expect(view.channel_bindings[0].epscom_supremacy).toBe(false);
    expect(view.channel_bindings.slice(1).every((b) => b.epscom_supremacy && b.pq_capsule)).toBe(true);
    expect(view.channel_bindings.map((b) => b.channel_id)).toContain("ch-gdpr");
  });

  it("exposes the authority, hierarchy and priority", () => {
    const view = buildPolicyLatticeView([], CATALOG);
    expect(view.epscom).toBe(AUTHORITY);
    expect(view.epscom_priority).toBe(255);
    expect(view.hierarchy.map((h) => h.id)).toEqual([
      "system",
      "governance.gap",
      "deployment.gap",
      "writing.gap",
      "security.gap",
      "sandbox",
    ]);
    expect(view.platform_mandatory_policies).toEqual([{ id: "writing" }]);
  });

  it("throws on a catalog without an authority record instead of a type error", () => {
    expect(() => buildPolicyLatticeView([], { lrps: [] })).toThrow(/platform writing authority/);
  });
});

describe("buildPolicyLatticeView and policy system context with the shipped catalog", () => {
  it("builds a view whose authority is the correctwriting record", () => {
    const view = buildPolicyLatticeView();
    expect(view.epscom.id).toBe("correctwriting-en");
    expect(view.channel_bindings[0].contract_id).toBe("correctwriting-en");
    expect(view.reference_policies.length).toBeGreaterThan(0);
    for (const p of view.reference_policies) {
      expect(p.path).toBe(`AEP-Policy-System/reference/${p.file}`);
      expect(p.file.endsWith(".gap")).toBe(true);
    }
  });

  it("formats the policy system prompt without a type error", () => {
    const text = formatPolicySystemForPrompt(loadPolicySystemContext());
    expect(text).toContain("EPSCOM (correctwriting-en, priority 255) is supreme platform authority");
  });
});
