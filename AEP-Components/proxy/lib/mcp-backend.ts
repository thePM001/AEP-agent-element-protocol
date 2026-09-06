import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { randomBytes } from "node:crypto";
import type { BackendConfig, MCPToolCall, MCPToolResult } from "./mcp-proxy.js";

export async function forwardMcpCall(
  backend: BackendConfig,
  call: MCPToolCall,
  timeoutMs: number = 15000
): Promise<MCPToolResult> {
  if (backend.transport === "sse" || (typeof backend.url === "string" && backend.url.length > 0)) {
    return forwardHttp(backend, call, timeoutMs);
  }
  if (typeof backend.command === "string" && backend.command.length > 0) {
    return forwardStdio(backend, call, timeoutMs);
  }
  return {
    content: [{ type: "text", text: "no backend command or url" }],
    isError: true,
  };
}

function encodeFrame(obj: unknown): Buffer {
  const json = JSON.stringify(obj) + "\n";
  return Buffer.from(json, "utf8");
}

function parseMessages(buf: Buffer): { messages: unknown[]; rest: Buffer } {
  const messages: unknown[] = [];
  let rest = buf;
  while (rest.length > 0) {
    const headerEnd = indexOfBytes(rest, Buffer.from("\r\n\r\n", "utf8"));
    if (headerEnd >= 0) {
      const header = rest.subarray(0, headerEnd).toString("utf8");
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (m !== null) {
        const len = parseInt(m[1], 10);
        const start = headerEnd + 4;
        if (rest.length < start + len) {
          break;
        }
        const json = rest.subarray(start, start + len).toString("utf8");
        messages.push(JSON.parse(json));
        rest = rest.subarray(start + len);
        continue;
      }
    }
    const nl = rest.indexOf(0x0a);
    if (nl < 0) {
      break;
    }
    const line = rest.subarray(0, nl).toString("utf8").replace(/\r$/, "").trim();
    rest = rest.subarray(nl + 1);
    if (line.length === 0 || /^content-length:/i.test(line)) {
      continue;
    }
    messages.push(JSON.parse(line));
  }
  return { messages, rest };
}

function indexOfBytes(hay: Buffer, needle: Buffer): number {
  if (needle.length === 0) {
    return 0;
  }
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

function rpcResultText(msg: unknown): MCPToolResult {
  if (msg === null || typeof msg !== "object") {
    return { content: [{ type: "text", text: "invalid JSON-RPC message" }], isError: true };
  }
  const o = msg as Record<string, unknown>;
  if (o.error !== undefined) {
    const err = o.error as Record<string, unknown> | string;
    const text = typeof err === "string" ? err : JSON.stringify(err);
    return { content: [{ type: "text", text: text }], isError: true };
  }
  const result = o.result;
  if (result !== null && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.content)) {
      const content = r.content as Array<{ type: string; text?: string }>;
      const isError = r.isError === true;
      return { content, isError: isError ? true : undefined };
    }
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ forwarded: true, result: result }) }],
  };
}

function waitForId(inbox: unknown[], id: number): unknown | undefined {
  for (let i = 0; i < inbox.length; i++) {
    const msg = inbox[i];
    if (msg !== null && typeof msg === "object") {
      const o = msg as Record<string, unknown>;
      if (o.id === id) {
        inbox.splice(i, 1);
        return msg;
      }
    }
  }
  return undefined;
}

