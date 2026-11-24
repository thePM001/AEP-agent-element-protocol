/**
 * Standing gate of the script coverage. Every TypeScript, mjs and
 * JavaScript file outside AEP-Components must sit in the typecheck program of
 * tsconfig.json, open with // @ts-check when it is JavaScript, lint with type
 * information and be reached by the lint command of package.json. A new
 * script that misses one of these fails this test.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const SCRIPT_EXT = new Set([".ts", ".mts", ".cts", ".mjs", ".js", ".cjs"]);
const JS_EXT = new Set([".mjs", ".js", ".cjs"]);
const EXPORT_AREA = String.fromCharCode(65, 69, 80, 45, 78, 79, 83, 72, 73, 80);
/** Folders that are not scripts of this check: the kit, build output and the areas that do not ship. */
const SKIP_TOP = new Set(["AEP-Components", "rust", EXPORT_AREA, EXPORT_AREA.slice(4)]);
const SKIP_ANY = new Set(["node_modules", "target", "dist", ".git"]);

/** Every script file outside AEP-Components, relative to the root with forward slashes. */
function scriptFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_ANY.has(entry.name)) continue;
      if (depth === 0 && SKIP_TOP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && SCRIPT_EXT.has(extname(entry.name)) && !entry.name.endsWith(".d.ts")) {
        out.push(relative(root, full).split(sep).join("/"));
      }
    }
  };
  walk(root, 0);
  return out.sort();
}

function typecheckProgram(): Set<string> {
  const parsed = ts.getParsedCommandLineOfConfigFile(join(REPO, "tsconfig.json"), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    },
  });
  if (!parsed) throw new Error("tsconfig.json does not parse");
  return new Set(parsed.fileNames.map((f) => relative(REPO, f).split(sep).join("/")));
}

function lintArgs(): string[] {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { scripts: { lint: string } };
  return [...pkg.scripts.lint.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? "").slice(1);
}

describe("script coverage outside AEP-Components", () => {
  const files = scriptFiles(REPO);

  it("finds the script files", () => {
    expect(files).toEqual(expect.arrayContaining(["aep-check.mjs", "AEP-Policy-System/policy-builder/lib/rego-generator.ts"]));
  });

  it("every script file is in the typecheck program and every JavaScript file opens with ts-check", () => {
    const program = typecheckProgram();
    const missing = files.filter((f) => !program.has(f));
    expect(missing).toEqual([]);
    const unchecked = files.filter((f) => {
      if (!JS_EXT.has(extname(f))) return false;
      const head = readFileSync(join(REPO, f), "utf8").split("\n").slice(0, 3);
      return !head.some((line) => line.trim() === "// @ts-check");
    });
    expect(unchecked).toEqual([]);
  });

  it("every script file lints with type information and the lint command reaches it", async () => {
    const eslint = new ESLint({ cwd: REPO });
    const untyped: string[] = [];
    for (const f of files) {
      const config = (await eslint.calculateConfigForFile(join(REPO, f))) as { languageOptions?: { parserOptions?: { projectService?: unknown } } } | undefined;
      if (config?.languageOptions?.parserOptions?.projectService !== true) untyped.push(f);
    }
    expect(untyped).toEqual([]);

    const args = lintArgs();
    expect(args[0]).toBe("--max-warnings");
    const targets = args.slice(2);
    const unreached = files.filter((f) => {
      const top = f.split("/")[0] ?? "";
      if (f.includes("/")) return !targets.includes(top);
      return !targets.includes("*.{ts,mts,cts,mjs,js,cjs}");
    });
    expect(unreached).toEqual([]);
  });
});
