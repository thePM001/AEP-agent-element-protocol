import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectRequiresCycle,
  existsInside,
  validateCatalogEntry,
  validateFullCatalog,
  validateManifest,
} from "../lib/manifest-validator.mjs";
import {
  asCatalog,
  groupComponentsByKind,
  insideRepo,
  loadComponentManifest,
  loadInstalledExtensions,
  loadLocalCatalog,
  mergeCatalogs,
  remoteCatalogUrl,
  resolvePaletteExtensions,
  syncLrpsFromComponents,
  writeInstalledExtensions,
} from "../lib/registry.mjs";
import {
  collectSetupHooks,
  componentIdsFromPlan,
  connectorsFromPlan,
  mergePolicySections,
} from "../lib/setup-hooks.mjs";
import { SEED_MANIFESTS, materialize, planMaterialize } from "../scripts/materialize-manifests-v1.mjs";

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const temps: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "aep-registry-test-"));
  temps.push(d);
  return d;
}

afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function manifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifest_version: "1",
    id: "comp-a",
    version: "2.9.0",
    kind: "library",
    path: "AEP-Base-Node/",
    description: "d",
    requires: [],
    capabilities: [],
    actions: [{ id: "x", description: "y" }],
    setup_hooks: [{ id: "h" }],
    resource_requirements: { min_memory_mb: 1, min_disk_mb: 1, requires_internet: false, gpu_required: false },
    cca: { summary: "s", use_when: [], avoid_when: [] },
    implementation: { module: "m" },
    ...over,
  };
}

describe("manifest validator", () => {
  it("accepts a complete manifest and names every missing field", () => {
    expect(validateManifest(manifest(), { repoRoot: REPO })).toEqual({ valid: true, errors: [] });
    const r = validateManifest({ manifest_version: "1" });
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining(["missing required field: id", "requires must be an array"]));
    expect(validateManifest(null).errors).toEqual(["manifest must be an object"]);
    expect(validateManifest([]).errors).toEqual(["manifest must be an object"]);
  });

  it("holds a retired component to no path, action, hook or implementation", () => {
    const r = validateManifest(manifest({ status: "retired" }));
    expect(r.errors).toEqual(expect.arrayContaining([
      "a retired component has no path",
      "a retired component offers no actions",
      "a retired component has no setup hooks",
      "a retired component has no implementation",
    ]));
    expect(validateManifest(manifest({ status: "gone" })).errors[0]).toMatch(/status must be one of/);
  });

  it("refuses a path that leaves the repository even when it exists", () => {
    const outside = "../".repeat(20) + "etc";
    expect(existsInside(REPO, outside)).toBe(false);
    expect(existsInside(REPO, "/etc")).toBe(false);
    expect(existsInside(REPO, "AEP-Base-Node")).toBe(true);
    const r = validateManifest(manifest({ path: outside }), { repoRoot: REPO });
    expect(r.errors).toContain(`path does not exist inside the repository: ${outside}`);
  });

  it("finds a requires cycle through the catalog index", () => {
    const index = new Map([["a", ["b"]], ["b", ["c"]], ["c", ["a"]]]);
    expect(detectRequiresCycle("a", ["b"], index)).toEqual(["a", "b", "c", "a"]);
    expect(detectRequiresCycle("a", ["x"], index)).toBeNull();
    const r = validateManifest(manifest({ id: "a", requires: ["b"] }), { manifestIndex: index });
    expect(r.errors).toContain("requires cycle detected: a -> b -> c -> a");
  });

  it("reports an unknown requires, a duplicate id and a missing template manifest", () => {
    const catalog = {
      components: [
        { id: "comp-a", manifest: "m/a.json", path: "AEP-Base-Node/" },
        { id: "comp-a", manifest: "m/a.json", path: "AEP-Base-Node/" },
        { id: "tpl", manifest: "m/missing.json", kind: "template", bundled: false },
      ],
    };
    const load = (p: string): unknown => (p === "m/a.json" ? manifest({ requires: ["nowhere"] }) : null);
    const r = validateFullCatalog(catalog, REPO, load);
    expect(r.valid).toBe(false);
    const all = r.results.flatMap((x) => x.errors);
    expect(all).toContain("comp-a requires nowhere, which no catalog row names");
    expect(all).toContain("catalog id comp-a appears twice");
    expect(all).toContain("manifest not loaded for template tpl");
  });

  it("compares the catalog entry with its manifest", () => {
    const r = validateCatalogEntry({ id: "comp-b", manifest: "m", path: "AEP-Base-Node/" }, manifest(), REPO);
    expect(r.errors).toContain("manifest id comp-a != catalog id comp-b");
    const retired = validateCatalogEntry({ id: "comp-a", manifest: "m", status: "retired", bundled: true }, manifest(), REPO);
    expect(retired.errors).toEqual(expect.arrayContaining([
      "retired catalog entry comp-a must set bundled and default_enabled to false",
      "retired catalog entry comp-a needs a retired manifest",
    ]));
  });

  it("the shipped catalog validates", () => {
    const catalog = loadLocalCatalog(REPO);
    const r = validateFullCatalog(catalog, REPO, (p: string) => loadComponentManifest(p, REPO));
    expect(r.invalid).toEqual([]);
    expect(r.total).toBe(catalog.components.length);
  });
});

