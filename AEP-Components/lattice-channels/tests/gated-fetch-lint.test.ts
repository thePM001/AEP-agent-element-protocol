// The fetch bypass checks of the lattice channel client are lint rules of the repository
// ESLint config, enforced by the zero warning lint step. These tests run that config on
// the two bypass forms the source text check missed and on the shipped files.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LIB = join(ROOT, "AEP-Components", "lattice-channels", "lib");
const SOURCE = join(LIB, "lattice-gated-fetch.ts");
const EMITTED = join(LIB, "lattice-gated-fetch.js");

const eslint = new ESLint({ cwd: ROOT });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "fatal");
}

describe("fetch bypass lint rules of the lattice channel client", () => {
  it.each([
    ['globalThis["fetch"](url);', "no-restricted-properties"],
    ["const f = fetch;\nf(url);", "no-restricted-globals"],
    ["globalThis.fetch(url);", "no-restricted-properties"],
    ["fetch(url);", "no-restricted-globals"],
    ['Reflect.get(globalThis, "fetch")(url);', "no-restricted-syntax"],
  ])("%s fails lint", async (call, rule) => {
    const code = `export function bypass(url) {\n  ${call}\n  return url;\n}\n`;
    for (const file of [SOURCE, EMITTED]) {
      expect(await ruleIds(code, file)).toContain(rule);
    }
  }, 60000);

  it("the source and its emitted file lint clean", async () => {
    expect(await ruleIds(readFileSync(SOURCE, "utf8"), SOURCE)).toEqual([]);
    expect(await ruleIds(readFileSync(EMITTED, "utf8"), EMITTED)).toEqual([]);
  }, 60000);
});
