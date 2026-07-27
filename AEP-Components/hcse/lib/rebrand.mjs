#!/usr/bin/env node

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  HCSE_INSTALLED_BINARY,
  HCSE_UPSTREAM_BINARY,
  hcseCacheDir,
  hcseModuleRoot,
} from "./paths.mjs";

/**
 * Opaque rebrand: upstream binary becomes aep-hcse wrapper + internal bin name.
 * @param {object} opts
 * @param {string} opts.dataDir
 * @param {string} opts.versionDir - extracted release directory
 * @param {string} opts.version - upstream release tag
 */
export function applyHcseRebrand({ dataDir, versionDir, version }) {
  const moduleRoot = hcseModuleRoot(dataDir);
  const targetVersionDir = join(moduleRoot, version);
  mkdirSync(targetVersionDir, { recursive: true });

  const upstreamBin = join(versionDir, HCSE_UPSTREAM_BINARY);
  if (!existsSync(upstreamBin)) {
    throw new Error(`upstream binary missing after extract: ${upstreamBin}`);
  }

  const internalBin = join(targetVersionDir, `${HCSE_UPSTREAM_BINARY}.bin`);
  copyFileSync(upstreamBin, internalBin);
  chmodSync(internalBin, 0o755);

  const wrapperPath = join(targetVersionDir, HCSE_INSTALLED_BINARY);
  const cacheDir = hcseCacheDir(dataDir);
  const wrapper = `#!/usr/bin/env bash
set -euo pipefail
export CBM_CACHE_DIR="${cacheDir}"
export AEP_HCSE_MODULE=1
export AEP_HCSE_DATA_DIR="${dataDir.replace(/"/g, '\\"')}"
exec "${internalBin}" "$@"
`;
  writeFileSync(wrapperPath, wrapper, { mode: 0o755 });

  mkdirSync(moduleRoot, { recursive: true });

  writeFileSync(
    join(moduleRoot, "module.json"),
    `${JSON.stringify(
      {
        kind: "aep-hcse-module",
        schema_version: 1,
        installed_binary: HCSE_INSTALLED_BINARY,
        upstream_binary: HCSE_UPSTREAM_BINARY,
        upstream_repo: "https://github.com/DeusData/codebase-memory-mcp",
        version,
        rebranded_at: new Date().toISOString(),
        cache_dir: cacheDir,
        artifact_dir: ".aep-hcse",
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  return {
    binary: wrapperPath,
    internal_bin: internalBin,
    version,
    cache_dir: cacheDir,
  };
}

