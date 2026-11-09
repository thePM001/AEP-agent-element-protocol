import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GRAPH_FILE,
  NODE_PALETTE,
  graphPath,
  loadGraph,
  mergePalette,
  sanitizeGraph,
  saveGraph,
  starterGraph,
  validateGraph,
} from "../lib/graph-store.mjs";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aep-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function node(id, type, extra = {}) {
  return { id, type, x: 0, y: 0, ...extra };
}

describe("starterGraph", () => {
  it("is a valid hub, two docks and one agent", () => {
    const g = starterGraph();
    expect(g.composer).toBe("composer-lite");
    expect(g.version).toBe("2.9.0");
    expect(g.nodes.map((n) => n.type)).toEqual(["lattice", "dock_validation", "dock_inference", "agent"]);
    expect(g.edges).toHaveLength(3);
    expect(validateGraph(g)).toBe(true);
  });

  it("returns a fresh object each call", () => {
    const a = starterGraph();
    a.nodes.push(node("extra", "agent"));
    expect(starterGraph().nodes).toHaveLength(4);
  });
});

describe("sanitizeGraph", () => {
  it("passes non objects through", () => {
    expect(sanitizeGraph(null)).toBeNull();
    expect(sanitizeGraph("x")).toBe("x");
  });

  it("drops dynaep nodes, nodes without id and canvas skip registry ids", () => {
    const g = sanitizeGraph({
      nodes: [
        node("hub", "lattice"),
        node("dyn", "dynaep"),
        { type: "agent" },
        node("gap", "component", { data: { registry_id: "gap" } }),
        node("cmp", "component", { data: { component_id: "lattice-memory" } }),
        node("ok", "component", { data: { registry_id: "mcp-security" } }),
      ],
      edges: [
        { id: "e1", from: "ok", to: "hub" },
        { id: "e2", from: "gap", to: "hub" },
        { id: "e3", from: "hub" },
      ],
      viewport: { x: 1, y: 2, scale: 3 },
    });
    expect(g.nodes.map((n) => n.id)).toEqual(["hub", "ok"]);
    expect(g.edges.map((e) => e.id)).toEqual(["e1"]);
    expect(g.viewport).toEqual({ x: 1, y: 2, scale: 3 });
  });

  it("renames the legacy validation dock label", () => {
    const g = sanitizeGraph({
      nodes: [
        node("a", "dock_validation", { label: "Validation Dock" }),
        node("b", "dock_validation"),
        node("c", "dock_validation", { label: "Custom" }),
      ],
      edges: [],
    });
    expect(g.nodes.map((n) => n.label)).toEqual(["kernel admit dock", "kernel admit dock", "Custom"]);
  });

  it("treats missing arrays as empty", () => {
    expect(sanitizeGraph({})).toEqual({ nodes: [], edges: [] });
  });
});