describe("registry loader", () => {
  it("keeps a manifest path inside the repository", () => {
    expect(insideRepo("AEP-Base-Node/AEP-Registry/catalog.json", REPO)).toBe(join(REPO, "AEP-Base-Node/AEP-Registry/catalog.json"));
    expect(insideRepo("../outside.json", REPO)).toBeNull();
    expect(insideRepo("/etc/passwd", REPO)).toBeNull();
    expect(() => loadComponentManifest("/etc/passwd", REPO)).toThrow(/leaves the repository/);
    expect(() => loadComponentManifest("../../../../../../etc/hostname", REPO)).toThrow(/leaves the repository/);
    expect(loadComponentManifest("AEP-Base-Node/AEP-Registry/components/no-such.json", REPO)).toBeNull();
  });

  it("refuses a manifest that is not a JSON object", () => {
    const d = tempDir();
    writeFileSync(join(d, "m.json"), "[1,2]");
    writeFileSync(join(d, "bad.json"), "{");
    expect(() => loadComponentManifest("m.json", d)).toThrow(/not a JSON object/);
    expect(() => loadComponentManifest("bad.json", d)).toThrow(/failed to parse manifest/);
  });

  it("a remote catalog adds components that are neither bundled, enabled nor pointed at a file", () => {
    const local = asCatalog({ components: [{ id: "a", bundled: true }] }, "local");
    const remote = asCatalog(
      { components: [{ id: "a", bundled: false }, { id: "evil", bundled: true, default_enabled: true, manifest: "../../../../etc/passwd" }] },
      "remote",
    );
    const merged = mergeCatalogs(local, remote);
    expect(merged.components).toEqual([{ id: "a", bundled: true }, { id: "evil", bundled: false, default_enabled: false }]);
    expect(mergeCatalogs(local, null)).toBe(local);
  });

  it("refuses a catalog without a components list and drops rows without an id", () => {
    expect(() => asCatalog({}, "x")).toThrow(/needs a components list/);
    expect(asCatalog({ components: [{ id: "" }, { name: "n" }, { id: "ok" }] }, "x").components).toEqual([{ id: "ok" }]);
  });

  it("builds the raw catalog URL of a GitHub repository and of any other host", () => {
    expect(remoteCatalogUrl("https://github.com/o/r/")).toBe("https://raw.githubusercontent.com/o/r/main/AEP-Base-Node/AEP-Registry/catalog.json");
    expect(remoteCatalogUrl("https://git.example/o/r", "dev")).toBe("https://git.example/o/r/AEP-Base-Node/AEP-Registry/catalog.json");
  });

  it("groups by kind with any kind name as an ordinary key", () => {
    const groups = groupComponentsByKind([{ kind: "constructor" }, { kind: "__proto__" }, {}]);
    expect(Object.keys(groups).sort()).toEqual(["__proto__", "constructor", "other"]);
    expect(groups.constructor).toHaveLength(1);
  });

  it("writes the installed extensions with mode 600 and reads only well formed rows", () => {
    const d = tempDir();
    expect(loadInstalledExtensions(d)).toEqual({ version: "1", installed: [] });
    writeInstalledExtensions(d, [{ id: "x" }]);
    const path = join(d, "extensions", "installed.json");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadInstalledExtensions(d).installed).toEqual([{ id: "x" }]);
    writeFileSync(path, JSON.stringify({ installed: [{ id: 3 }, "x", { id: "y" }] }));
    expect(loadInstalledExtensions(d).installed).toEqual([{ id: "y" }]);
    writeFileSync(path, "not json");
    expect(loadInstalledExtensions(d)).toEqual({ version: "1", installed: [] });
  });

  it("collects the LRPs of the chosen components", () => {
    const components = [
      { id: "a", lrp_id: "lrp-a", manifest: { setup_hooks: [{ id: "h", setup_hook: "sync_lrp", params: { lrp_id: "lrp-h" } }] } },
      { id: "b", manifest: { lrp_id: "lrp-b" } },
    ];
    expect(syncLrpsFromComponents(["a"], components, ["old"]).sort()).toEqual(["lrp-a", "lrp-h", "old"]);
  });

  it("builds the composer palette of the shipped tree with one entry per key", () => {
    const palette = resolvePaletteExtensions(tempDir(), REPO);
    expect(palette.length).toBeGreaterThan(0);
    const keys = palette.map((p) => `${String(p.catalog_id)}:${String(p.type)}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(palette.every((p) => p.source === "bundled")).toBe(true);
  });
});

describe("setup hooks", () => {
  const components = [
    {
      id: "a",
      manifest: {
        setup_hooks: [
          { id: "h1", policy_section: "budget", default: { cap: 10, warn: 5 } },
          { id: "h2", policy_section: "__proto__", default: { polluted: true } },
        ],
        actions: [{ id: "x", setup_hook: "sync_lrp", params: { lrp_id: "lrp-x" } }],
      },
    },
  ];

  it("collects hooks, LRPs and section defaults without touching any prototype", () => {
    const c = collectSetupHooks(["a", "missing"], components);
    expect(c.hooks.map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(c.lrps).toEqual(["lrp-x"]);
    expect(c.policy_sections.budget).toEqual({ cap: 10, warn: 5 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("merges a plan override into a section key by key", () => {
    const c = collectSetupHooks(["a"], components);
    const merged = mergePolicySections(c.policy_sections, { budget: { cap: 20 }, extra: 1 });
    expect(merged.budget).toEqual({ cap: 20, warn: 5 });
    expect(merged.extra).toBe(1);
    expect(mergePolicySections({ a: { x: 1 } }, null)).toEqual({ a: { x: 1 } });
  });

  it("reads the enabled components and connectors of a plan", () => {
    const plan = {
      components: [
        { id: "a", enabled: true },
        { id: "b", enabled: false },
        { id: "connector-x", enabled: true, config: { url: "u" } },
        { id: 7, enabled: true },
      ],
      connectors: { "connector-y": { url: "v" } },
    };
    expect(componentIdsFromPlan(plan)).toEqual(["a", "connector-x"]);
    expect(connectorsFromPlan(plan)).toEqual({ "connector-x": { url: "u" }, "connector-y": { url: "v" } });
    expect(componentIdsFromPlan(null)).toEqual([]);
    expect(connectorsFromPlan("x")).toEqual({});
  });
});

describe("manifest materializer", () => {
  it("changes nothing in the shipped tree and never writes a manifest without a catalog row", () => {
    const plan = planMaterialize(REPO);
    expect(plan.write).toEqual([]);
    expect(plan.unseeded).toEqual([]);
    expect(plan.uncataloged).toContain("connector-postgres");
  });

  it("writes a seed only for a cataloged id whose manifest is missing and never overwrites", () => {
    const d = tempDir();
    const comps = join(d, "AEP-Base-Node/AEP-Registry/components");
    mkdirSync(comps, { recursive: true });
    const seeded = Object.keys(SEED_MANIFESTS).find((id) => id !== "connector-postgres") ?? "";
    writeFileSync(
      join(d, "AEP-Base-Node/AEP-Registry/catalog.json"),
      JSON.stringify({ components: [{ id: seeded }, { id: "kept" }, { id: "no-seed" }, { id: "../escape" }] }),
    );
    writeFileSync(join(comps, "kept.json"), '{"mine":true}\n');
    const lines: string[] = [];
    const plan = materialize(d, (l) => lines.push(l));
    expect(plan.write.map((w) => w.id)).toEqual([seeded]);
    expect(plan.kept).toEqual(["kept"]);
    expect(plan.unseeded).toEqual(["no-seed"]);
    expect(readFileSync(join(comps, "kept.json"), "utf8")).toBe('{"mine":true}\n');
    expect(JSON.parse(readFileSync(join(comps, `${seeded}.json`), "utf8"))).toEqual(SEED_MANIFESTS[seeded]);
    expect(existsSync(join(d, "AEP-Base-Node/AEP-Registry/escape.json"))).toBe(false);
    expect(lines.at(-1)).toMatch(/Materialized 1 manifests, kept 1/);
  });
});
