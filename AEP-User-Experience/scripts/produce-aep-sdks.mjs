#!/usr/bin/env node
/**
 * Produce AEP 2.8 SDK artifacts (no npm registry).
 * - Fix aep-protocol re-export paths
 * - Compile TypeScript dynaep -> dist/
 * - Validate aep-protocol entrypoints
 * - Package python dynaep
 * - Emit lattice-client scaffolds for other languages
 * - Write AEP-SDKs/dist/sdk-manifest.json
 *
 * Run from repo root:
 *   node AEP-User-Experience/scripts/produce-aep-sdks.mjs
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SDK_ROOT = join(REPO, "AEP-SDKs");
const DIST = join(SDK_ROOT, "dist");
const COMPONENTS = "AEP-Components";
const SUBPROTOCOLS = "AEP-Subprotocols";

const LATTICE_SDK_LANGS = [
  "go",
  "rust",
  "javascript",
  "vue",
  "react",
  "astro",
  "elixir",
  "cpp",
  "clojure",
  "html-css",
];

const ALL_SDKS = [
  { id: "aep-typescript-sdk", path: "typescript/aep-protocol/", kind: "typescript" },
  { id: "aep-dynaep-typescript", path: "typescript/dynaep/", kind: "typescript" },
  { id: "aep-python-sdk", path: "python/aep-protocol/", kind: "python" },
  { id: "aep-dynaep-python", path: "python/dynaep/", kind: "python" },
  ...LATTICE_SDK_LANGS.map((lang) => ({
    id: `aep-${lang}-sdk`,
    path: `${lang}/`,
    kind: lang,
  })),
];

function log(msg) {
  console.log(msg);
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(p, out);
    } else if (/\.(ts|mjs|js)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function fixAepProtocolImports() {
  const srcDir = join(SDK_ROOT, "typescript/aep-protocol/src");
  let n = 0;
  for (const file of walk(srcDir)) {
    let text = readFileSync(file, "utf8");
    const orig = text;
    text = text.replaceAll("../../commerce/", "../../../../AEP-Subprotocols/commerce/");
    text = text.replaceAll('from "../../', `from "../../../../${COMPONENTS}/`);
    text = text.replaceAll('export {', 'export {').replaceAll(
      /from "\.\.\/\.\.\/\.\.\/\.\.\/AEP-Components\/AEP-Components\//g,
      `from "../../../../${COMPONENTS}/`,
    );
    if (text !== orig) {
      writeFileSync(file, text);
      n++;
    }
  }
  log(`Fixed component import paths in ${n} aep-protocol source files`);
}

function fixCommerceExports() {
  const indexPath = join(SDK_ROOT, "typescript/aep-protocol/src/index.ts");
  let text = readFileSync(indexPath, "utf8");
  const block = `// Commerce Subprotocol (component: commerce/)
export { CommerceValidator } from "../../../../AEP-Subprotocols/commerce/lib/validator.js";
export { SpendTracker } from "../../../../AEP-Subprotocols/commerce/lib/spend-tracker.js";
export { CommerceRegistry } from "../../../../AEP-Subprotocols/commerce/lib/registry.js";
export {`;
  const replacement = `// Commerce Subprotocol (Rust canonical impl; TS types only)
export {`;
  if (text.includes("CommerceValidator")) {
    text = text.replace(block, replacement);
    writeFileSync(indexPath, text);
    log("Trimmed commerce exports to types-only (validator via AgentGateway.validateCommerce / Rust CLI)");
  }
}

function writeTsBuildConfig(pkgDir, { includeTests = false } = {}) {
  const base = JSON.parse(readFileSync(join(pkgDir, "tsconfig.json"), "utf8"));
  const build = {
    compilerOptions: {
      ...base.compilerOptions,
      types: includeTests ? (base.compilerOptions.types ?? ["vitest/globals"]) : [],
      strict: false,
      skipLibCheck: true,
      outDir: "dist",
      rootDir: "src",
      declaration: true,
      sourceMap: true,
      paths: {
        "@aep/core": ["../types/aep-core.d.ts"],
        ...(base.compilerOptions.paths ?? {}),
      },
    },
    include: includeTests
      ? ["src/**/*.ts", "tests/**/*.ts", "types/**/*.d.ts"]
      : ["src/**/*.ts", "types/**/*.d.ts"],
    exclude: ["node_modules", "dist"],
  };
  writeFileSync(join(pkgDir, "tsconfig.build.json"), `${JSON.stringify(build, null, 2)}\n`);
}

