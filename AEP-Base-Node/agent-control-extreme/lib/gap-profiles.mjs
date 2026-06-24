#!/usr/bin/env node

import {
  compileMountProfilesFromGap,
  listGapCawProfiles,
  materializeCawRuntimeFromGap,
  resolveGapProfileFile,
} from "../../../AEP-Components/gap/lib/gap-compile.mjs";

/**
 * Agent Control Hub: GAP is the authoritative profile source.
 * @param {string} [repoRoot]
 */
export function loadGapCapabilityProfiles(repoRoot) {
  return listGapCawProfiles(repoRoot);
}

export function resolveAgentProfile(profileRef, repoRoot) {
  return resolveGapProfileFile(profileRef, repoRoot);
}

export function syncCawRuntimeFromGap(dataDir, repoRoot) {
  return materializeCawRuntimeFromGap(dataDir, repoRoot);
}

export function mountProfileMap(repoRoot) {
  return compileMountProfilesFromGap(repoRoot);
}