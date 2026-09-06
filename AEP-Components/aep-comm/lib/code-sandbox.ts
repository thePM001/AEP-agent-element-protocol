// @PAD: p0-v275-l1-sandbox-catch-v1
// @GCDE: document_sha256=p0-v275-l1
/**
 * Code Execution Sandbox - Isolated execution environment for agent-generated code.
 * Routes optional lattice record through WASM lattice channel socket.
 * Part of AEP-Comm v2.75. Matches AutoGen code execution capability.
 */

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep, dirname } from "node:path";

export interface CodeExecutionRequest {
  code: string;
  language: "python" | "javascript" | "typescript" | "bash";
  timeoutMs: number;
  env?: Record<string, string>;
  files?: Record<string, string>;
}

export interface CodeExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  artifacts?: Record<string, string>;
}

export interface SandboxPolicy {
  maxTimeoutMs: number;
  maxOutputBytes: number;
  allowedLanguages: string[];
  networkAccess: boolean;
  filesystemAccess: "none" | "readonly" | "readwrite";
  maxFileSizeBytes: number;
}

function dataRoot(): string {
  const envData = process.env.AEP_DATA;
  if (typeof envData === "string" && envData.length > 0) {
    return envData;
  }
  return join(homedir(), ".aep", "data");
}

function sandboxRoot(): string {
  return join(dataRoot(), "sandbox");
}

function refusePathEscape(root: string, rel: string): string {
  if (rel.indexOf("\0") >= 0) {
    throw new Error("path escape refused");
  }
  const parts = rel.split(/[/\\]/);
  for (const p of parts) {
    if (p === "..") {
      throw new Error("path escape refused");
    }
  }
  if (rel.charAt(0) === "/" || /^[A-Za-z]:/.test(rel)) {
    throw new Error("path escape refused");
  }
  const rootAbs = resolve(root);
  const abs = resolve(root, rel);
  const prefix = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;
  if (abs !== rootAbs && abs.startsWith(prefix) === false) {
    throw new Error("path escape refused");
  }
  return abs;
}

function interpreter(language: string): { cmd: string; prefix: string[]; file: string } {
  if (language === "python") {
    return { cmd: "python3", prefix: [], file: "main.py" };
  }
  if (language === "javascript") {
    return { cmd: "node", prefix: [], file: "main.js" };
  }
  if (language === "typescript") {
    return { cmd: "node", prefix: ["--experimental-strip-types"], file: "main.ts" };
  }
  if (language === "bash") {
    return { cmd: "bash", prefix: [], file: "main.sh" };
  }
  throw new Error("Language not allowed: " + language);
}

let unshareCache: boolean | null = null;

function unshareNetWorks(): boolean {
  if (unshareCache !== null) {
    return unshareCache;
  }
  try {
    const r = spawnSync("unshare", ["--net", "true"], { timeout: 2000, stdio: "ignore" });
    unshareCache = r.status === 0;
  } catch (_e) {
    unshareCache = false;
  }
  return unshareCache;
}

function childEnv(
  work: string,
  extra: Record<string, string> | undefined
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  const keep = ["PATH", "LANG", "USER", "LOGNAME", "TZ"];
  for (const k of keep) {
    const v = process.env[k];
    if (typeof v === "string") {
      out[k] = v;
    }
  }
  out.HOME = work;
  out.PWD = work;
  out.TMPDIR = work;
  out.AEP_SANDBOX = "1";
  const data = process.env.AEP_DATA;
  if (typeof data === "string" && data.length > 0) {
    out.AEP_DATA = data;
  }
  if (extra !== undefined) {
    for (const key of Object.keys(extra)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        out[key] = extra[key];
      }
    }
  }
  return out;
}

