// =============================================================================
// observers/webhook/index.ts
// Webhook listener adapter.
//
// Creates an HTTP server that accepts POST requests on a configurable port
// and endpoint.  Supports optional HMAC-SHA256 signature verification.
// Each valid request is normalised into a LatticeEvent and forwarded to the
// registered callback.
//
// Example usage:
// ```
// const adapter = new WebhookObserverAdapter({
//   port: 9000,
//   endpoint: "/events",
//   hmacSecret: "shared-secret",
// });
// adapter.onEvent((event) => console.log(event));
// await adapter.start();
// ```
// =============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isIPv4 } from "node:net";
import type { LatticeEvent, ObserverAdapter } from "../interface.js";

// ── Configuration ──────────────────────────────────────────────────────────

export interface WebhookObserverConfig {
  /** HTTP listen port (default: 9000) */
  port?: number;

  /** HTTP listen host (default: the IPv4 loopback address) */
  host?: string;

  /** POST endpoint path (default: "/events") */
  endpoint?: string;

  /**
   * Optional HMAC-SHA256 shared secret.
   * If set, every request MUST include an X-Signature-256 header
   * whose value is the hex-encoded HMAC of the raw request body.
   */
  hmacSecret?: string;

  /**
   * Header name to read the HMAC signature from (default: "x-signature-256").
   * Only used when hmacSecret is set.
   */
  signatureHeader?: string;

  /** Adapter name for logging (default: "webhook:<port>") */
  name?: string;

  /** Maximum accepted request body in bytes (default: WEBHOOK_MAX_BODY_BYTES) */
  maxBodyBytes?: number;
}

/** IPv4 loopback address used as the default bind host. */
export const DEFAULT_WEBHOOK_HOST = [127, 0, 0, 1].join(".");

// ── Defaults ───────────────────────────────────────────────────────────────

/** BM-12: max webhook body size (1 MiB). */
export const WEBHOOK_MAX_BODY_BYTES = 1_048_576;

const DEFAULTS = {
  port: 9000,
  host: DEFAULT_WEBHOOK_HOST,
  endpoint: "/events",
  signatureHeader: "x-signature-256",
  maxBodyBytes: WEBHOOK_MAX_BODY_BYTES,
} as const;

