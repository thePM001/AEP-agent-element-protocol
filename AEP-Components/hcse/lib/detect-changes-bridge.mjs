#!/usr/bin/env node

import { runHcseCli } from "./hcse-bridge.mjs";
import { resolveRepoRoot } from "../../coding-governance/lib/paths.mjs";

/**
 * Symbol-level blast radius from HCSE detect_changes tool.
 * @param {object} opts
 * @param {string} opts.dataDir
 * @param {string} [opts.repoRoot]
 * @param {string[]} [opts.paths]
 */
export function hcseDetectChanges(opts = {}) {
  const repoRoot = opts.repoRoot ?? resolveRepoRoot();
  const cli = runHcseCli(opts.dataDir, "detect_changes", {
    repo_path: repoRoot,
    paths: opts.paths ?? [],
  });
  if (!cli.ok) {
    return {
      available: false,
      reason: cli.reason ?? "detect_changes_failed",
      stderr: cli.stderr,
    };
  }

  const data = cli.data ?? {};
  return {
    available: true,
    repo_root: repoRoot,
    computed_at: new Date().toISOString(),
    symbol_impact: normalizeSymbolImpact(data),
    raw: data,
  };
}

function normalizeSymbolImpact(data) {
  const changes = data.changes ?? data.affected ?? data.impacted ?? [];
  const summary = data.summary ?? data.impact_summary ?? {};
  return {
    changes: Array.isArray(changes) ? changes : [],
    risk: {
      critical: Number(summary.critical ?? data.critical ?? 0),
      high: Number(summary.high ?? data.high ?? 0),
      medium: Number(summary.medium ?? data.medium ?? 0),
      low: Number(summary.low ?? data.low ?? 0),
      total: Number(summary.total ?? data.total ?? changes.length ?? 0),
    },
  };
}

/**
 * Merge HCSE symbol impact into coding-governance blast radius report.
 * @param {object} blastRadius - existing BlastRadiusReport
 * @param {object} hcseImpact - hcseDetectChanges() result
 */
export function attachHcseToBlastRadius(blastRadius, hcseImpact) {
  if (!hcseImpact?.available) return blastRadius;
  return {
    ...blastRadius,
    hcse_symbol_impact: hcseImpact.symbol_impact,
    hcse_available: true,
  };
}