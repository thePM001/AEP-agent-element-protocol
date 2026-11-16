import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateManifest,
  validateCatalogEntry,
  validateFullCatalog,
} from "../../../AEP-Base-Node/AEP-Registry/lib/manifest-validator.mjs";
import { loadLocalCatalog, loadComponentManifest } from "../../../AEP-Base-Node/AEP-Registry/lib/registry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** A retired manifest: the id is kept, nothing ships. */
function retiredManifest(extra = {}) {
  return {
    manifest_version: "1",
    id: "old-sandbox",
    version: "2.9.0",
    kind: "daemon",
    status: "retired",
    description: "Retired.",
    requires: [],
    capabilities: [],
    actions: [],
    setup_hooks: [],
    resource_requirements: { min_memory_mb: 0, min_disk_mb: 0, requires_internet: false, gpu_required: false },
    cca: { summary: "Retired.", use_when: [], avoid_when: ["always"] },
    implementation: {},
    ...extra,
  };
}

function retiredEntry(extra = {}) {
  return {
    id: "old-sandbox",
    kind: "daemon",
    status: "retired",
    bundled: false,
    default_enabled: false,
    manifest: "x.json",
    ...extra,
  };
}

describe("retired registry components", () => {
  it("accepts a retired manifest with no path", () => {
    expect(validateManifest(retiredManifest())).toEqual({ valid: true, errors: [] });
  });

  it("refuses a retired manifest that still offers a path, an action, a setup hook or an implementation", () => {
    const errors = validateManifest(
      retiredManifest({
        path: "old/",
        actions: [{ id: "start", description: "Start the old sandbox" }],
        setup_hooks: [{ id: "hook" }],
        implementation: { binary: "old/bin" },
      }),
    ).errors;
    expect(errors).toEqual([
      "a retired component has no path",
      "a retired component offers no actions",
      "a retired component has no setup hooks",
      "a retired component has no implementation",
    ]);
  });

  it("still requires a path on a component that is not retired", () => {
    const { status: _status, ...active } = retiredManifest();
    expect(validateManifest(active).errors).toContain("missing required field: path");
  });

  it("refuses an unknown status", () => {
    expect(validateManifest(retiredManifest({ status: "gone" })).errors[0]).toBe(
      "status must be one of active, experimental, retired",
    );
  });

  it("accepts a retired catalog entry that is neither bundled nor enabled and has no path", () => {
    expect(validateCatalogEntry(retiredEntry(), retiredManifest()).errors).toEqual([]);
  });

  it("refuses a retired catalog entry that is bundled, has a path or carries an active manifest", () => {
    const { status: _status, ...active } = retiredManifest({ path: "old/" });
    const errors = validateCatalogEntry(retiredEntry({ bundled: true, path: "old/" }), active).errors;
    expect(errors).toContain("retired catalog entry old-sandbox has a path");
    expect(errors).toContain("retired catalog entry old-sandbox must set bundled and default_enabled to false");
    expect(errors).toContain("retired catalog entry old-sandbox needs a retired manifest");
  });

  it("validates the catalog of this tree with caw-framework retired", () => {
    const catalog = loadLocalCatalog(ROOT);
    const caw = catalog.components.find((c) => c.id === "caw-framework");
    expect(caw.status).toBe("retired");
    const full = validateFullCatalog(catalog, ROOT, (p) => loadComponentManifest(p, ROOT));
    expect(full.results.filter((r) => !r.valid)).toEqual([]);
  });
});
