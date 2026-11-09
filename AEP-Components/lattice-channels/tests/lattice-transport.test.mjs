// Pure helpers of lattice-transport.mjs. Nothing here runs the aep-lattice-log binary or
// opens a socket: every case below returns or throws before any process or connection.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALLOWED_DOCK_PORTS,
  DOCK_SUFFIXES,
  EPSCOM_WRITING_RULES,
  assertUrlNotSsrf,
  dockPath,
  dockPaths,
  fixCcaDeclarativeClosings,
  fixPunctuationWordSpacing,
  fixSpacedHyphenClauseSeparators,
  latticeDockEndpoint,
  latticeGatedFetch,
  latticeStrictEnabled,
  normalizeDockPort,
  parseLatticeDockLine,
  resolveLatticeLogBin,
  sendLatticeFrame,
  sendLatticeLine,
  ssrfPolicyFromEnv,
  wasmSandboxSocket,
  writingRuleNamed,
  writingRuleTable,
} from "../lib/lattice-transport.mjs";

const lookup = (addrs) => () => addrs;

const savedEnv = new Map();

function setEnv(name, value) {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function restoreEnv() {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
}

describe("dock ports", () => {
  it("lists the four docking ports in order", () => {
    expect(ALLOWED_DOCK_PORTS).toEqual([
      "inference_engine",
      "validation_engine",
      "future_features",
      "regulation_module",
    ]);
    expect(DOCK_SUFFIXES.map((d) => d.suffix)).toEqual(["inference", "validation", "future", "regulation"]);
  });

  it("normalizeDockPort trims, defaults and rejects unknown ports", () => {
    expect(normalizeDockPort(" inference_engine ")).toBe("inference_engine");
    expect(normalizeDockPort(undefined)).toBe("validation_engine");
    expect(normalizeDockPort(null, "future_features")).toBe("future_features");
    expect(() => normalizeDockPort("wasm_sandbox")).toThrow(
      "invalid docking_port: wasm_sandbox; allowed: inference_engine, validation_engine, future_features, regulation_module",
    );
  });

  it("dockPath and dockPaths join the socket base with the suffix", () => {
    expect(dockPath("/run/aep/sockets", "regulation_module")).toBe("/run/aep/sockets/regulation");
    expect(() => dockPath("/run/aep/sockets", "bogus")).toThrow(/invalid docking_port/);
    expect(dockPaths("/s")).toEqual([
      { port: "inference_engine", path: "/s/inference" },
      { port: "validation_engine", path: "/s/validation" },
      { port: "future_features", path: "/s/future" },
      { port: "regulation_module", path: "/s/regulation" },
    ]);
  });

  it("wasmSandboxSocket honours WASM_SANDBOX_SOCKET", () => {
    expect(wasmSandboxSocket("/s", {})).toBe("/s/wasm_sandbox");
    expect(wasmSandboxSocket("/s", { WASM_SANDBOX_SOCKET: "/tmp/wasm.sock" })).toBe("/tmp/wasm.sock");
  });
});

describe("latticeDockEndpoint", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("returns the Unix socket path by default", () => {
    setEnv("AEP_LATTICE_TRANSPORT", undefined);
    expect(latticeDockEndpoint("/s", "inference")).toBe("/s/inference");
  });

  it("returns a tls endpoint with the per-dock port in tls mode", () => {
    setEnv("AEP_LATTICE_TRANSPORT", "tls");
    setEnv("AEP_LATTICE_TLS_HOST", "dock.example");
    expect(latticeDockEndpoint("/s", "inference")).toBe("tls://dock.example:28425");
    expect(latticeDockEndpoint("/s", "regulation")).toBe("tls://dock.example:28428");
    expect(latticeDockEndpoint("/s", "unknown")).toBe("tls://dock.example:28426");
  });
});