function syncActionLatticeToDynaepSdk() {
  const src = join(REPO, COMPONENTS, "dynAEP/bridge/lattice/index.ts");
  const dest = join(SDK_ROOT, "typescript/dynaep/src/protocol/action-lattice.ts");
  if (!existsSync(src)) {
    throw new Error(`missing Action Lattice protocol source: ${src}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  let text = readFileSync(src, "utf8");
  const banner = `// SDK copy of AEP-Components/dynAEP/bridge/lattice/index.ts (synced by produce-aep-sdks.mjs)\n`;
  if (!text.startsWith("// SDK copy of")) {
    text = text.replace(
      /^\/\/ @PAD:[^\n]*\n\/\/ =+\n\/\/ bridge\/lattice\/index\.ts\n\/\/ Action Lattice:[^\n]*\n/,
      banner,
    );
    if (!text.startsWith("// SDK copy of")) {
      text = `${banner}${text}`;
    }
  }
  writeFileSync(dest, text);
  log(`Synced Action Lattice protocol -> ${relative(REPO, dest)}`);
}

function rewriteDynaepDistImports() {
  const distDir = join(SDK_ROOT, "typescript/dynaep/dist");
  if (!existsSync(distDir)) return;
  const coreRel = "../../aep-protocol/sdk/sdk-aep-core.js";
  for (const file of walk(distDir)) {
    if (!file.endsWith(".js")) continue;
    let text = readFileSync(file, "utf8");
    const next = text.replaceAll('from "@aep/core"', `from "${coreRel}"`);
    if (next !== text) writeFileSync(file, next);
  }
  log("Rewrote @aep/core imports in dynaep dist/");
}

function runTsc(pkgDir) {
  const res = spawnSync(
    "npx",
    ["--yes", "-p", "typescript", "tsc", "-p", "tsconfig.build.json"],
    { cwd: pkgDir, encoding: "utf8", stdio: "pipe" },
  );
  if (res.status !== 0) {
    throw new Error(`tsc failed in ${relative(REPO, pkgDir)}:\n${res.stdout}\n${res.stderr}`);
  }
  log(`Compiled ${relative(REPO, pkgDir)} -> dist/`);
}

function validateNodeSyntax(files) {
  let ok = 0;
  for (const f of files) {
    if (!existsSync(f)) continue;
    const res = spawnSync("node", ["--check", f], { encoding: "utf8" });
    if (res.status !== 0) {
      throw new Error(`node --check failed: ${relative(REPO, f)}\n${res.stderr}`);
    }
    ok++;
  }
  log(`Validated ${ok} entrypoint(s) with node --check`);
}

function packagePythonTree(relPath, pkgLabel) {
  const src = join(SDK_ROOT, relPath);
  const out = join(DIST, relPath);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(dirname(out), { recursive: true });
  cpSync(src, out, { recursive: true });
  const res = spawnSync("python3", ["-m", "compileall", "-q", "."], {
    cwd: out,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`python compileall failed for ${pkgLabel}:\n${res.stderr}`);
  }
  log(`Packaged ${relPath} (compileall OK)`);
}

function resolveLatticeLogBin() {
  const built = join(REPO, "rust/target/debug/aep-lattice-log");
  if (existsSync(built)) return built;
  return "aep-lattice-log";
}

function verifyAllSdks() {
  const env = {
    ...process.env,
    AEP_LATTICE_LOG_BIN: resolveLatticeLogBin(),
    PATH: `${join(REPO, "rust/target/debug")}:${process.env.PATH || ""}`,
  };

  const goRes = spawnSync("go", ["test", "./..."], {
    cwd: join(SDK_ROOT, "go"),
    encoding: "utf8",
    env,
  });
  if (goRes.status !== 0) throw new Error(`go test failed:\n${goRes.stdout}\n${goRes.stderr}`);
  log("go SDK: test OK");

  const rustRes = spawnSync("cargo", ["test"], {
    cwd: join(SDK_ROOT, "rust"),
    encoding: "utf8",
    env,
  });
  if (rustRes.status !== 0) throw new Error(`cargo test failed:\n${rustRes.stdout}\n${rustRes.stderr}`);
  log("rust SDK: test OK");

  for (const f of ["lattice_client.mjs", "lattice-gated-fetch.mjs", "index.mjs"]) {
    const res = spawnSync("node", ["--check", join(SDK_ROOT, "javascript", f)], { encoding: "utf8" });
    if (res.status !== 0) throw new Error(`node --check failed: javascript/${f}\n${res.stderr}`);
  }
  log("javascript SDK: syntax OK");

  const cppRes = spawnSync("make", ["all"], { cwd: join(SDK_ROOT, "cpp"), encoding: "utf8", env });
  if (cppRes.status !== 0) throw new Error(`cpp make failed:\n${cppRes.stdout}\n${cppRes.stderr}`);
  log("cpp SDK: build OK");

  const pyPath = [join(SDK_ROOT, "python/aep-protocol"), join(SDK_ROOT, "python/dynaep")].join(":");
  const pyRes = spawnSync(
    "python3",
    ["-c", "from aep.lattice_client import build_lattice_frame; from dynaep import DynAEPBridge; print('ok')"],
    { encoding: "utf8", env: { ...env, PYTHONPATH: pyPath } },
  );
  if (pyRes.status !== 0) throw new Error(`python import failed:\n${pyRes.stdout}\n${pyRes.stderr}`);
  log("python SDKs: import OK");

  const mixDeps = spawnSync("mix", ["deps.get"], { cwd: join(SDK_ROOT, "elixir"), encoding: "utf8", env });
  if (mixDeps.status !== 0) throw new Error(`mix deps.get failed:\n${mixDeps.stderr}`);
  const mixCompile = spawnSync("mix", ["compile"], { cwd: join(SDK_ROOT, "elixir"), encoding: "utf8", env });
  if (mixCompile.status !== 0) {
    throw new Error(`mix compile failed:\n${mixCompile.stdout}\n${mixCompile.stderr}`);
  }
  log("elixir SDK: compile OK");

  for (const f of ["html-css/lattice_client.js", "astro/index.ts", "vue/index.ts", "react/index.tsx", "clojure/src/aep_sdk/lattice_client.clj"]) {
    if (!existsSync(join(SDK_ROOT, f))) throw new Error(`missing SDK entry: ${f}`);
  }
  log("framework + clojure SDK: entry files OK");
  log("All SDK verification checks passed");
}

function ensureSdkReadmes() {
  for (const lang of LATTICE_SDK_LANGS) {
    const readme = join(SDK_ROOT, lang, "README.md");
    if (!existsSync(readme)) {
      writeFileSync(readme, latticeOperationalReadme(lang));
    }
  }
}

function latticeOperationalReadme(lang) {
  return `# AEP ${lang} SDK

Operational lattice-gated client. See \`lattice_client.*\` in this folder.

\`\`\`bash
node AEP-User-Experience/scripts/produce-aep-sdks.mjs
\`\`\`
`;
}

function copyDistArtifacts() {
  const tsDynaep = join(SDK_ROOT, "typescript/dynaep/dist");
  const tsProtocol = join(SDK_ROOT, "typescript/aep-protocol");
  mkdirSync(join(DIST, "typescript"), { recursive: true });
  if (existsSync(tsDynaep)) {
    cpSync(tsDynaep, join(DIST, "typescript/dynaep"), { recursive: true });
  }
  const protoOut = join(DIST, "typescript/aep-protocol");
  rmSync(protoOut, { recursive: true, force: true });
  mkdirSync(protoOut, { recursive: true });
  for (const name of ["index.ts", "src", "sdk", "cli"]) {
    const src = join(tsProtocol, name);
    if (existsSync(src)) {
      cpSync(src, join(protoOut, name), { recursive: true });
    }
  }
  log("Staged dist/typescript/* SDK trees");
}

function writeDistManifest() {
  const manifest = {
    version: "2.8.0",
    produced_at: new Date().toISOString(),
    producer: "AEP-User-Experience/scripts/produce-aep-sdks.mjs",
    artifacts: ALL_SDKS.map((sdk) => ({
      id: sdk.id,
      path: `AEP-SDKs/${sdk.path}`,
      dist: sdk.kind === "typescript" || sdk.kind === "python"
        ? `AEP-SDKs/dist/${sdk.path}`
        : `AEP-SDKs/${sdk.path}`,
      kind: sdk.kind,
      description: "Operational AEP 2.8 SDK (produce-aep-sdks verified)",
    })),
  };
  writeFileSync(join(DIST, "sdk-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`Wrote ${relative(REPO, join(DIST, "sdk-manifest.json"))}`);
}

function updateCatalog() {
  const catalogPath = join(REPO, "AEP-Base-Node/registry/catalog.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const adds = [
    {
      id: "aep-typescript-sdk",
      name: "AEP TypeScript SDK",
      kind: "sdk",
      bundled: true,
      default_enabled: true,
      path: "AEP-SDKs/typescript/aep-protocol/",
      description: "Unified TypeScript governance stack and lattice-gated SDK clients.",
      manifest: "AEP-Base-Node/registry/components/aep-typescript-sdk.json",
    },
    {
      id: "aep-dynaep-typescript",
      name: "dynAEP TypeScript SDK",
      kind: "sdk",
      bundled: true,
      default_enabled: true,
      path: "AEP-SDKs/typescript/dynaep/",
      description: "dynAEP Action Lattice TypeScript client library.",
      manifest: "AEP-Base-Node/registry/components/aep-dynaep-typescript.json",
    },
    {
      id: "aep-python-sdk",
      name: "AEP Python SDK",
      kind: "sdk",
      bundled: true,
      default_enabled: true,
      path: "AEP-SDKs/python/aep-protocol/",
      description: "AEP Python loader, validator, and lattice client.",
      manifest: "AEP-Base-Node/registry/components/aep-python-sdk.json",
    },
    {
      id: "aep-dynaep-python",
      name: "dynAEP Python SDK",
      kind: "sdk",
      bundled: true,
      default_enabled: false,
      path: "AEP-SDKs/python/dynaep/",
      description: "dynAEP Action Lattice Python client library.",
      manifest: "AEP-Base-Node/registry/components/aep-dynaep-python.json",
    },
  ];
  const ids = new Set(catalog.components.map((c) => c.id));
  for (const entry of adds) {
    if (ids.has(entry.id)) continue;
    catalog.components.push(entry);
    log(`catalog +${entry.id}`);
  }
  if (!catalog.repository.sdks_path) {
    catalog.repository.sdks_path = "AEP-SDKs/";
  }
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
}

function writeSdkManifests() {
  const out = join(REPO, "AEP-Base-Node/registry/components");
  const common = (id, path, desc, requires) => ({
    manifest_version: "1",
    id,
    version: "2.8.0",
    kind: "sdk",
    path,
    description: desc,
    requires,
    capabilities: ["sdk:lattice-gated", "sdk:compiled-ai"],
    actions: [
      {
        id: "produce_sdks",
        description: "Build SDK artifacts (no npm)",
        runtime: "cli",
        method: "node AEP-User-Experience/scripts/produce-aep-sdks.mjs",
      },
    ],
    setup_hooks: [],
    resource_requirements: { min_memory_mb: 64, min_disk_mb: 50, requires_internet: false },
    implementation: { producer: "AEP-User-Experience/scripts/produce-aep-sdks.mjs", dist: "AEP-SDKs/dist/sdk-manifest.json" },
  });
  writeFileSync(
    join(out, "aep-typescript-sdk.json"),
    `${JSON.stringify(
      {
        ...common(
          "aep-typescript-sdk",
          "AEP-SDKs/typescript/aep-protocol/",
          "Unified TypeScript governance stack and lattice-gated SDK clients.",
          ["aep-base-node", "lattice-channels"],
        ),
        implementation: {
          entry: "AEP-SDKs/typescript/aep-protocol/index.ts",
          gateway: "AEP-SDKs/typescript/aep-protocol/src/gateway.ts",
          dist: "AEP-SDKs/dist/typescript/aep-protocol/",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(out, "aep-dynaep-typescript.json"),
    `${JSON.stringify(
      {
        ...common(
          "aep-dynaep-typescript",
          "AEP-SDKs/typescript/dynaep/",
          "dynAEP Action Lattice TypeScript client library.",
          ["aep-base-node", "lattice-channels", "dynaep-core"],
        ),
        implementation: {
          producer: "AEP-User-Experience/scripts/produce-aep-sdks.mjs",
          dist: "AEP-SDKs/dist/sdk-manifest.json",
          entrypoints: [
            "AEP-SDKs/typescript/dynaep/src/bridge.ts",
            "AEP-SDKs/typescript/dynaep/src/protocol/action-lattice.ts",
            "AEP-SDKs/typescript/dynaep/cli/dynaep-cli.ts",
          ],
        },
        cca: {
          summary: "TypeScript dynAEP client: Action Lattice filter, bridge, temporal authority and CLI.",
          use_when: [
            "TypeScript or Node agent backends",
            "compiled AI lattice-gated SDK",
            "dynAEP bridge integration",
          ],
          avoid_when: ["Python-only agent stack with no TS consumers"],
          pairs_with: ["dynaep-core", "lattice-channels", "gap"],
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(out, "aep-python-sdk.json"),
    `${JSON.stringify(
      common(
        "aep-python-sdk",
        "AEP-SDKs/python/aep-protocol/",
        "AEP Python loader, validator, and lattice client.",
        ["aep-base-node", "lattice-channels"],
      ),
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(out, "aep-dynaep-python.json"),
    `${JSON.stringify(
      {
        ...common(
          "aep-dynaep-python",
          "AEP-SDKs/python/dynaep/",
          "dynAEP Action Lattice Python client library.",
          ["dynaep-core"],
        ),
        implementation: {
          producer: "AEP-User-Experience/scripts/produce-aep-sdks.mjs",
          dist: "AEP-SDKs/dist/sdk-manifest.json",
          entrypoints: ["AEP-SDKs/python/dynaep/__init__.py"],
        },
        cca: {
          summary: "Python dynAEP client: Action Lattice bridge and temporal pipeline.",
          use_when: [
            "Python agent backends (LangGraph, CrewAI, ADK)",
            "lattice-gated dynAEP integration",
          ],
          avoid_when: ["TypeScript-only stack"],
          pairs_with: ["dynaep-core", "gap"],
        },
      },
      null,
      2,
    )}\n`,
  );
  log("Wrote SDK registry manifests");
}

function main() {
  log("=== AEP SDK producer ===");
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  fixAepProtocolImports();
  fixCommerceExports();

  const dynaepDir = join(SDK_ROOT, "typescript/dynaep");
  syncActionLatticeToDynaepSdk();
  rmSync(join(dynaepDir, "dist"), { recursive: true, force: true });
  writeTsBuildConfig(dynaepDir, { includeTests: false });
  runTsc(dynaepDir);
  rewriteDynaepDistImports();

  const protocolEntries = [
    join(SDK_ROOT, "typescript/aep-protocol/index.ts"),
    join(SDK_ROOT, "typescript/aep-protocol/src/gateway.ts"),
    join(SDK_ROOT, "typescript/aep-protocol/sdk/sdk-aep-docking-client.ts"),
  ];
  validateNodeSyntax(protocolEntries);

  packagePythonTree("python/aep-protocol", "aep");
  packagePythonTree("python/dynaep", "dynaep");
  ensureSdkReadmes();
  verifyAllSdks();
  copyDistArtifacts();
  writeDistManifest();
  writeSdkManifests();
  updateCatalog();

  try {
    execFileSync("node", [join(REPO, "AEP-Base-Node/registry/scripts/materialize-manifests-v1.mjs")], {
      stdio: "inherit",
    });
  } catch {
    log("(materialize-manifests skipped or failed - SDK manifests written directly)");
  }

  log("\nDone. Artifacts under AEP-SDKs/dist/");
}

main();