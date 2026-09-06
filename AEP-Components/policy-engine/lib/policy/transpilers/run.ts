import { readFileSync, writeFileSync } from "node:fs";
import { transpileCedarToGap } from "./cedar-to-gap.js";
import { transpileRegoToGap } from "./rego-to-gap.js";
import { transpileGapToCedar } from "./gap-to-cedar.js";
import { transpileGapToRego } from "./gap-to-rego.js";

function argValue(argv: string[], name: string): string {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) {
    return "";
  }
  return argv[i + 1];
}

function main(argv: string[]): void {
  const input = argv[0];
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("usage: run.ts <input> --from <cedar|rego|gap> --to <gap|cedar|rego> --output <path>");
  }
  const from = argValue(argv, "--from");
  const to = argValue(argv, "--to");
  const output = argValue(argv, "--output");
  if (from.length === 0 || to.length === 0 || output.length === 0) {
    throw new Error("usage: run.ts <input> --from <cedar|rego|gap> --to <gap|cedar|rego> --output <path>");
  }
  const src = readFileSync(input, "utf8");
  let out = "";
  if (from === "cedar" && to === "gap") {
    out = transpileCedarToGap(src);
  } else if (from === "rego" && to === "gap") {
    out = transpileRegoToGap(src);
  } else if (from === "gap" && to === "cedar") {
    out = transpileGapToCedar(src);
  } else if (from === "gap" && to === "rego") {
    out = transpileGapToRego(src);
  } else {
    throw new Error("unsupported transpile pair " + from + " -> " + to);
  }
  writeFileSync(output, out, { encoding: "utf8" });
}

main(process.argv.slice(2));
