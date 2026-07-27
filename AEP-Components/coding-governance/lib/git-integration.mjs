#!/usr/bin/env node

/**
 * Git integration for coding governance (nool-compatible, git stays substrate).
 * Captures commit/branch/dirty state at propose and solidify; links ledger to git refs.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveRepoRoot } from "./paths.mjs";

function runGit(args, cwd) {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: out.trim() };
  } catch (err) {
    return {
      ok: false,
      stdout: err?.stdout?.trim?.() ?? "",
      stderr: err?.stderr?.trim?.() ?? err?.message ?? "git failed",
    };
  }
}

export function resolveGitRepoRoot(repoRoot = resolveRepoRoot()) {
  const top = runGit(["rev-parse", "--show-toplevel"], repoRoot);
  if (!top.ok) return null;
  return top.stdout || repoRoot;
}

export function isGitRepo(repoRoot = resolveRepoRoot()) {
  return Boolean(resolveGitRepoRoot(repoRoot));
}

/**
 * Capture current git state for propose or solidify records.
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]
 * @param {string} [opts.phase] propose | solidify
 * @param {object} [opts.proposeGitRefs] git state captured at propose (for solidify diff)
 */
export function captureGitRefs(opts = {}) {
  const repoRoot = resolveGitRepoRoot(opts.repoRoot ?? resolveRepoRoot());
  if (!repoRoot) {
    return { available: false, reason: "not_a_git_repository" };
  }

  const commit = runGit(["rev-parse", "HEAD"], repoRoot);
  const branch = runGit(["branch", "--show-current"], repoRoot);
  const describe = runGit(["describe", "--tags", "--always", "--dirty"], repoRoot);
  const remote = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], repoRoot);
  const status = runGit(["status", "--porcelain"], repoRoot);
  const root = runGit(["rev-parse", "--show-toplevel"], repoRoot);

  const dirtyLines = status.ok && status.stdout ? status.stdout.split("\n").filter(Boolean) : [];
  const changed_files = dirtyLines.map((line) => {
    const path = line.slice(3).trim();
    const xy = line.slice(0, 2);
    return { path, index: xy[0], worktree: xy[1] };
  });

  const refs = {
    available: true,
    phase: opts.phase ?? null,
    captured_at: new Date().toISOString(),
    repo_root: root.ok ? root.stdout : repoRoot,
    commit: commit.ok ? commit.stdout : null,
    branch: branch.ok && branch.stdout ? branch.stdout : null,
    describe: describe.ok ? describe.stdout : null,
    upstream: remote.ok && remote.stdout ? remote.stdout : null,
    dirty: dirtyLines.length > 0,
    changed_files_count: changed_files.length,
    changed_files: changed_files.slice(0, 200),
  };

  if (opts.phase === "solidify" && opts.proposeGitRefs?.commit && commit.ok) {
    const proposeCommit = opts.proposeGitRefs.commit;
    const diff = runGit(
      ["diff", "--name-only", proposeCommit, "HEAD"],
      repoRoot,
    );
    const log = runGit(
      ["log", "--oneline", `${proposeCommit}..HEAD`],
      repoRoot,
    );
    refs.since_propose = {
      propose_commit: proposeCommit,
      same_commit: proposeCommit === commit.stdout,
      commits_since_propose: log.ok && log.stdout ? log.stdout.split("\n").filter(Boolean) : [],
      files_changed_since_propose: diff.ok && diff.stdout
        ? diff.stdout.split("\n").filter(Boolean)
        : [],
    };
  }

  return refs;
}

export function gitRefsToSolidifyField(refs) {
  if (!refs?.available) return undefined;
  return {
    commit: refs.commit ?? undefined,
    branch: refs.branch ?? undefined,
    describe: refs.describe ?? undefined,
    upstream: refs.upstream ?? undefined,
    dirty: refs.dirty ?? false,
    repo_root: refs.repo_root ?? undefined,
    since_propose: refs.since_propose ?? undefined,
  };
}

export function saveProposeGitRefs(dataDir, intentId, refs) {
  if (!refs?.available || !intentId) return null;
  const dir = join(dataDir, "intents", intentId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "git-refs-propose.json");
  writeFileSync(path, JSON.stringify(refs, null, 2));
  return path;
}

export function loadProposeGitRefs(dataDir, intentId) {
  const path = join(dataDir, "intents", intentId, "git-refs-propose.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Merge auto-captured git refs into a solidify record (unless skipped or already set).
 */
export function enrichSolidifyRecordWithGit(record, opts = {}) {
  if (opts.skipGit || process.env.AEP_GIT_INTEGRATION === "0") {
    return { record, git: { skipped: true } };
  }
  if (record.git_refs?.commit) {
    return { record, git: { skipped: true, reason: "git_refs_already_set" } };
  }

  const proposeRefs = opts.proposeGitRefs
    ?? (record.intent_id ? loadProposeGitRefs(opts.dataDir, record.intent_id) : null);

  const refs = captureGitRefs({
    repoRoot: opts.repoRoot,
    phase: "solidify",
    proposeGitRefs: proposeRefs,
  });

  if (!refs.available) {
    return { record, git: { captured: false, reason: refs.reason } };
  }

  return {
    record: { ...record, git_refs: gitRefsToSolidifyField(refs) },
    git: { captured: true, refs },
  };
}

/**
 * Capture git at propose and persist snapshot alongside intent declaration.
 */
export function enrichProposeWithGit(dataDir, intentId, opts = {}) {
  if (opts.skipGit || process.env.AEP_GIT_INTEGRATION === "0") {
    return { git: { skipped: true } };
  }
  const refs = captureGitRefs({ repoRoot: opts.repoRoot, phase: "propose" });
  if (!refs.available) {
    return { git: { captured: false, reason: refs.reason } };
  }
  const path = saveProposeGitRefs(dataDir, intentId, refs);
  return { git: { captured: true, refs, path } };
}