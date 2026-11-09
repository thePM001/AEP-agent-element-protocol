import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  GAP_REFERENCE_DIR,
  buildMountProfilesYaml,
  compileMountProfilesFromGap,
  listGapCawProfiles,
  listGapReferencePolicies,
  materializeCawRuntimeFromGap,
  mergeGapProfilesIntoCawConfig,
  parseGapFile,
  resolveGapProfileFile,
  synthesizeTaskManifestFromGap,
  validatePlanAgainstGapTemplate,
} from "../lib/gap-compile.mjs";
import gapEngineDefault, { createGapConstrainedEngine } from "../lib/gap-constrained-engine.mjs";

const REF = "AEP-Components/gap/policies/reference";

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
  vi.useRealTimers();
});

function put(rel, body) {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

function profileGap(domain, id, profile, extraDocs = "") {
  return [
    `address:\n  domain: ${domain}\n  id: ${id}\npattern: test\n`,
    YAML.stringify({ kind: "aep.caw.profile", ...profile }),
    extraDocs,
  ]
    .filter(Boolean)
    .join("---\n");
}

/** A small repo root with two CAW profiles, one mount policy and the two templates. */
function fakeRepo() {
  root = mkdtempSync(join(tmpdir(), "aep-"));
  put(
    `${REF}/caw-zeta.gap`,
    profileGap(
      "dev.test",
      "zeta.v1",
      {
        profile_id: "zeta",
        name: "Zeta Profile",
        base_policy: "minimal",
        enforcement_tier: "seccomp",
        llm_proxy: false,
        compiled_runtime: true,
        mounts: [{ path: "/work", policy: "rw", extra: "dropped" }],
      },
      YAML.stringify({ kind: "aep.caw.mount_policy", name: "rw", policy: { allow: ["read", "write"] } }),
    ),
  );
  put(
    `${REF}/caw-alpha.gap`,
    profileGap("dev.test", "alpha.v1", { profile_id: "alpha", base_policy: "default" }),
  );
  put(`${REF}/no-profile.gap`, "address:\n  domain: dev.test\n  id: none.v1\n");
  put(`${REF}/readme.txt`, "not a policy");
  put(
    `${REF}/task-manifest-v1.gap`,
    YAML.stringify({
      kind: "aep.task_manifest.template",
      defaults: { caw_profile: "zeta", gap_address: "dev.test/zeta.v1", trust_tier: "high", max_trust_score: 500, mcp: { servers: [] } },
    }),
  );
  put(
    `${REF}/implementation-plan-v1.gap`,
    YAML.stringify({ kind: "aep.implementation_plan.template", require_gap: true }),
  );
  return root;
}

describe("gap-constrained-engine", () => {
  it("refuses to build an engine because constrained decoding is not Admit", () => {
    expect(() => createGapConstrainedEngine()).toThrow(/unwired/);
  });

  it("the default export refuses every property read", () => {
    expect(() => gapEngineDefault.validate).toThrow(/Live Admit is collect-all/);
  });
});

describe("parseGapFile", () => {
  it("splits the instruction document from runtime documents of known kinds", () => {
    fakeRepo();
    put("x.gap", "address:\n  domain: d\n  id: i\n---\nkind: aep.caw.profile\nprofile_id: p\n---\nkind: unknown.kind\n");
    const parsed = parseGapFile(join(root, "x.gap"));
    expect(parsed.instruction.address).toEqual({ domain: "d", id: "i" });
    expect(parsed.runtime).toEqual([{ kind: "aep.caw.profile", profile_id: "p" }]);
    expect(parsed.path).toBe(join(root, "x.gap"));
  });

  it("returns a null instruction when no document carries an address", () => {
    fakeRepo();
    put("y.gap", "kind: aep.caw.profile\nprofile_id: q\n");
    expect(parseGapFile(join(root, "y.gap")).instruction).toBeNull();
  });

  it("throws on a missing file", () => {
    expect(() => parseGapFile(join(tmpdir(), "aep-missing-file.gap"))).toThrow();
  });
});

describe("listGapReferencePolicies", () => {
  it("lists only .gap files, sorted", () => {
    fakeRepo();
    const names = listGapReferencePolicies(root).map((p) => p.slice(join(root, REF).length + 1));
    expect(names).toEqual([
      "caw-alpha.gap",
      "caw-zeta.gap",
      "implementation-plan-v1.gap",
      "no-profile.gap",
      "task-manifest-v1.gap",
    ]);
  });

  it("returns an empty list when the reference folder is absent", () => {
    root = mkdtempSync(join(tmpdir(), "aep-"));
    expect(listGapReferencePolicies(root)).toEqual([]);
  });
});

describe("resolveGapProfileFile", () => {
  it("resolves by profile id, name, address, file name and file name without caw prefix", () => {
    fakeRepo();
    for (const ref of ["zeta", "Zeta Profile", "dev.test/zeta.v1", "caw-zeta", "  zeta  "]) {
      const hit = resolveGapProfileFile(ref, root);
      expect(hit?.address).toBe("dev.test/zeta.v1");
      expect(hit?.profile.profile_id).toBe("zeta");
      expect(hit?.file.endsWith("caw-zeta.gap")).toBe(true);
    }
  });

  it("returns null for an unknown profile or a missing reference folder", () => {
    fakeRepo();
    expect(resolveGapProfileFile("nope", root)).toBeNull();
    expect(resolveGapProfileFile("zeta", join(root, "elsewhere"))).toBeNull();
  });
});

describe("compileMountProfilesFromGap and listGapCawProfiles", () => {
  it("compiles every profile with defaults for missing fields", () => {
    fakeRepo();
    const profiles = compileMountProfilesFromGap(root);
    expect(Object.keys(profiles).sort()).toEqual(["alpha", "zeta"]);
    expect(profiles.zeta).toEqual({
      base_policy: "minimal",
      mounts: [{ path: "/work", policy: "rw" }],
      gap_address: "dev.test/zeta.v1",
      enforcement_tier: "seccomp",
      llm_proxy: false,
      compiled_runtime: true,
    });
    expect(profiles.alpha.mounts).toEqual([]);
    expect(profiles.alpha.llm_proxy).toBe(true);
    expect(profiles.alpha.compiled_runtime).toBe(false);
    expect(typeof profiles.alpha.enforcement_tier).toBe("string");
  });

  it("lists profiles with their names", () => {
    fakeRepo();
    const list = listGapCawProfiles(root);
    expect(list.map((p) => p.name).sort()).toEqual(["alpha", "zeta"]);
    const zeta = list.find((p) => p.name === "zeta");
    expect(zeta?.gap_address).toBe("dev.test/zeta.v1");
  });

  it("reads the shipped reference policies of this tree", () => {
    const names = listGapCawProfiles().map((p) => p.name);
    expect(names).toContain("agent-sandbox");
    expect(names).toContain("restricted");
    expect(listGapReferencePolicies().every((p) => p.startsWith(GAP_REFERENCE_DIR))).toBe(true);
    expect(resolveGapProfileFile("agent-sandbox")?.address).toBe("dev.aep.caw/agent-sandbox.v1");
  });
});

describe("buildMountProfilesYaml", () => {
  it("emits sorted mount_profiles YAML that parses back", () => {
    fakeRepo();
    const text = buildMountProfilesYaml(root);
    expect(text.startsWith("mount_profiles:\n  alpha:\n")).toBe(true);
    expect(text.endsWith("\n")).toBe(true);
    expect(YAML.parse(text)).toEqual({
      mount_profiles: {
        alpha: { base_policy: "default", mounts: null },
        zeta: { base_policy: "minimal", mounts: [{ path: "/work", policy: "rw" }] },
      },
    });
  });
});

describe("mergeGapProfilesIntoCawConfig", () => {
  it("replaces mount_profiles and keeps other keys", () => {
    fakeRepo();
    const cfg = join(root, "server-config.yaml");
    writeFileSync(cfg, YAML.stringify({ port: 9000, mount_profiles: { old: {} } }));
    expect(mergeGapProfilesIntoCawConfig(cfg, root)).toBe(cfg);
    const parsed = YAML.parse(readFileSync(cfg, "utf8"));
    expect(parsed.port).toBe(9000);
    expect(Object.keys(parsed.mount_profiles)).toEqual(["alpha", "zeta"]);
    expect(parsed.mount_profiles.zeta.mounts).toEqual([{ path: "/work", policy: "rw" }]);
  });

  it("creates the config when it does not exist", () => {
    fakeRepo();
    const cfg = join(root, "new-config.yaml");
    mergeGapProfilesIntoCawConfig(cfg, root);
    expect(YAML.parse(readFileSync(cfg, "utf8")).mount_profiles.alpha.base_policy).toBe("default");
  });
});

describe("materializeCawRuntimeFromGap", () => {
  it("copies bundled config and policies, writes mount policies and points the config at them", () => {
    fakeRepo();
    put("AEP-CAW/configs/server-config.yaml", YAML.stringify({ listen: "local", policies: { strict: true } }));
    put("AEP-CAW/configs/policies/base.yaml", "allow: []\n");
    put("AEP-CAW/configs/policies/ignored.txt", "x");
    const data = join(root, "data");
    const out = materializeCawRuntimeFromGap(data, root);
    expect(out.configPath).toBe(join(data, "caw-framework", "server-config.yaml"));
    expect(out.policiesDir).toBe(join(data, "caw-framework", "policies"));
    expect(Object.keys(out.profiles).sort()).toEqual(["alpha", "zeta"]);
    expect(existsSync(join(out.policiesDir, "base.yaml"))).toBe(true);
    expect(existsSync(join(out.policiesDir, "ignored.txt"))).toBe(false);
    expect(YAML.parse(readFileSync(join(out.policiesDir, "rw.yaml"), "utf8"))).toEqual({ allow: ["read", "write"] });
    const cfg = YAML.parse(readFileSync(out.configPath, "utf8"));
    expect(cfg.listen).toBe("local");
    expect(cfg.policies).toEqual({ strict: true, dir: out.policiesDir });
    expect(Object.keys(cfg.mount_profiles)).toEqual(["alpha", "zeta"]);
  });

  it("does not overwrite an existing config or policy file", () => {
    fakeRepo();
    put("AEP-CAW/configs/server-config.yaml", "listen: bundled\n");
    put("AEP-CAW/configs/policies/base.yaml", "bundled: true\n");
    const data = join(root, "data");
    put("data/caw-framework/server-config.yaml", "listen: mine\n");
    put("data/caw-framework/policies/base.yaml", "mine: true\n");
    const out = materializeCawRuntimeFromGap(data, root);
    expect(YAML.parse(readFileSync(out.configPath, "utf8")).listen).toBe("mine");
    expect(readFileSync(join(out.policiesDir, "base.yaml"), "utf8")).toBe("mine: true\n");
  });

  it("works without any bundled CAW config", () => {
    fakeRepo();
    const out = materializeCawRuntimeFromGap(join(root, "data"), root);
    const cfg = YAML.parse(readFileSync(out.configPath, "utf8"));
    expect(Object.keys(cfg)).toEqual(["mount_profiles"]);
  });
});

describe("synthesizeTaskManifestFromGap", () => {
  it("fills defaults from the template", () => {
    fakeRepo();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));
    const m = synthesizeTaskManifestFromGap({ agent_id: "a1" }, root);
    expect(m).toEqual({
      manifest_version: "1",
      id: "TM-a1-1700000000",
      agent_id: "a1",
      session_id: undefined,
      intent: {
        summary: "",
        allowed_operations: ["lattice:cross"],
        caw_profile: "zeta",
        gap_address: "dev.test/zeta.v1",
        coding_governance: undefined,
      },
      trust: { tier: "high", max_trust_score: 500 },
      mcp: { servers: [] },
      provisional: false,
      synthesized_by: "gap_constrained",
      created_at_unix: 1700000000,
    });
  });

  it("lets request fields win over the template", () => {
    fakeRepo();
    const m = synthesizeTaskManifestFromGap(
      {
        id: "TM-x",
        session_id: "s1",
        intent: "fallback intent",
        operations: ["read"],
        caw_profile: "alpha",
        gap_address: "dev.test/alpha.v1",
        trust_tier: "low",
        trust_score: 10,
        mcp: { servers: ["one"] },
        provisional: true,
      },
      root,
    );
    expect(m.id).toBe("TM-x");
    expect(m.agent_id).toBe("agent-default");
    expect(m.session_id).toBe("s1");
    expect(m.intent.summary).toBe("fallback intent");
    expect(m.intent.allowed_operations).toEqual(["read"]);
    expect(m.intent.caw_profile).toBe("alpha");
    expect(m.trust).toEqual({ tier: "low", max_trust_score: 10 });
    expect(m.mcp).toEqual({ servers: ["one"] });
    expect(m.provisional).toBe(true);
  });

  it("throws when the template file or document is missing", () => {
    root = mkdtempSync(join(tmpdir(), "aep-"));
    expect(() => synthesizeTaskManifestFromGap({}, root)).toThrow("missing task-manifest-v1.gap");
    put(`${REF}/task-manifest-v1.gap`, "kind: other\n");
    expect(() => synthesizeTaskManifestFromGap({}, root)).toThrow(/missing aep.task_manifest.template/);
  });
});

describe("validatePlanAgainstGapTemplate", () => {
  it("accepts a plan with version and gap enabled", () => {
    fakeRepo();
    expect(validatePlanAgainstGapTemplate({ plan_version: "1", policy_overrides: { gap: { enabled: true } } }, root)).toEqual({
      valid: true,
      warnings: [],
    });
  });

  it("warns about a missing version and disabled gap", () => {
    fakeRepo();
    expect(validatePlanAgainstGapTemplate({}, root)).toEqual({
      valid: false,
      warnings: ["plan_version required", "GAP-centric plans should set policy_overrides.gap.enabled"],
    });
  });

  it("skips the gap warning when the template does not require gap", () => {
    fakeRepo();
    put(`${REF}/implementation-plan-v1.gap`, YAML.stringify({ kind: "aep.implementation_plan.template", require_gap: false }));
    expect(validatePlanAgainstGapTemplate({ plan_version: "1" }, root).valid).toBe(true);
  });

  it("is valid when no template exists", () => {
    root = mkdtempSync(join(tmpdir(), "aep-"));
    expect(validatePlanAgainstGapTemplate({}, root)).toEqual({ valid: true, warnings: [] });
  });
});
