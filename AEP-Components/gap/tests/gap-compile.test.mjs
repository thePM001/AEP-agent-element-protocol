import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  CAW_RESOLVED_RECORD,
  GAP_REFERENCE_DIR,
  GapCompileError,
  canonicalJson,
  cawRecordDigest,
  compileMountProfilesFromGap,
  listGapCawProfiles,
  listGapReferencePolicies,
  materializeCawProfilesFromGap,
  parseGapFile,
  resolveCawProfile,
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
      defaults: { caw_profile: "zeta", gap_address: "dev.test/zeta.v1", mcp: { servers: [] } },
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
      egress_policy: null,
      toolset: null,
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

/** The documents of one small repo with one CAW profile of the tier gvisor. */
function gvisorDocs() {
  return {
    profile: {
      kind: "aep.caw.profile",
      profile_id: "g",
      name: "g",
      base_policy: "base",
      enforcement_tier: "gvisor",
      llm_proxy: true,
      compiled_runtime: false,
      egress_policy: "gateway",
      toolset: "tools",
      mounts: [{ path: "${PROJECT_ROOT}", policy: "rw" }],
    },
    rw: {
      kind: "aep.caw.mount_policy",
      name: "rw",
      policy: {
        version: 1,
        name: "rw",
        description: "read and write",
        file_rules: [
          { name: "allow-rw", paths: ["${MOUNT_PATH}", "${MOUNT_PATH}/**"], operations: ["read", "write"], decision: "allow" },
        ],
      },
    },
    base: {
      kind: "aep.caw.mount_policy",
      name: "base",
      policy: {
        version: 1,
        name: "base",
        command_rules: [{ name: "no-sudo", commands: ["sudo"], decision: "deny" }],
      },
    },
    egress: {
      kind: "aep.caw.egress_policy",
      name: "gateway",
      unmatched: "deny",
      routes: [{ name: "gateway", scheme: "https", host: "gateway.example.com", port: 443, decision: "allow" }],
    },
    toolset: {
      kind: "aep.caw.toolset",
      name: "tools",
      programs: [{ name: "sh", source: "/usr/bin/sh" }, { name: "git", source: "/opt/git/bin/git", path: "/usr/local/bin/git" }],
    },
  };
}

/** Write the documents as one reference file of a fresh repo root. */
function gvisorRepo(change = () => {}, extraDocs = []) {
  const docs = gvisorDocs();
  change(docs);
  root = mkdtempSync(join(tmpdir(), "aep-"));
  const all = [docs.profile, docs.rw, docs.base, docs.egress, docs.toolset, ...extraDocs].filter(Boolean);
  put(
    `${REF}/caw-g.gap`,
    ["address:\n  domain: dev.test\n  id: g.v1\npattern: test\n", ...all.map((d) => YAML.stringify(d))].join("---\n"),
  );
  return root;
}

function refusal(fn) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GapCompileError);
    return err.code;
  }
  return "no refusal";
}

describe("canonicalJson and cawRecordDigest", () => {
  it("sorts the keys of every record and keeps the order of lists", () => {
    expect(canonicalJson({ b: 1, a: [{ d: null, c: "x" }, 2], e: true })).toBe('{"a":[{"c":"x","d":null},2],"b":1,"e":true}');
  });

  it("gives the same digest for the same content in another key order", () => {
    const one = cawRecordDigest({ a: 1, b: { c: 2, d: 3 }, digest: "old" });
    const two = cawRecordDigest({ b: { d: 3, c: 2 }, a: 1 });
    expect(one).toBe(two);
    expect(one).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(cawRecordDigest({ a: 2, b: { c: 2, d: 3 } })).not.toBe(one);
  });
});

