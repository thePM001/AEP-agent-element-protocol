// @PAD: /root/dynAEP/observers/webhook/index.ts
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

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { LatticeEvent, ObserverAdapter } from "../interface";

// ── Configuration ──────────────────────────────────────────────────────────

export interface WebhookObserverConfig {
  /** HTTP listen port (default: 9000) */
  port?: number;

  /** HTTP listen host (default: "127.0.0.1") */
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
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULTS: Required<
  Omit<WebhookObserverConfig, "hmacSecret" | "signatureHeader">
> &
  Pick<WebhookObserverConfig, "signatureHeader"> = {
  port: 9000,
  host: "127.0.0.1",
  endpoint: "/events",
  name: "webhook:9000",
  signatureHeader: "x-signature-256",
};

// ── Adapter ────────────────────────────────────────────────────────────────

export class WebhookObserverAdapter implements ObserverAdapter {
  readonly name: string;
  private config: Required<
    Omit<WebhookObserverConfig, "hmacSecret" | "signatureHeader">
  > &
    Pick<WebhookObserverConfig, "hmacSecret" | "signatureHeader">;
  private server: ReturnType<typeof createServer> | null = null;
  private eventCallback: ((event: LatticeEvent) => void) | null = null;
  private started = false;

  constructor(config?: WebhookObserverConfig) {
    this.config = {
      port: config?.port ?? DEFAULTS.port,
      host: config?.host ?? DEFAULTS.host,
      endpoint: config?.endpoint ?? DEFAULTS.endpoint,
      name: config?.name ?? `webhook:${config?.port ?? DEFAULTS.port}`,
      hmacSecret: config?.hmacSecret,
      signatureHeader: config?.signatureHeader ?? DEFAULTS.signatureHeader,
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

  /** Stop the HTTP server. Idempotent. */
  async stop(): Promise<void> {
    if (!this.started || !this.server) return;
    this.started = false;

    return new Promise((resolve) => {
      this.server!.close(() => {
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
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }

    if (req.url !== this.config.endpoint) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
      return;
    }

    // ── Read body ────────────────────────────────────────────────────────
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks);

      // ── HMAC verification ──────────────────────────────────────────────
      if (this.config.hmacSecret) {
        const sigHeader = this.config.signatureHeader!.toLowerCase();
        const providedSig = req.headers[sigHeader] as string | undefined;

        if (!providedSig) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: `Missing ${this.config.signatureHeader} header` })
          );
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
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid signature" }));
          return;
        }
      }

      // ── Parse body ─────────────────────────────────────────────────────
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }

      // ── Normalise to LatticeEvent ──────────────────────────────────────
      if (this.config.hmacSecret) {
        const sigHeader = this.config.signatureHeader!.toLowerCase();
        const providedSig = req.headers[sigHeader] as string | undefined;
        if (providedSig) {
          const payload =
            body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
              ? (body.payload as Record<string, unknown>)
              : {};
          if (payload.signature === undefined) {
            body.payload = { ...payload, signature: providedSig };
          }
        }
      }
      const event = this.normalise(body);

      // ── Acknowledge ────────────────────────────────────────────────────
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ accepted: true, action_path: event.action_path }));

      // ── Forward to callback ────────────────────────────────────────────
      this.eventCallback?.(event);
    });

    req.on("error", (err) => {
      console.error(`[${this.name}] Request error:`, err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
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
    return {
      source: (body.source as string) ?? this.name,
      action_path: (body.action_path as string) ?? "unknown",
      payload: (body.payload as Record<string, unknown>) ?? {},
      bridge_timestamp: Date.now(),
      agent_id: (body.agent_id as string) ?? undefined,
    };
  }
}
