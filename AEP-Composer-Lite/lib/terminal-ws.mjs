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

function cwdAllowed(cwd) {
  if (!cwd || typeof cwd !== "string") return false;
  if (!cwd.startsWith("/")) return false;
  return (
    cwd.startsWith("/root") ||
    cwd.startsWith("/opt/aep") ||
    cwd.startsWith("/tmp")
  );
}

function parseTerminalQuery(url) {
  const cwd = url.searchParams.get("cwd")?.trim() || DEFAULT_CWD;
  const cmd = url.searchParams.get("cmd")?.trim() || "bash";
  return { cwd, cmd };
}

function spawnShell(cwd, cmd) {
  return spawn(cmd, ["-l"], {
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    },
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

    const { cwd, cmd } = parseTerminalQuery(url);
    if (!cwdAllowed(cwd)) {
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