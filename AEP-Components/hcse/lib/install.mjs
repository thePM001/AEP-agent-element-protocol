#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ucdDownload,
  ucdFetchJson,
} from "../../../AEP-Docks/universal-connect/lib/ucd-client.mjs";
import { defaultPaths } from "../../wizard/lib/paths.mjs";
import { applyHcseRebrand } from "./rebrand.mjs";
import { wireHcseMcpConfigs } from "./mcp-config.mjs";
import {
  HCSE_UPSTREAM_API,
  expandDataDir,
  hcseCacheDir,
  hcseInstalled,
  hcseModuleRoot,
  readHcseModuleManifest,
} from "./paths.mjs";

const HCSE_MODULE_ID = "hcse";

function resolvePlatformArchive() {
  const platform = process.platform;
  const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : process.arch;
  let os;
  if (platform === "linux") os = "linux";
  else if (platform === "darwin") os = "darwin";
  else if (platform === "win32") os = "windows";
  else throw new Error(`HCSE unsupported platform: ${platform}`);
  const ext = os === "windows" ? "zip" : "tar.gz";
  return {
    os,
    arch,
    archive: `codebase-memory-mcp-${os}-${arch}.${ext}`,
    ext,
  };
}

function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function extractArchive(archivePath, destDir, ext) {
  mkdirSync(destDir, { recursive: true });
  if (ext === "tar.gz") {
    execFileSync("tar", ["xzf", archivePath, "-C", destDir], { stdio: "inherit" });
    return;
  }
  execFileSync("unzip", ["-q", archivePath, "-d", destDir], { stdio: "inherit" });
}

function findExtractedRoot(extractDir, archiveBase) {
  const direct = join(extractDir, archiveBase.replace(/\.(tar\.gz|zip)$/, ""));
  if (existsSync(join(direct, "codebase-memory-mcp"))) return direct;
  if (existsSync(join(extractDir, "codebase-memory-mcp"))) return extractDir;
  return extractDir;
}

function ucdOpts(dataDir, socketBase, opts) {
  return {
    dataDir,
    socketBase: opts.socketBase ?? socketBase,
    ucbBase: opts.ucbBase,
    ucbApiKey: opts.ucbApiKey,
  };
}

/**
 * Download upstream release via UCD (UCB-regulated egress), rebrand to aep-hcse, wire MCP.
 * @param {object} [opts]
 */
export async function installHcseModule(opts = {}) {
  const paths = defaultPaths();
  const dataDir = expandDataDir(opts.dataDir ?? paths.dataDir);
  const socketBase = opts.socketBase ?? paths.socketBase ?? join(dataDir, "sockets");
  const force = opts.force === true;
  const fetchOpts = ucdOpts(dataDir, socketBase, opts);

  if (!force && hcseInstalled(dataDir)) {
    const manifest = readHcseModuleManifest(dataDir);
    return { ok: true, skipped: true, reason: "already_installed", manifest };
  }

  mkdirSync(hcseCacheDir(dataDir), { recursive: true });
  mkdirSync(hcseModuleRoot(dataDir), { recursive: true });

  const { archive, ext } = resolvePlatformArchive();
  const { transport: releaseTransport, data: release } = await ucdFetchJson(
    HCSE_MODULE_ID,
    HCSE_UPSTREAM_API,
    { ...fetchOpts, eventType: "HCSE_RELEASE_LOOKUP" },
  );
  const version = String(release.tag_name ?? release.name ?? "unknown").replace(/^v/, "");
  const asset = (release.assets ?? []).find((a) => a.name === archive);
  if (!asset?.browser_download_url) {
    throw new Error(`HCSE release asset not found: ${archive}`);
  }

  const checksumsAsset = (release.assets ?? []).find((a) => a.name === "checksums.txt");
  const work = mkdtempSync(join(tmpdir(), "aep-hcse-"));
  const archivePath = join(work, archive);

  try {
    const { transport: downloadTransport } = await ucdDownload(
      HCSE_MODULE_ID,
      asset.browser_download_url,
      archivePath,
      fetchOpts,
    );

    if (checksumsAsset?.browser_download_url) {
      const checksumsPath = join(work, "checksums.txt");
      await ucdDownload(HCSE_MODULE_ID, checksumsAsset.browser_download_url, checksumsPath, fetchOpts);
      const lines = readFileSync(checksumsPath, "utf8").split("\n");
      const digest = sha256File(archivePath);
      const matched = lines.some((line) => line.trim().endsWith(archive) && line.startsWith(digest));
      if (!matched) {
        throw new Error(`HCSE checksum mismatch for ${archive}`);
      }
    }

    const extractDir = join(work, "extract");
    extractArchive(archivePath, extractDir, ext);
    const versionDir = findExtractedRoot(extractDir, archive);

    const rebrand = applyHcseRebrand({ dataDir, versionDir, version });
    const mcp = wireHcseMcpConfigs({ dataDir, cwd: opts.cwd ?? process.cwd() });

    const installRecord = {
      id: "hcse",
      enabled_at: new Date().toISOString(),
      version,
      binary: rebrand.binary,
      upstream: "DeusData/codebase-memory-mcp",
      transport: {
        release_lookup: releaseTransport,
        binary_download: downloadTransport,
        dock: "universal_connect",
      },
    };
    writeFileSync(
      join(hcseModuleRoot(dataDir), "install-record.json"),
      `${JSON.stringify(installRecord, null, 2)}\n`,
      { mode: 0o600 },
    );
    try {
      chmodSync(rebrand.binary, 0o755);
    } catch {
      /* windows */
    }

    return { ok: true, version, rebrand, mcp, installRecord };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function runHcseInstallIfNeeded(opts = {}) {
  const dataDir = expandDataDir(opts.dataDir ?? defaultPaths().dataDir);
  if (opts.componentIds && !opts.componentIds.includes("hcse")) {
    return { ok: true, skipped: true, reason: "hcse_not_in_plan" };
  }
  return installHcseModule(opts);
}