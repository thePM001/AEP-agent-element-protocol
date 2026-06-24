#!/usr/bin/env node
/** Lattice-gated frame builder (mirrors lattice-gated-fetch.ts). */
import { execFileSync } from "node:child_process";

export function buildLatticeFrame(event) {
  const bin = process.env.AEP_LATTICE_LOG_BIN || "aep-lattice-log";
  const out = execFileSync(bin, ["build-frame"], {
    input: JSON.stringify(event),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(out.trim());
}
