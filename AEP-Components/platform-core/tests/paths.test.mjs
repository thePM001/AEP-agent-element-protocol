import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultPaths,
  expandHome,
  resolveAepData,
  resolveBinary,
  resolveSocketBase,
} from "../lib/paths.mjs";

const KEYS = [
  "HOME",
  "AEP_DATA",
  "AEP_SOCKET_BASE",
  "AEP_BASE_NODE_BIN",
  "AEP_AEP_BASE_NODE_BIN",
  "AEP_AEP_LATTICE_LOG_BIN",
  "AEP_LATTICE_LOG_BIN",
  "AEP_LATTICE_LOG_CLI",
  "AEP_AEP_MEMORY_BIN",
];

let saved = {};
let home = "";

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  home = mkdtempSync(join(tmpdir(), "aep-"));
  process.env.HOME = home;
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(home, { recursive: true, force: true });
});

describe("expandHome", () => {
  it("expands a bare tilde and a tilde prefix", () => {
    expect(homedir()).toBe(home);
    expect(expandHome("~")).toBe(home);
    expect(expandHome("~/data/x")).toBe(join(home, "data/x"));
  });

  it("leaves other paths alone", () => {
    expect(expandHome("/abs/path")).toBe("/abs/path");
    expect(expandHome("rel/~/x")).toBe("rel/~/x");
    expect(expandHome("~user/x")).toBe("~user/x");
  });
});

describe("resolveAepData and resolveSocketBase", () => {
  it("default to ~/.aep and its sockets folder", () => {
    expect(resolveAepData()).toBe(join(home, ".aep"));
    expect(resolveSocketBase("/d")).toBe("/d/sockets");
  });

  it("honour AEP_DATA and AEP_SOCKET_BASE", () => {
    process.env.AEP_DATA = "/srv/aep";
    process.env.AEP_SOCKET_BASE = "/run/aep";
    expect(resolveAepData()).toBe("/srv/aep");
    expect(resolveSocketBase("/ignored")).toBe("/run/aep");
  });

  it("treats an empty AEP_DATA as unset", () => {
    process.env.AEP_DATA = "";
    expect(resolveAepData()).toBe(join(home, ".aep"));
  });
});

describe("resolveBinary", () => {
  it("defaults to /usr/local/bin/<name>", () => {
    expect(resolveBinary()).toBe("/usr/local/bin/aep-base-node");
    expect(resolveBinary("aep-memory")).toBe("/usr/local/bin/aep-memory");
  });

  it("reads the generic AEP_<NAME>_BIN key first", () => {
    process.env.AEP_AEP_MEMORY_BIN = "/opt/mem";
    process.env.AEP_AEP_LATTICE_LOG_BIN = "/opt/generic-log";
    process.env.AEP_LATTICE_LOG_BIN = "/opt/log";
    expect(resolveBinary("aep-memory")).toBe("/opt/mem");
    expect(resolveBinary("aep-lattice-log")).toBe("/opt/generic-log");
  });

  it("reads the short base node and lattice log keys", () => {
    process.env.AEP_BASE_NODE_BIN = "/opt/node";
    process.env.AEP_LATTICE_LOG_CLI = "/opt/cli";
    expect(resolveBinary("aep-base-node")).toBe("/opt/node");
    expect(resolveBinary("aep-lattice-log")).toBe("/opt/cli");
    process.env.AEP_LATTICE_LOG_BIN = "/opt/bin";
    expect(resolveBinary("aep-lattice-log")).toBe("/opt/bin");
  });

  it("does not apply the short keys to other binaries", () => {
    process.env.AEP_BASE_NODE_BIN = "/opt/node";
    expect(resolveBinary("aep-memory")).toBe("/usr/local/bin/aep-memory");
  });
});

describe("defaultPaths", () => {
  it("derives every path from the data folder", () => {
    const data = join(home, ".aep");
    expect(defaultPaths()).toEqual({
      dataDir: data,
      configPath: join(data, "base-node.json"),
      envPath: join(data, "lattice-channel.env"),
      activationPath: join(data, "activation.json"),
      latticeDb: join(data, "action-lattice.db"),
      socketBase: join(data, "sockets"),
      baseNodeBin: "/usr/local/bin/aep-base-node",
      latticeLogBin: "/usr/local/bin/aep-lattice-log",
      memoryBin: "/usr/local/bin/aep-memory",
    });
  });

  it("follows the env overrides", () => {
    process.env.AEP_DATA = "/srv/aep";
    process.env.AEP_SOCKET_BASE = "/run/aep";
    process.env.AEP_LATTICE_LOG_BIN = "/opt/log";
    const p = defaultPaths();
    expect(p.configPath).toBe("/srv/aep/base-node.json");
    expect(p.socketBase).toBe("/run/aep");
    expect(p.latticeLogBin).toBe("/opt/log");
  });
});
