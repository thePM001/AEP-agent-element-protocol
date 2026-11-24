#!/usr/bin/env node
// Emit lib/lattice-gated-fetch.js from its one source lib/lattice-gated-fetch.ts.
//
//   node AEP-Components/lattice-channels/scripts/gated-fetch-emit.mjs          writes the file
//   node AEP-Components/lattice-channels/scripts/gated-fetch-emit.mjs --check  fails when the
//                                                                               committed file
//                                                                               is not a fresh emit
//
// Both modes compile with tsconfig.emit.json into a fresh temporary folder, so the check
// and the build run the same compiler with the same options.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const COMPONENT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(COMPONENT, "tsconfig.emit.json");
const EMITTED = join(COMPONENT, "lib", "lattice-gated-fetch.js");

function formatDiagnostics(diagnostics) {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => COMPONENT,
    getNewLine: () => "\n",
  });
}

/** Compile the one source into a temporary folder and return the emitted text. */
export function emitGatedFetch() {
  const read = ts.readConfigFile(CONFIG, ts.sys.readFile);
  if (read.error) throw new Error(formatDiagnostics([read.error]));
  const outDir = mkdtempSync(join(tmpdir(), "aep-gated-fetch-"));
  try {
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, COMPONENT, { outDir });
    if (parsed.errors.length > 0) throw new Error(formatDiagnostics(parsed.errors));
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
    const result = program.emit();
    const diagnostics = [...ts.getPreEmitDiagnostics(program), ...result.diagnostics];
    if (diagnostics.length > 0) throw new Error(formatDiagnostics(diagnostics));
    return readFileSync(join(outDir, "lattice-gated-fetch.js"), "utf8");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function main(argv) {
  const check = argv.includes("--check");
  const fresh = emitGatedFetch();
  if (!check) {
    writeFileSync(EMITTED, fresh);
    process.stdout.write(`wrote ${EMITTED}\n`);
    return 0;
  }
  const committed = existsSync(EMITTED) ? readFileSync(EMITTED, "utf8") : "";
  if (committed !== fresh) {
    process.stderr.write(
      `${EMITTED} is not the emit of lattice-gated-fetch.ts. Run npm run build:gated-fetch and commit the result.\n`,
    );
    return 1;
  }
  process.stdout.write("ok lattice-gated-fetch.js matches a fresh emit of lattice-gated-fetch.ts\n");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
