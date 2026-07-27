import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authorizeComposerLiteAccess } from "./composer-lite-auth.mjs";
import { stripComposerLiteBasePath } from "./composer-lite-paths.mjs";

function loadWebSocketServer() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.NODE_PATH?.split(":").map((p) => join(p, "ws")),
    join(here, "../../node_modules/ws"),
    join(here, "../../AEP-Components/conformance/harness/node_modules/ws"),
    "/opt/aep/node_modules/ws",
  ]
    .flat()
    .filter(Boolean);
  for (const mod of candidates) {
    if (existsSync(join(mod, "package.json"))) {
      return createRequire(join(mod, "package.json"))(".");
    }
  }
  return createRequire(fileURLToPath(import.meta.url))("ws");
}

let WebSocketServer = null;

function getWebSocketServer() {
  if (!WebSocketServer) {
    ({ WebSocketServer } = loadWebSocketServer());
  }
  return WebSocketServer;
}

const DEFAULT_CWD =
  process.env.COMPOSER_LITE_TERMINAL_CWD || process.env.AEP_DATA || "/opt/aep";

/** Absolute shell binaries only. Client `cmd` is ignored (CRITICAL RCE fix). */
const ALLOWED_SHELLS = new Set(["/bin/bash", "/bin/sh", "/usr/bin/bash", "/usr/bin/sh"]);

function resolveShellBinary(env = process.env) {
  const configured = String(env.COMPOSER_LITE_TERMINAL_SHELL || "/bin/bash").trim();
  if (ALLOWED_SHELLS.has(configured) && existsSync(configured)) {
    return configured;
  }
  for (const cand of ALLOWED_SHELLS) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

function cwdAllowed(cwd) {
  if (!cwd || typeof cwd !== "string") return false;
  if (!cwd.startsWith("/")) return false;
  // Never allow /root as shell cwd (operator home escape). Sandbox to aep data or tmp only.
  const sandbox = String(process.env.COMPOSER_LITE_TERMINAL_CWD || process.env.AEP_DATA || "/opt/aep");
  if (cwd === sandbox || cwd.startsWith(sandbox.endsWith("/") ? sandbox : sandbox + "/")) {
    return true;
  }
  if (cwd === "/tmp" || cwd.startsWith("/tmp/")) {
    return true;
  }
  if (cwd === "/opt/aep" || cwd.startsWith("/opt/aep/")) {
    return true;
  }
  return false;
}

function parseTerminalQuery(url) {
  const cwd = url.searchParams.get("cwd")?.trim() || DEFAULT_CWD;
  // Intentionally ignore client-supplied cmd (was arbitrary process spawn).
  const cmd = resolveShellBinary();
  return { cwd, cmd };
}

function buildTerminalEnv() {
  // MEDIUM: do not inherit API keys / tokens into interactive shell
  const allow = new Set([
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TMPDIR",
    "TMP",
    "TEMP",
    "TERM",
    "COLORTERM",
    "AEP_DATA",
    "AEP_DATA_DIR",
    "AEP_HOME",
  ]);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    const upper = k.toUpperCase();
    if (allow.has(k) || allow.has(upper)) {
      env[k] = v;
      continue;
    }
    if (
      upper.includes("TOKEN") ||
      upper.includes("SECRET") ||
      upper.includes("PASSWORD") ||
      upper.includes("API_KEY") ||
      upper.includes("APIKEY") ||
      upper.endsWith("_KEY") ||
      upper.includes("UCB_") ||
      upper.includes("COMPOSER_LITE_") ||
      upper.includes("OPENAI_") ||
      upper.includes("ANTHROPIC_") ||
      upper.includes("AWS_") ||
      upper.includes("GITEA_")
    ) {
      continue;
    }
  }
  env.TERM = env.TERM || "xterm-256color";
  env.COLORTERM = env.COLORTERM || "truecolor";
  env.PATH = env.PATH || process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  return env;
}

function spawnShell(cwd, cmd) {
  return spawn(cmd, ["-l"], {
    cwd,
    env: buildTerminalEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function attachTerminalSession(ws, cwd, cmd) {
  const child = spawnShell(cwd, cmd);

  const onStdout = (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk);
  };
  const onStderr = (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk);
  };

  child.stdout.on("data", onStdout);
  child.stderr.on("data", onStderr);

  child.on("close", () => {
    if (ws.readyState === ws.OPEN) ws.close();
  });

  ws.on("message", (data, isBinary) => {
    if (!child.stdin.writable) return;
    if (isBinary) {
      child.stdin.write(data);
      return;
    }
    const text = data.toString();
    try {
      const parsed = JSON.parse(text);
      if (parsed?.type === "resize") return;
    } catch {
      /* shell input */
    }
    child.stdin.write(text);
  });

  ws.on("close", () => {
    child.stdout.off("data", onStdout);
    child.stderr.off("data", onStderr);
    child.kill("SIGTERM");
  });
}

/** Client-facing path (includes COMPOSER_LITE_BASE_PATH when proxied). */
export function terminalWsPath(basePath = "") {
  const base = String(basePath || "").replace(/\/$/, "");
  return `${base}/api/terminal/ws`;
}

export function terminalWebSocketEnabled(env = process.env) {
  const raw = String(env.COMPOSER_LITE_TERMINAL ?? "0").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Remote terminal upgrade only with explicit opt-in (default: loopback peers only). */
export function terminalRemoteAllowed(env = process.env) {
  const raw = String(env.COMPOSER_LITE_TERMINAL_ALLOW_REMOTE ?? "0").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function isLoopbackRemoteAddress(addr) {
  const a = String(addr ?? "").replace(/^::ffff:/, "");
  return a === "127.0.0.1" || a === "::1" || a === "";
}

export function attachTerminalWebSocket(server) {
  if (!terminalWebSocketEnabled()) {
    return null;
  }
  const wss = new getWebSocketServer()({ noServer: true });
  const path = "/api/terminal/ws";

  server.on("upgrade", (req, socket, head) => {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const pathname = stripComposerLiteBasePath(url.pathname);
    if (pathname !== path) {
      socket.destroy();
      return;
    }

    const auth = authorizeComposerLiteAccess(req);
    if (!auth.allowed) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    // TM-09: interactive shell is operator-local by default
    if (!isLoopbackRemoteAddress(req.socket?.remoteAddress) && !terminalRemoteAllowed()) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    const { cwd, cmd } = parseTerminalQuery(url);
    if (!cwdAllowed(cwd) || !cmd) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      attachTerminalSession(ws, cwd, cmd);
    });
  });

  return wss;
}