function runSpawn(
  cmd: string,
  args: string[],
  work: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  maxOutputBytes: number
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((finish) => {
    let settled = false;
    const done = (r: { stdout: string; stderr: string; exitCode: number; timedOut: boolean }) => {
      if (settled === false) {
        settled = true;
        finish(r);
      }
    };
    const child = spawn(cmd, args, {
      cwd: work,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunksOut: Buffer[] = [];
    const chunksErr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const take = (target: Buffer[], nref: { n: number }, buf: Buffer) => {
      if (nref.n >= maxOutputBytes) {
        return;
      }
      const room = maxOutputBytes - nref.n;
      const slice = buf.length > room ? buf.subarray(0, room) : buf;
      target.push(slice);
      nref.n += slice.length;
    };
    const outRef = { n: 0 };
    const errRef = { n: 0 };
    if (child.stdout) {
      child.stdout.on("data", (buf: Buffer) => take(chunksOut, outRef, buf));
    }
    if (child.stderr) {
      child.stderr.on("data", (buf: Buffer) => take(chunksErr, errRef, buf));
    }
    child.on("error", (e) => {
      clearTimeout(timer);
      done({
        stdout: Buffer.concat(chunksOut).toString("utf8"),
        stderr: e instanceof Error ? e.message : String(e),
        exitCode: 1,
        timedOut: false,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({
        stdout: Buffer.concat(chunksOut).toString("utf8"),
        stderr: Buffer.concat(chunksErr).toString("utf8"),
        exitCode: typeof code === "number" ? code : 1,
        timedOut,
      });
    });
  });
}

async function maybeLatticeRecord(code: string): Promise<void> {
  const sock = process.env.WASM_SANDBOX_SOCKET;
  if (typeof sock !== "string" || sock.length === 0) {
    return;
  }
  const hex = createHash("sha256").update(code).digest("hex").slice(0, 8);
  const input = parseInt(hex, 16);
  try {
    const mod = await import("../../lattice-channels/client/lattice/index.js");
    mod.wasmLatticeEvaluate({ input });
  } catch (_e) {
    return;
  }
}

export class CodeSandbox {
  private policy: SandboxPolicy;
  private executionCount: number = 0;
  private totalDurationMs: number = 0;

  constructor(policy?: Partial<SandboxPolicy>) {
    this.policy = {
      maxTimeoutMs: 30000,
      maxOutputBytes: 1024 * 1024,
      allowedLanguages: ["python", "javascript", "typescript", "bash"],
      networkAccess: false,
      filesystemAccess: "readonly",
      maxFileSizeBytes: 10 * 1024 * 1024,
      ...policy,
    };
  }

  async execute(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    const start = Date.now();
    this.executionCount += 1;

    if (typeof request.code !== "string" || request.code.trim().length === 0) {
      const durationMs = Date.now() - start;
      this.totalDurationMs += durationMs;
      return {
        stdout: "",
        stderr: "empty code refused",
        exitCode: 1,
        timedOut: false,
        durationMs,
      };
    }

    if (this.policy.allowedLanguages.includes(request.language) === false) {
      const durationMs = Date.now() - start;
      this.totalDurationMs += durationMs;
      return {
        stdout: "",
        stderr: "Language not allowed: " + request.language,
        exitCode: 1,
        timedOut: false,
        durationMs,
      };
    }

    if (Buffer.byteLength(request.code, "utf8") > this.policy.maxFileSizeBytes) {
      const durationMs = Date.now() - start;
      this.totalDurationMs += durationMs;
      return {
        stdout: "",
        stderr: "code exceeds maxFileSizeBytes",
        exitCode: 1,
        timedOut: false,
        durationMs,
      };
    }

    const timeout = Math.min(request.timeoutMs, this.policy.maxTimeoutMs);
    const root = sandboxRoot();
    mkdirSync(root, { recursive: true });
    const id = createHash("sha256")
      .update(String(start) + ":" + String(this.executionCount) + ":" + request.code)
      .digest("hex")
      .slice(0, 16);
    const work = join(root, id);
    mkdirSync(work, { recursive: true });

    try {
      await maybeLatticeRecord(request.code);
      const interp = interpreter(request.language);
      const mainPath = refusePathEscape(work, interp.file);
      writeFileSync(mainPath, request.code, { encoding: "utf8" });

      if (request.files !== undefined) {
        for (const rel of Object.keys(request.files)) {
          const abs = refusePathEscape(work, rel);
          const body = request.files[rel];
          if (Buffer.byteLength(body, "utf8") > this.policy.maxFileSizeBytes) {
            throw new Error("file exceeds maxFileSizeBytes");
          }
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, body, { encoding: "utf8" });
        }
      }

      let cmd = interp.cmd;
      let args = interp.prefix.concat([interp.file]);
      if (this.policy.networkAccess === false && unshareNetWorks()) {
        args = ["--net", "--", cmd].concat(args);
        cmd = "unshare";
      }

      const ran = await runSpawn(
        cmd,
        args,
        work,
        childEnv(work, request.env),
        timeout,
        this.policy.maxOutputBytes
      );

      let artifacts: Record<string, string> | undefined;
      if (this.policy.filesystemAccess === "readwrite" && request.files !== undefined) {
        artifacts = {};
        for (const rel of Object.keys(request.files)) {
          try {
            const abs = refusePathEscape(work, rel);
            artifacts[rel] = readFileSync(abs, "utf8");
          } catch (_e) {
            artifacts[rel] = "";
          }
        }
      }

      const durationMs = Date.now() - start;
      this.totalDurationMs += durationMs;
      const result: CodeExecutionResult = {
        stdout: ran.stdout,
        stderr: ran.stderr,
        exitCode: ran.exitCode,
        timedOut: ran.timedOut,
        durationMs,
      };
      if (artifacts !== undefined) {
        result.artifacts = artifacts;
      }
      return result;
    } catch (e) {
      const durationMs = Date.now() - start;
      this.totalDurationMs += durationMs;
      return {
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
        exitCode: 1,
        timedOut: false,
        durationMs,
      };
    } finally {
      if (process.env.AEP_SANDBOX_KEEP !== "1") {
        try {
          rmSync(work, { recursive: true, force: true });
        } catch (_e) {
          void 0;
        }
      }
    }
  }

  getStats(): { executions: number; totalDurationMs: number; avgDurationMs: number } {
    return {
      executions: this.executionCount,
      totalDurationMs: this.totalDurationMs,
      avgDurationMs:
        this.executionCount > 0
          ? Math.round(this.totalDurationMs / this.executionCount)
          : 0,
    };
  }

  updatePolicy(update: Partial<SandboxPolicy>): void {
    this.policy = { ...this.policy, ...update };
  }

  getPolicy(): SandboxPolicy {
    return { ...this.policy };
  }
}
