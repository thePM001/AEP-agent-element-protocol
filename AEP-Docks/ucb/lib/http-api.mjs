import http from "node:http";
import { resolveUcbRuntime, fetchUcbHealth } from "./runtime.mjs";
import { createUcbAuthGuard } from "./auth.mjs";
import { ingestForeignPayload, rollbackForeignIntegrations } from "./bridge.mjs";
import { delegateToForeignModel } from "./delegate.mjs";
import { listDiffRecords } from "./diff-journal.mjs";
import { mcpCapabilities, handleMcpRequest } from "./mcp.mjs";

const MAX_JSON_BODY_BYTES = 1024 * 1024;

export function jsonResponse(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_JSON_BODY_BYTES) {
        reject(new Error("request body exceeds 1MB limit"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function matchPath(pathname, base) {
  const p = pathname.replace(/\/$/, "") || "/";
  const b = base.replace(/\/$/, "") || "";
  if (!b) return p;
  return p.startsWith(b) ? p.slice(b.length) || "/" : p;
}

export function createUcbServer(env = process.env) {
  const runtime = resolveUcbRuntime(env);
  const auth = createUcbAuthGuard(runtime.dataDir, env);
  const basePath = String(env.UCB_BASE_PATH ?? "").trim().replace(/\/$/, "");

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const path = matchPath(url.pathname, basePath);

    try {
      if (req.method === "GET" && (path === "/health" || path === "/ucb/v1/health")) {
        const health = await fetchUcbHealth(runtime);
        return jsonResponse(res, 200, health);
      }

      if (req.method === "GET" && path === "/ucb/v1/capabilities") {
        return jsonResponse(res, 200, {
          bridge: "ucb/2.8.0",
          paper: "NLA Research Paper 005",
          perimeter: "secured-dock",
          transports: ["http", "mcp-json-rpc"],
          docks: ["validation_engine", "inference_engine", "regulation_module", "future_features", "pera"],
          operations: ["ingest", "delegate", "rollback"],
          supported_protocols: [
            "langgraph",
            "langchain",
            "autogen",
            "crewai",
            "mcp",
            "cursor",
            "claude-code",
            "codex",
            "custom",
            "http",
          ],
          mcp: mcpCapabilities(),
          auth: {
            schemes: ["Bearer", "X-UCB-API-Key"],
            required_for: ["ingest", "delegate", "rollback", "diff", "mcp"],
          },
        });
      }

      const protectedPaths = new Set([
        "/ucb/v1/ingest",
        "/ucb/v1/delegate",
        "/ucb/v1/rollback",
        "/ucb/v1/diff",
        "/mcp",
      ]);

      if (protectedPaths.has(path)) {
        const gate = auth.requireAuth(req);
        if (!gate.ok) {
          return jsonResponse(res, gate.status, { ok: false, error: gate.error });
        }
      }

      if (req.method === "POST" && path === "/ucb/v1/ingest") {
        const body = await readJsonBody(req);
        const result = await ingestForeignPayload(body, runtime);
        return jsonResponse(res, result.ok ? 200 : 422, result);
      }

      if (req.method === "POST" && path === "/ucb/v1/delegate") {
        const body = await readJsonBody(req);
        const result = await delegateToForeignModel(body, runtime, env);
        return jsonResponse(res, result.ok ? 200 : 502, result);
      }

      if (req.method === "POST" && path === "/ucb/v1/rollback") {
        const body = await readJsonBody(req);
        const steps = Number(body.steps ?? 1);
        if (!Number.isInteger(steps) || steps < 1 || steps > 100) {
          return jsonResponse(res, 400, {
            ok: false,
            error: "steps must be an integer between 1 and 100",
          });
        }
        const result = await rollbackForeignIntegrations(steps, runtime);
        return jsonResponse(res, result.ok ? 200 : 404, result);
      }

      if (req.method === "GET" && path === "/ucb/v1/diff") {
        const limit = Number(url.searchParams.get("limit") ?? "20");
        return jsonResponse(res, 200, {
          ok: true,
          diffs: listDiffRecords(runtime.dataDir, { limit }),
        });
      }

      if (req.method === "POST" && path === "/mcp") {
        const body = await readJsonBody(req);
        const response = await handleMcpRequest(body, runtime, env);
        return jsonResponse(res, 200, response);
      }

      return jsonResponse(res, 404, { ok: false, error: "not found", path });
    } catch (err) {
      return jsonResponse(res, 400, { ok: false, error: err.message ?? String(err) });
    }
  });
}