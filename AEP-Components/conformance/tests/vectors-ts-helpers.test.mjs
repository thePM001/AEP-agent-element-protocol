// The TypeScript helpers run the language neutral conformance vectors. The Rust kernel
// is normative. These helpers implement the dock-socket suite on their own and reach
// the writing suite through the kernel binary, as every TypeScript caller does.

import { basename, dirname } from "node:path";
import {
  ALLOWED_DOCK_PORTS,
  dockPath,
  epscomLintWriting,
  epscomValidateWriting,
} from "../../lattice-channels/lib/lattice-transport.mjs";
import { latticeLogBin, loadVectorSuites } from "./support/paths.mjs";

const SUITES = loadVectorSuites();
const BASE = "/aep-socket-base";

describe("vectors typescript helpers", () => {
  it("vectors format version 1 carries the suites these helpers run", () => {
    expect(Object.keys(SUITES)).toEqual(
      expect.arrayContaining(["dock-socket", "dock-request", "dock-answer", "mesh-mode", "writing"]),
    );
  });

  describe("vectors dock-socket", () => {
    it.each(SUITES["dock-socket"].cases.map((c) => [c.id, c]))("%s", (_id, c) => {
      if (c.expect.error === "unknown_dock") {
        expect(() => dockPath(BASE, c.input.port)).toThrow(/invalid docking_port/);
        expect(ALLOWED_DOCK_PORTS).not.toContain(c.input.port);
        return;
      }
      const path = dockPath(BASE, c.input.port);
      expect(dirname(path)).toBe(BASE);
      expect(basename(path)).toBe(c.expect.suffix);
    });
  });

  describe("vectors writing", () => {
    it.each(SUITES.writing.cases.map((c) => [c.id, c]))("%s", (_id, c) => {
      const opts = { latticeLogBin: latticeLogBin() };
      const lint = epscomLintWriting(c.input.text, opts);
      expect(lint.violations.map((v) => ({ rule: v.rule, line: v.line ?? null }))).toEqual(
        c.expect.violations,
      );
      const enforced = epscomValidateWriting(c.input.text, opts);
      expect(enforced.text).toBe(c.expect.fixed);
      expect(enforced.ok).toBe(c.expect.ok_after_fix);
    });
  });
});