describe("strict mode and SSRF policy", () => {
  it("latticeStrictEnabled reads the injected env", () => {
    expect(latticeStrictEnabled({})).toBe(true);
    expect(latticeStrictEnabled({ AEP_LATTICE_STRICT: "0", AEP_LATTICE_STRICT_DEV: "1" })).toBe(false);
    expect(() => latticeStrictEnabled({ AEP_LATTICE_STRICT: "0" })).toThrow(/fail-closed/);
  });

  it("ssrfPolicyFromEnv reads both allow flags", () => {
    expect(ssrfPolicyFromEnv({ AEP_LATTICE_ALLOW_PRIVATE: "1" })).toEqual({
      allowLoopback: false,
      allowPrivate: true,
    });
  });

  it("assertUrlNotSsrf blocks internal targets and allows public ones", () => {
    expect(() => assertUrlNotSsrf("http://a.example/", lookup(["93.184.216.34"]), {})).not.toThrow();
    expect(() => assertUrlNotSsrf("http://a.example/", lookup(["10.9.8.7"]), {})).toThrow(
      "lattice-gated-fetch: private/metadata host blocked",
    );
    expect(() => assertUrlNotSsrf("http://0x7f000001/", lookup([]), {})).toThrow(
      "lattice-gated-fetch: loopback blocked",
    );
    expect(() => assertUrlNotSsrf("http://[::ffff:a9fe:a9fe]/", lookup([]), {})).toThrow(
      "lattice-gated-fetch: private/metadata host blocked",
    );
    expect(() => assertUrlNotSsrf("http://[::1]/", lookup([]), { AEP_LATTICE_ALLOW_LOOPBACK: "1" })).not.toThrow();
    expect(() => assertUrlNotSsrf("gopher://a.example/", lookup([]), {})).toThrow("blocked protocol gopher:");
  });

  it("latticeGatedFetch rejects an SSRF target before any dock work", async () => {
    await expect(latticeGatedFetch("/nonexistent", {}, "http://169.254.169.254/latest")).rejects.toThrow(
      "lattice-gated-fetch: private/metadata host blocked",
    );
  });
});

describe("resolveLatticeLogBin", () => {
  it("prefers AEP_LATTICE_LOG_BIN, then AEP_LATTICE_LOG_CLI", () => {
    expect(resolveLatticeLogBin({ AEP_LATTICE_LOG_BIN: "/opt/a", AEP_LATTICE_LOG_CLI: "/opt/b" })).toBe("/opt/a");
    expect(resolveLatticeLogBin({ AEP_LATTICE_LOG_CLI: "/opt/b" })).toBe("/opt/b");
  });

  it("falls back to a path ending in aep-lattice-log", () => {
    expect(resolveLatticeLogBin({})).toMatch(/aep-lattice-log$/);
  });
});

describe("parseLatticeDockLine", () => {
  it("parses a plain JSON line", () => {
    expect(parseLatticeDockLine(' {"ok":true,"n":1} ')).toEqual({ ok: true, n: 1 });
  });

  it("takes the first object out of concatenated JSON blobs", () => {
    expect(parseLatticeDockLine('{"ok":true,"a":{"b":1}}{"ok":false}')).toEqual({ ok: true, a: { b: 1 } });
  });

  it("throws on empty or non-JSON input", () => {
    expect(() => parseLatticeDockLine("")).toThrow("empty dock response");
    expect(() => parseLatticeDockLine(null)).toThrow("empty dock response");
    expect(() => parseLatticeDockLine("garbage")).toThrow(/Unexpected token/);
  });
});