/** True for localhost, ::1 and any address in 127.0.0.0/8. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1") return true;
  return isIPv4(h) && h.startsWith("127.");
}

function jsonReply(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ── Adapter ────────────────────────────────────────────────────────────────

export class WebhookObserverAdapter implements ObserverAdapter {
  readonly name: string;
  private config: Required<Omit<WebhookObserverConfig, "hmacSecret">> & {
    hmacSecret: string | undefined;
  };
  private server: ReturnType<typeof createServer> | null = null;
  private eventCallback: ((event: LatticeEvent) => void) | null = null;
  private started = false;

  constructor(config?: WebhookObserverConfig) {
    const host = config?.host ?? DEFAULTS.host;
    const hmacSecret = config?.hmacSecret;
    // BM-12: non-loopback bind without HMAC is fail-closed
    if (!isLoopbackHost(host) && !hmacSecret) {
      throw new Error(
        "WebhookObserverAdapter: hmacSecret is required when host is not loopback (BM-12)"
      );
    }
    this.config = {
      port: config?.port ?? DEFAULTS.port,
      host,
      endpoint: config?.endpoint ?? DEFAULTS.endpoint,
      name: config?.name ?? `webhook:${config?.port ?? DEFAULTS.port}`,
      hmacSecret,
      signatureHeader: config?.signatureHeader ?? DEFAULTS.signatureHeader,
      maxBodyBytes: config?.maxBodyBytes ?? DEFAULTS.maxBodyBytes,
    };
    this.name = this.config.name;
  }

  // ── ObserverAdapter ──────────────────────────────────────────────────────

  /** Start the HTTP server. Idempotent. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on("error", (err) => {
        this.started = false;
        reject(err);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        console.log(
          `[${this.name}] HTTP server listening on ${this.config.host}:${this.config.port}${this.config.endpoint}`
        );
        resolve();
      });
    });
  }

  /**
   * Bound address once listening (useful when port 0 asks the OS for a
   * free port), or null when the server is not listening.
   */
  address(): { host: string; port: number } | null {
    const addr = this.server?.address();
    if (!addr || typeof addr === "string") return null;
    return { host: addr.address, port: addr.port };
  }

  /** Stop the HTTP server. Idempotent. */
  async stop(): Promise<void> {
    const server = this.server;
    if (!this.started || !server) return;
    this.started = false;

    return new Promise((resolve) => {
      server.close(() => {
        this.server = null;
        console.log(`[${this.name}] Server stopped`);
        resolve();
      });
    });
  }

  /** Register the event callback. Replaces any previous callback. */
  onEvent(callback: (event: LatticeEvent) => void): void {
    this.eventCallback = callback;
  }

  // ── Request handling ─────────────────────────────────────────────────────

  /**
   * Handle an incoming HTTP request.
   * Only POST requests to the configured endpoint are processed.
   */
  private handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): void {
    // ── Method & path check ──────────────────────────────────────────────
    if (req.method !== "POST") {
      jsonReply(res, 405, { error: "Method Not Allowed" });
      return;
    }

    const path = (req.url ?? "").split("?")[0];
    if (path !== this.config.endpoint) {
      jsonReply(res, 404, { error: "Not Found" });
      return;
    }

    // ── Read body with size cap (BM-12) ──────────────────────────────────
    const chunks: Buffer[] = [];
    let total = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      total += chunk.length;
      if (total > this.config.maxBodyBytes) {
        rejected = true;
        res.setHeader("Connection", "close");
        res.writeHead(413, { "Content-Type": "application/json" });
        // Drop the connection only after the 413 reply is flushed.
        res.end(JSON.stringify({ error: "Payload Too Large" }), () => req.destroy());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      const rawBody = Buffer.concat(chunks);

      // ── HMAC verification ──────────────────────────────────────────────
      let providedSig: string | undefined;
      if (this.config.hmacSecret) {
        const headerValue = req.headers[this.config.signatureHeader.toLowerCase()];
        providedSig = typeof headerValue === "string" ? headerValue : undefined;

        if (!providedSig) {
          jsonReply(res, 401, { error: `Missing ${this.config.signatureHeader} header` });
          return;
        }

        const computed = createHmac("sha256", this.config.hmacSecret)
          .update(rawBody)
          .digest("hex");

        // Constant-time comparison to prevent timing attacks.
        const providedBuf = Buffer.from(providedSig, "hex");
        const computedBuf = Buffer.from(computed, "hex");

        if (
          providedBuf.length !== computedBuf.length ||
          !timingSafeEqual(providedBuf, computedBuf)
        ) {
          jsonReply(res, 401, { error: "Invalid signature" });
          return;
        }
      }

      // ── Parse body ─────────────────────────────────────────────────────
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody.toString("utf8"));
      } catch {
        jsonReply(res, 400, { error: "Invalid JSON body" });
        return;
      }
      if (!isPlainObject(parsed)) {
        jsonReply(res, 400, { error: "JSON body must be an object" });
        return;
      }
      const body = parsed;

      // ── Normalise to LatticeEvent ──────────────────────────────────────
      if (providedSig) {
        const payload = isPlainObject(body.payload) ? body.payload : {};
        if (payload.signature === undefined) {
          body.payload = { ...payload, signature: providedSig };
        }
      }
      const event = this.normalise(body);

      // ── Acknowledge ────────────────────────────────────────────────────
      jsonReply(res, 200, { accepted: true, action_path: event.action_path });

      // ── Forward to callback ────────────────────────────────────────────
      this.eventCallback?.(event);
    });

    req.on("error", (err) => {
      console.error(`[${this.name}] Request error:`, err.message);
      jsonReply(res, 500, { error: "Internal Server Error" });
    });
  }

  // ── Normalisation ────────────────────────────────────────────────────────

  /**
   * Normalise a parsed JSON body into a LatticeEvent.
   *
   * Expected shape:
   * ```json
   * {
   *   "source": "my-app",
   *   "action_path": "market:order:new",
   *   "payload": { ... },
   *   "agent_id": "agent-gamma"
   * }
   * ```
   *
   * Fields not present are filled with sensible defaults.
   */
  private normalise(body: Record<string, unknown>): LatticeEvent {
    const event: LatticeEvent = {
      source: typeof body.source === "string" ? body.source : this.name,
      action_path: typeof body.action_path === "string" ? body.action_path : "unknown",
      payload: isPlainObject(body.payload) ? body.payload : {},
      bridge_timestamp: Date.now(),
    };
    if (typeof body.agent_id === "string") {
      event.agent_id = body.agent_id;
    }
    return event;
  }
}