function forwardStdio(
  backend: BackendConfig,
  call: MCPToolCall,
  timeoutMs: number
): Promise<MCPToolResult> {
  return new Promise((finish) => {
    let settled = false;
    const done = (r: MCPToolResult) => {
      if (settled === false) {
        settled = true;
        try {
          child.kill("SIGKILL");
        } catch (_e) {
          void 0;
        }
        finish(r);
      }
    };
    const args = Array.isArray(backend.args) ? backend.args : [];
    const cmd = backend.command === "node" ? process.execPath : String(backend.command);
    const child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let errText = "";
    if (child.stderr) {
      child.stderr.on("data", (c) => {
        errText += c.toString("utf8");
      });
    }
    let buf = Buffer.alloc(0);
    const inbox: unknown[] = [];
    const timer = setTimeout(() => {
      done({
        content: [{ type: "text", text: "MCP stdio timed out" }],
        isError: true,
      });
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        const parsed = parseMessages(buf);
        buf = parsed.rest;
        for (const msg of parsed.messages) {
          inbox.push(msg);
        }
      } catch (e) {
        clearTimeout(timer);
        done({
          content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        });
        return;
      }
      const init = waitForId(inbox, 1);
      if (init !== undefined && child.stdin) {
        child.stdin.write(
          encodeFrame({ jsonrpc: "2.0", method: "notifications/initialized" })
        );
        child.stdin.write(
          encodeFrame({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: call.name, arguments: call.arguments },
          })
        );
      }
      const callRes = waitForId(inbox, 2);
      if (callRes !== undefined) {
        clearTimeout(timer);
        done(rpcResultText(callRes));
      }
    };
    if (child.stdout) {
      child.stdout.on("data", onData);
    }
    child.on("error", (e) => {
      clearTimeout(timer);
      done({
        content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
        isError: true,
      });
    });
    child.on("close", () => {
      if (settled === false) {
        clearTimeout(timer);
        done({
          content: [{ type: "text", text: "MCP stdio closed before tools/call result " + errText }],
          isError: true,
        });
      }
    });
    if (child.stdin) {
      child.stdin.write(
        encodeFrame({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "aep-mcp-proxy", version: "2.8.0" },
          },
        })
      );
    }
  });
}

function sessionId(): string {
  return randomBytes(8).toString("hex");
}

function parseSseBody(text: string): unknown {
  const datas: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.indexOf("data:") === 0) {
      datas.push(line.slice(5).trim());
    }
  }
  const joined = datas.join("\n").trim();
  if (joined.length === 0) {
    return JSON.parse(text);
  }
  return JSON.parse(joined);
}

function postJson(
  urlStr: string,
  body: unknown,
  sid: string,
  timeoutMs: number
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((finish, fail) => {
    let u: URL;
    try {
      u = new URL(urlStr);
    } catch (e) {
      fail(e);
      return;
    }
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const lib = u.protocol === "https:" ? httpsRequest : httpRequest;
    const req = lib(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port.length > 0 ? u.port : u.protocol === "https:" ? 443 : 80,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Content-Length": String(payload.length),
          "mcp-session-id": sid,
          "MCP-Protocol-Version": "2024-11-05",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const k of Object.keys(res.headers)) {
            const v = res.headers[k];
            if (typeof v === "string") {
              headers[k.toLowerCase()] = v;
            } else if (Array.isArray(v) && v.length > 0) {
              headers[k.toLowerCase()] = v[0];
            }
          }
          finish({
            status: typeof res.statusCode === "number" ? res.statusCode : 0,
            headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    const timer = setTimeout(() => {
      req.destroy(new Error("MCP HTTP timed out"));
    }, timeoutMs);
    req.on("error", (e) => {
      clearTimeout(timer);
      fail(e);
    });
    req.on("close", () => clearTimeout(timer));
    req.write(payload);
    req.end();
  });
}

async function forwardHttp(
  backend: BackendConfig,
  call: MCPToolCall,
  timeoutMs: number
): Promise<MCPToolResult> {
  const url = backend.url;
  if (typeof url !== "string" || url.length === 0) {
    return { content: [{ type: "text", text: "SSE backend missing url" }], isError: true };
  }
  const sid = sessionId();
  try {
    const initBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "aep-mcp-proxy", version: "2.8.0" },
      },
    };
    const initRes = await postJson(url, initBody, sid, timeoutMs);
    const initSid =
      typeof initRes.headers["mcp-session-id"] === "string" && initRes.headers["mcp-session-id"].length > 0
        ? initRes.headers["mcp-session-id"]
        : sid;
    await postJson(
      url,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      initSid,
      timeoutMs
    );
    const callRes = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: call.name, arguments: call.arguments },
      },
      initSid,
      timeoutMs
    );
    let parsed: unknown;
    try {
      if (callRes.body.indexOf("data:") >= 0) {
        parsed = parseSseBody(callRes.body);
      } else {
        parsed = JSON.parse(callRes.body);
      }
    } catch (_e) {
      return {
        content: [{ type: "text", text: callRes.body.slice(0, 4000) }],
        isError: callRes.status >= 400,
      };
    }
    const mapped = rpcResultText(parsed);
    if (mapped.isError === true) {
      return mapped;
    }
    return mapped;
  } catch (e) {
    return {
      content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
      isError: true,
    };
  }
}