describe("send guards", () => {
  let dir = "";
  afterEach(() => {
    restoreEnv();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("sendLatticeFrame refuses a frame without a signer", () => {
    expect(() => sendLatticeFrame("/s/validation", { a: 1 }, {})).toThrow(
      "signer_public_hex required for lattice dock send (fail-closed)",
    );
    expect(() => sendLatticeFrame("/s/validation", { a: 1 }, { signerPublicHex: "   " })).toThrow(/fail-closed/);
  });

  it("sendLatticeLine refuses a socket path that does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    const missing = join(dir, "validation");
    expect(() => sendLatticeLine(missing, "{}")).toThrow(`lattice socket not found: ${missing}`);
  });

  it("sendLatticeFrame with a signer reaches the missing-socket check", () => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    const missing = join(dir, "inference");
    expect(() => sendLatticeFrame(missing, { a: 1 }, { signer_public_hex: "ab".repeat(32) })).toThrow(
      `lattice socket not found: ${missing}`,
    );
  });

  it("tls transport requires cert, key and CA", () => {
    setEnv("AEP_LATTICE_TLS_CERT", undefined);
    setEnv("AEP_LATTICE_TLS_KEY", undefined);
    setEnv("AEP_LATTICE_TLS_CA", undefined);
    expect(() => sendLatticeLine("tls://dock.example:28426", "{}")).toThrow(
      "AEP_LATTICE_TRANSPORT=tls requires AEP_LATTICE_TLS_CERT, AEP_LATTICE_TLS_KEY, AEP_LATTICE_TLS_CA",
    );
  });
});

describe("prose fixers", () => {
  it("fixPunctuationWordSpacing adds the missing space after sentence marks", () => {
    expect(fixPunctuationWordSpacing("Ready?Go!Now")).toBe("Ready? Go! Now");
    expect(fixPunctuationWordSpacing("End.Next")).toBe("End. Next");
    expect(fixPunctuationWordSpacing(`Ok${String.fromCharCode(0xff1f)}Yes`)).toBe("Ok? Yes");
  });

  it("fixPunctuationWordSpacing leaves query strings and lower-case dots alone", () => {
    expect(fixPunctuationWordSpacing("see /path/?q=1&x=?y")).toBe("see /path/?q=1&x=?y");
    expect(fixPunctuationWordSpacing("file.txt and v2.0")).toBe("file.txt and v2.0");
    expect(fixPunctuationWordSpacing(undefined)).toBe("");
  });

  it("fixCcaDeclarativeClosings rewrites closing questions as statements", () => {
    expect(fixCcaDeclarativeClosings("Done.\nWhat would you like to do?")).toBe(
      "Done.\nTell me what you would like to do.",
    );
    expect(fixCcaDeclarativeClosings("How can I help you today?")).toBe("Tell me how I can help you today.");
    expect(fixCcaDeclarativeClosings("Would you like to see more?")).toBe("Tell me if you would like to see more.");
    expect(fixCcaDeclarativeClosings("What should we work on?")).toBe("Tell me what we should work on today.");
  });

  it("fixCcaDeclarativeClosings keeps ordinary questions", () => {
    expect(fixCcaDeclarativeClosings("Is the build green?")).toBe("Is the build green?");
  });

  it("fixSpacedHyphenClauseSeparators replaces spaced hyphens", () => {
    expect(fixSpacedHyphenClauseSeparators("Fast - The tool works")).toBe("Fast: The tool works");
    expect(fixSpacedHyphenClauseSeparators("**Speed - fast**")).toBe("**Speed: fast**");
    expect(fixSpacedHyphenClauseSeparators("left - right")).toBe("left right");
    expect(fixSpacedHyphenClauseSeparators("well-known value")).toBe("well-known value");
  });

  it("EPSCOM_WRITING_RULES states the Oxford comma rule", () => {
    expect(EPSCOM_WRITING_RULES).toContain("Never use Oxford commas");
  });
});

describe("writing rule table", () => {
  it("reads the constraint ids from AEP-Policy-System/reference/writing.gap", () => {
    const table = writingRuleTable();
    expect(table).toContain("no_em_dashes");
    expect(table).toContain("no_oxford_comma");
    expect(table.every((id) => /^[a-z0-9_]+$/.test(id))).toBe(true);
  });

  it("writingRuleNamed answers from that table", () => {
    expect(writingRuleNamed("no_double_hyphen")).toBe(true);
    expect(writingRuleNamed("not_a_rule")).toBe(false);
  });
});