describe("resolveCawProfile", () => {
  it("resolves a profile of the tier gvisor into one record with its digest", () => {
    gvisorRepo();
    const record = resolveCawProfile("g", root);
    expect(record.record).toBe(CAW_RESOLVED_RECORD);
    expect(record.version).toBe(1);
    expect(record.profile_id).toBe("g");
    expect(record.gap_address).toBe("dev.test/g.v1");
    expect(record.enforcement_tier).toBe("gvisor");
    expect(record.llm_proxy).toBe(true);
    expect(record.compiled_runtime).toBe(false);
    expect(record.base_policy).toEqual({
      name: "base",
      file_rules: [],
      command_rules: [{ name: "no-sudo", commands: ["sudo"], decision: "deny" }],
    });
    expect(record.mounts).toEqual([
      {
        path: "${PROJECT_ROOT}",
        policy: {
          name: "rw",
          file_rules: [
            { name: "allow-rw", paths: ["${MOUNT_PATH}", "${MOUNT_PATH}/**"], operations: ["read", "write"], decision: "allow" },
          ],
          command_rules: [],
        },
      },
    ]);
    expect(record.egress_policy).toEqual({
      name: "gateway",
      unmatched: "deny",
      routes: [{ name: "gateway", scheme: "https", host: "gateway.example.com", port: 443, decision: "allow" }],
    });
    expect(record.toolset).toEqual({
      name: "tools",
      programs: [
        { name: "sh", source: "/usr/bin/sh", path: "/usr/bin/sh" },
        { name: "git", source: "/opt/git/bin/git", path: "/usr/local/bin/git" },
      ],
      trees: [],
    });
    expect(record.digest).toBe(cawRecordDigest(record));
  });

  it("changes the digest when one route changes", () => {
    gvisorRepo();
    const before = resolveCawProfile("g", root).digest;
    rmSync(root, { recursive: true, force: true });
    gvisorRepo((d) => {
      d.egress.routes[0].port = 8443;
    });
    expect(resolveCawProfile("g", root).digest).not.toBe(before);
  });

  it("gives a profile with no egress policy no route at all", () => {
    gvisorRepo((d) => {
      d.profile.llm_proxy = false;
      delete d.profile.egress_policy;
    });
    expect(resolveCawProfile("g", root).egress_policy).toBeNull();
  });

  it("takes a wildcard under one domain and one variable as a host", () => {
    for (const host of ["*.example.com", "${AEP_MODEL_GATEWAY_HOST}"]) {
      gvisorRepo((d) => {
        d.egress.routes[0].host = host;
      });
      expect(resolveCawProfile("g", root).egress_policy.routes[0].host).toBe(host);
      rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("takes the trees of a toolset with their source, path and bin folder", () => {
    gvisorRepo((d) => {
      d.toolset.trees = [
        { name: "rust", source: "${RUST_TOOLCHAIN}", path: "/usr/local/rust", bin: "bin" },
        { name: "host-libraries", source: "/usr/lib/x86_64-linux-gnu", path: "/usr/lib/x86_64-linux-gnu" },
      ];
    });
    expect(resolveCawProfile("g", root).toolset.trees).toEqual([
      { name: "rust", source: "${RUST_TOOLCHAIN}", path: "/usr/local/rust", bin: "bin" },
      { name: "host-libraries", source: "/usr/lib/x86_64-linux-gnu", path: "/usr/lib/x86_64-linux-gnu", bin: null },
    ]);
  });

  it("refuses a tree that is not a plain folder of the root, each with its reason", () => {
    const tree = (change) => (d) => {
      const one = { name: "rust", source: "/opt/rust", path: "/usr/local/rust", bin: "bin" };
      change(one, d);
      d.toolset.trees = [one];
    };
    const cases = [
      ["toolset-tree", tree((t) => { t.name = "Rust Toolchain"; })],
      ["toolset-tree", tree((t) => { t.source = "opt/rust"; })],
      ["toolset-tree", tree((t) => { t.source = "/opt/../etc"; })],
      ["toolset-tree", tree((t) => { t.source = "/opt/rust/"; })],
      ["toolset-tree", tree((t) => { t.path = "/home/agent/rust"; })],
      ["toolset-tree", tree((t) => { t.path = "/etc/rust"; })],
      ["toolset-tree", tree((t) => { t.path = "/usr"; })],
      ["toolset-tree", tree((t) => { t.path = "/usr/local/../rust"; })],
      ["toolset-tree", tree((t) => { t.path = "usr/local/rust"; })],
      ["toolset-tree", tree((t) => { t.bin = "/bin"; })],
      ["toolset-tree", tree((t) => { t.bin = "../bin"; })],
      ["toolset-tree", tree((t) => { t.path = "/usr/local"; })],
      ["toolset-tree", tree((t, d) => { d.toolset.programs.push({ name: "cargo", source: "/x/cargo", path: "/usr/local/rust/bin/cargo" }); })],
      ["unknown-key", tree((t) => { t.sha256 = "x"; })],
      ["missing-field", tree((t) => { delete t.source; })],
      ["missing-field", tree((t) => { delete t.path; })],
    ];
    for (const [code, change] of cases) {
      gvisorRepo(change);
      expect([code, refusal(() => resolveCawProfile("g", root))]).toEqual([code, code]);
      rmSync(root, { recursive: true, force: true });
    }
    gvisorRepo((d) => {
      d.toolset.trees = [
        { name: "a", source: "/opt/a", path: "/usr/local/a" },
        { name: "b", source: "/opt/b", path: "/usr/local/a/b" },
      ];
    });
    expect(refusal(() => resolveCawProfile("g", root))).toBe("toolset-tree");
    rmSync(root, { recursive: true, force: true });
    gvisorRepo((d) => {
      d.toolset.trees = [
        { name: "a", source: "/opt/a", path: "/usr/local/a" },
        { name: "a", source: "/opt/b", path: "/usr/local/b" },
      ];
    });
    expect(refusal(() => resolveCawProfile("g", root))).toBe("duplicate-name");
    rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("refuses what the CAW cannot run, each with its reason", () => {
    const cases = [
      ["tier", (d) => { d.profile.enforcement_tier = "seccomp"; }],
      ["tier", (d) => { delete d.profile.enforcement_tier; }],
      ["no-toolset", (d) => { delete d.profile.toolset; }],
      ["unknown-toolset", (d) => { d.profile.toolset = "absent"; }],
      ["unknown-policy", (d) => { d.profile.base_policy = "absent"; }],
      ["unknown-policy", (d) => { d.profile.mounts[0].policy = "absent"; }],
      ["unknown-egress-policy", (d) => { d.profile.egress_policy = "absent"; }],
      ["llm-proxy-without-route", (d) => { delete d.profile.egress_policy; }],
      ["missing-field", (d) => { delete d.profile.llm_proxy; }],
      ["missing-field", (d) => { d.profile.compiled_runtime = "yes"; }],
      ["missing-field", (d) => { d.profile.mounts = []; }],
      ["missing-field", (d) => { d.egress.routes = []; }],
      ["missing-field", (d) => { d.toolset.programs = []; }],
      ["missing-field", (d) => { d.rw.policy.file_rules[0].paths = []; }],
      ["unknown-key", (d) => { d.profile.approval = "ask"; }],
      ["unknown-key", (d) => { d.profile.mounts[0].extra = true; }],
      ["unknown-key", (d) => { d.rw.policy.network_rules = []; }],
      ["unknown-key", (d) => { d.rw.policy.file_rules[0].redirect = "/x"; }],
      ["unknown-key", (d) => { d.egress.routes[0].path = "/v1"; }],
      ["unknown-key", (d) => { d.egress.default = "allow"; }],
      ["unknown-key", (d) => { d.toolset.programs[0].sha256 = "x"; }],
      ["egress-unmatched", (d) => { d.egress.unmatched = "allow"; }],
      ["egress-route", (d) => { d.egress.routes[0].scheme = "ftp"; }],
      ["egress-route", (d) => { d.egress.routes[0].host = "10.0.0.1"; }],
      ["egress-route", (d) => { d.egress.routes[0].host = "Gateway.Example.com"; }],
      ["egress-route", (d) => { d.egress.routes[0].host = "*"; }],
      ["egress-route", (d) => { d.egress.routes[0].host = "a.*.example.com"; }],
      ["egress-route", (d) => { d.egress.routes[0].port = 0; }],
      ["egress-route", (d) => { d.egress.routes[0].port = "443"; }],
      ["egress-route", (d) => { d.egress.routes[0].decision = "approve"; }],
      ["toolset-program", (d) => { d.toolset.programs[0].source = "bin/sh"; }],
      ["toolset-program", (d) => { d.toolset.programs[0].source = "/usr/../bin/sh"; }],
      ["toolset-program", (d) => { d.toolset.programs[0].name = "../sh"; }],
      ["duplicate-name", (d) => { d.toolset.programs.push({ name: "sh", source: "/bin/sh", path: "/bin/sh" }); }],
      ["duplicate-name", (d) => { d.toolset.programs.push({ name: "dash", source: "/bin/dash", path: "/usr/bin/sh" }); }],
      ["duplicate-name", (d) => { d.egress.routes.push({ ...d.egress.routes[0] }); }],
    ];
    for (const [code, change] of cases) {
      gvisorRepo(change);
      expect([code, refusal(() => resolveCawProfile("g", root))]).toEqual([code, code]);
      rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("refuses an unknown profile and two records with one name", () => {
    gvisorRepo();
    expect(refusal(() => resolveCawProfile("absent", root))).toBe("unknown-profile");
    rmSync(root, { recursive: true, force: true });
    gvisorRepo(() => {}, [{ kind: "aep.caw.toolset", name: "tools", programs: [{ name: "ls", source: "/usr/bin/ls" }] }]);
    expect(refusal(() => resolveCawProfile("g", root))).toBe("duplicate-name");
    rmSync(root, { recursive: true, force: true });
    gvisorRepo(() => {}, [{ kind: "aep.caw.egress_policy", name: "Not Plain", routes: [] }]);
    expect(refusal(() => resolveCawProfile("g", root))).toBe("record-name");
  });
});

describe("materializeCawProfilesFromGap", () => {
  it("writes one canonical record per profile of the tier gvisor and skips the others", () => {
    gvisorRepo();
    put(`${REF}/caw-old.gap`, profileGap("dev.test", "old.v1", { profile_id: "old", enforcement_tier: "seccomp" }));
    const data = join(root, "data");
    const out = materializeCawProfilesFromGap(data, root);
    expect(out.profilesDir).toBe(join(data, "caw-framework", "profiles"));
    expect(out.skipped).toEqual([{ profile_id: "old", enforcement_tier: "seccomp" }]);
    expect(out.profiles.map((p) => p.profile_id)).toEqual(["g"]);
    const text = readFileSync(out.profiles[0].path, "utf8");
    const record = JSON.parse(text);
    expect(text).toBe(`${canonicalJson(record)}\n`);
    expect(record.digest).toBe(out.profiles[0].digest);
    expect(record.digest).toBe(cawRecordDigest(record));
    expect(existsSync(join(data, "caw-framework", "server-config.yaml"))).toBe(false);
    expect(existsSync(join(data, "caw-framework", "policies"))).toBe(false);
  });

  it("writes nothing when one profile cannot be resolved", () => {
    gvisorRepo((d) => {
      d.profile.toolset = "absent";
    });
    const data = join(root, "data");
    expect(refusal(() => materializeCawProfilesFromGap(data, root))).toBe("unknown-toolset");
    expect(existsSync(data)).toBe(false);
  });

  it("resolves every shipped reference profile", () => {
    root = mkdtempSync(join(tmpdir(), "aep-"));
    const out = materializeCawProfilesFromGap(join(root, "data"));
    expect(out.skipped).toEqual([]);
    expect(out.profiles.map((p) => p.profile_id)).toEqual([
      "agent-sandbox",
      "coding-agent",
      "compiled-runtime",
      "dev-multi-repo",
      "ede-draft",
      "restricted",
    ]);
    const restricted = resolveCawProfile("restricted");
    expect(restricted.egress_policy.routes).toEqual([
      { name: "model-gateway", scheme: "https", host: "${AEP_MODEL_GATEWAY_HOST}", port: 443, decision: "allow" },
    ]);
    expect(resolveCawProfile("compiled-runtime").egress_policy).toBeNull();
    const draft = resolveCawProfile("ede-draft");
    expect(draft.egress_policy).toBeNull();
    expect(draft.compiled_runtime).toBe(true);
    expect(draft.toolset.trees.map((t) => t.name)).toEqual([
      "rust-toolchain",
      "compiler-support",
      "compiler-programs",
      "host-libraries",
    ]);
    expect(draft.toolset.trees[0].source).toBe("${RUST_TOOLCHAIN}");
    for (const { profile_id } of out.profiles) {
      const record = resolveCawProfile(profile_id);
      const decisions = [record.base_policy, ...record.mounts.map((m) => m.policy)]
        .flatMap((p) => [...p.file_rules, ...p.command_rules])
        .map((r) => r.decision);
      expect(decisions.every((d) => d === "allow" || d === "deny")).toBe(true);
      expect(record.toolset.programs.some((p) => ["sudo", "su", "doas"].includes(p.name))).toBe(false);
    }
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
    expect(m.intent.gap_address).toBe("dev.test/alpha.v1");
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