describe("saveGraph and loadGraph", () => {
  it("returns the starter graph when nothing is stored", () => {
    expect(loadGraph(dir)).toEqual(starterGraph());
  });

  it("round trips a saved graph and stamps version and time", () => {
    const g = { nodes: [node("hub", "lattice"), node("a", "agent")], edges: [{ id: "e", from: "a", to: "hub" }] };
    const record = saveGraph(dir, g);
    expect(record.version).toBe("2.9.0");
    expect(record.composer).toBe("composer-lite");
    expect(Number.isNaN(Date.parse(record.updated_at))).toBe(false);
    expect(graphPath(dir)).toBe(join(dir, GRAPH_FILE));
    const raw = readFileSync(graphPath(dir), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(graphPath(dir)).mode & 0o777).toBe(0o600);
    }
    const loaded = loadGraph(dir);
    expect(loaded.nodes.map((n) => n.id)).toEqual(["hub", "a"]);
    expect(loaded.edges).toEqual([{ id: "e", from: "a", to: "hub" }]);
  });

  it("creates the data directory when needed", () => {
    const nested = join(dir, "a", "b");
    saveGraph(nested, { nodes: [], edges: [] });
    expect(existsSync(join(nested, GRAPH_FILE))).toBe(true);
  });

  it("reads the legacy graph file when the current one is absent", () => {
    writeFileSync(
      join(dir, "wasm-composer-graph.json"),
      JSON.stringify({ composer: "wasm", nodes: [node("hub", "lattice")], edges: [] }),
    );
    const g = loadGraph(dir);
    expect(g.composer).toBe("composer-lite");
    expect(g.nodes.map((n) => n.id)).toEqual(["hub"]);
  });

  it("falls back to the starter graph for corrupt or empty files", () => {
    writeFileSync(graphPath(dir), "{not json");
    expect(loadGraph(dir)).toEqual(starterGraph());
    writeFileSync(graphPath(dir), JSON.stringify({ nodes: [], edges: [] }));
    expect(loadGraph(dir)).toEqual(starterGraph());
  });

  it("rewrites the stored graph when sanitizing removed nodes", () => {
    writeFileSync(
      graphPath(dir),
      JSON.stringify({
        nodes: [node("hub", "lattice"), node("d", "dynaep")],
        edges: [{ id: "e", from: "d", to: "hub" }],
      }),
    );
    const g = loadGraph(dir);
    expect(g.nodes.map((n) => n.id)).toEqual(["hub"]);
    const stored = JSON.parse(readFileSync(graphPath(dir), "utf8"));
    expect(stored.nodes.map((n) => n.id)).toEqual(["hub"]);
    expect(stored.edges).toEqual([]);
  });
});

describe("validateGraph", () => {
  it("rejects non objects and missing arrays", () => {
    expect(() => validateGraph(null)).toThrow("graph must be an object");
    expect(() => validateGraph({ nodes: [] })).toThrow("graph requires nodes[] and edges[]");
  });

  it("rejects bad nodes", () => {
    expect(() => validateGraph({ nodes: [{ id: 1, type: "a", x: 0, y: 0 }], edges: [] })).toThrow(
      "each node requires string id",
    );
    expect(() => validateGraph({ nodes: [{ id: "n", x: 0, y: 0 }], edges: [] })).toThrow("node n requires type");
    expect(() => validateGraph({ nodes: [{ id: "n", type: "a", x: "0", y: 0 }], edges: [] })).toThrow(
      "node n requires numeric x,y",
    );
  });

  it("rejects bad edges", () => {
    const nodes = [node("a", "agent")];
    expect(() => validateGraph({ nodes, edges: [{ id: "e", from: "a" }] })).toThrow("each edge requires id, from, to");
    expect(() => validateGraph({ nodes, edges: [{ id: "e", from: "a", to: "zz" }] })).toThrow(
      "edge e references unknown node",
    );
  });
});

describe("mergePalette", () => {
  it("appends new items, skips duplicates by key and items without type", () => {
    const merged = mergePalette(
      [{ type: "agent" }, { type: "component", registry_id: "x" }],
      [
        { type: "agent" },
        { type: "component", registry_id: "x" },
        { type: "component", registry_id: "y" },
        { registry_id: "no-type" },
      ],
    );
    expect(merged).toEqual([
      { type: "agent" },
      { type: "component", registry_id: "x" },
      { type: "component", registry_id: "y" },
    ]);
  });

  it("filters wasm_policy items and canvas skip registry ids", () => {
    const merged = mergePalette([{ type: "wasm_policy" }], [{ type: "component", registry_id: "gap" }]);
    expect(merged).toEqual([]);
  });

  it("keeps the shipped palette intact when merged with nothing", () => {
    expect(mergePalette(NODE_PALETTE)).toEqual(NODE_PALETTE);
    expect(NODE_PALETTE.some((p) => p.type === "wasm_policy")).toBe(false);
  });
});
