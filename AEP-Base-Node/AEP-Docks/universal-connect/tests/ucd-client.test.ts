import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureUcdManifest,
  loadUcdModuleSpec,
  mapUpstreamToEgressPath,
  resolveTaskManifestDir,
  resolveUcbApiKey,
  ucdDownload,
  ucdFetch,
  ucdFetchJson,
} from "../lib/ucd-client.mjs";

const SAVED = { ...process.env };
let dir = "";
let server: Server | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aep-ucd-test-"));
  delete process.env.UCB_API_KEY;
  delete process.env.AEP_TASK_MANIFEST_DIR;
});

afterEach(async () => {
  process.env = { ...SAVED };
  rmSync(dir, { recursive: true, force: true });
  const s = server;
  server = null;
  if (s) await new Promise<void>((done) => s.close(() => done()));
});

function writeSpec(id: string, body: Record<string, unknown>): string {
  const modules = join(dir, "modules");
  mkdirSync(modules, { recursive: true });
  writeFileSync(join(modules, `${id}.json`), JSON.stringify(body));
  return modules;
}

const SPEC = {
  module_id: "weather",
  agent_id: "agent-w",
  egress: { routes: [{ upstream: "https://api.example.com/", path_prefix: "/weather" }, { path_prefix: "/any" }] },
};

/** A fake UCB: a health route and an egress route that records what it got. */
async function fakeUcb(seen: { url?: string; headers?: IncomingHttpHeaders }[]): Promise<string> {
  server = createServer((req, res) => {
    if (req.url === "/health") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ service: "ucb-universal-connect-bridge" }));
      return;
    }
    seen.push({ ...(req.url ? { url: req.url } : {}), headers: req.headers });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  const s = server;
  await new Promise<void>((done) => s.listen(0, "127.0.0.1", () => done()));
  const { port } = s.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("module spec", () => {
  it("refuses an id that is not a plain name", () => {
    for (const bad of ["../x", "a/b", "", ".hidden", "A"]) {
      expect(() => loadUcdModuleSpec(bad, dir)).toThrow(/not a plain name/);
    }
  });

  it("refuses a spec whose module_id is not its own id and keeps only complete routes", () => {
    const modules = writeSpec("weather", SPEC);
    writeSpec("other", { module_id: "weather" });
    expect(() => loadUcdModuleSpec("other", modules)).toThrow(/module_id is other/);
    expect(() => loadUcdModuleSpec("absent", modules)).toThrow(/not found/);
    expect(loadUcdModuleSpec("weather", modules).egress?.routes).toEqual([{ upstream: "https://api.example.com/", path_prefix: "/weather" }]);
  });
});

describe("egress mapping", () => {
  const spec = { module_id: "weather", egress: { routes: [{ upstream: "https://api.example.com/", path_prefix: "/weather/" }] } };

  it("maps a URL under the upstream at a path boundary", () => {
    expect(mapUpstreamToEgressPath(spec, "https://api.example.com/v1/now?q=1")).toBe("/weather/v1/now?q=1");
    expect(mapUpstreamToEgressPath(spec, "https://api.example.com")).toBe("/weather");
  });

  it("refuses a host that only starts with the upstream text", () => {
    expect(() => mapUpstreamToEgressPath(spec, "https://api.example.com.evil.net/x")).toThrow(/no egress route/);
    expect(() => mapUpstreamToEgressPath(spec, "https://api.example.comx/")).toThrow(/no egress route/);
    expect(() => mapUpstreamToEgressPath({ module_id: "m", egress: { routes: [{ upstream: "", path_prefix: "/p" }] } }, "https://a/")).toThrow(/no egress route/);
  });
});

describe("keys and manifests", () => {
  it("reads the UCB key from the environment or the data folder and nothing else", () => {
    expect(resolveUcbApiKey(undefined)).toBeNull();
    expect(resolveUcbApiKey(dir)).toBeNull();
    writeFileSync(join(dir, "ucb-api-key.json"), JSON.stringify({ api_key: "k1" }));
    expect(resolveUcbApiKey(`${dir}/`)).toBe("k1");
    writeFileSync(join(dir, "ucb-api-key.json"), JSON.stringify({ api_key: 5 }));
    expect(resolveUcbApiKey(dir)).toBeNull();
    process.env.UCB_API_KEY = "env";
    expect(resolveUcbApiKey(dir)).toBe("env");
  });

  it("writes the provisional manifest once with mode 600", () => {
    expect(resolveTaskManifestDir(dir)).toBe(join(dir, "ucb", "manifests"));
    const first = ensureUcdManifest({ module_id: "weather", agent_id: "agent/../w" }, dir);
    expect(first.created).toBe(true);
    expect(first.path).toBe(join(dir, "ucb", "manifests", "agent____w.json"));
    expect(statSync(first.path).mode & 0o777).toBe(0o600);
    const body = JSON.parse(readFileSync(first.path, "utf8")) as { trust?: unknown; provisional: boolean };
    // The manifest is provisional and carries no trust field: AEP has no trust tiers.
    expect(body.provisional).toBe(true);
    expect(body.trust).toBeUndefined();
    expect(ensureUcdManifest({ module_id: "weather", agent_id: "agent/../w" }, dir).created).toBe(false);
  });
});

describe("fetch through the UCB", () => {
  it("sends the key and the agent id that no caller header can replace", async () => {
    const seen: { url?: string; headers?: IncomingHttpHeaders }[] = [];
    const base = await fakeUcb(seen);
    const modules = writeSpec("weather", SPEC);
    const r = await ucdFetchJson("weather", "https://api.example.com/v1/now", {
      modulesDir: modules,
      dataDir: dir,
      ucbBase: base,
      ucbApiKey: "secret",
      headers: { Authorization: "Bearer stolen", "X-AEP-Agent-Id": "someone", "X-Extra": "1" },
    });
    expect(r.transport).toBe("ucd-ucb-egress");
    expect(seen[0]?.url).toBe("/ucb/v1/egress/weather/v1/now");
    expect(seen[0]?.headers?.authorization).toBe("Bearer secret");
    expect(seen[0]?.headers?.["x-aep-agent-id"]).toBe("agent-w");
    expect(seen[0]?.headers?.["x-extra"]).toBe("1");
  });

  it("downloads a body to a file", async () => {
    const base = await fakeUcb([]);
    const modules = writeSpec("weather", SPEC);
    const dest = join(dir, "out.json");
    const r = await ucdDownload("weather", "https://api.example.com/file", dest, { modulesDir: modules, dataDir: dir, ucbBase: base, ucbApiKey: "k" });
    expect(r.transport).toBe("ucd-ucb-egress");
    expect(JSON.parse(readFileSync(dest, "utf8"))).toEqual({ ok: true, path: "/ucb/v1/egress/weather/file" });
  });

  it("fails when the UCB is down and no lattice socket is given", async () => {
    const modules = writeSpec("weather", SPEC);
    // A port that held a server a moment ago and now holds none.
    const down = createServer();
    await new Promise<void>((done) => down.listen(0, "127.0.0.1", () => done()));
    const { port } = down.address() as AddressInfo;
    await new Promise<void>((done) => down.close(() => done()));
    await expect(
      ucdFetch("weather", "https://api.example.com/x", { modulesDir: modules, dataDir: dir, ucbBase: `http://127.0.0.1:${port}`, ucbApiKey: "k" }),
    ).rejects.toThrow(/UCB unavailable and no socketBase/);
  });
});
