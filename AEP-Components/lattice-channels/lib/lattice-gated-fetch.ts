/**
 * AEP 2.9 lattice-gated outbound HTTP. Every external call is sealed as a lattice frame
 * for the inference_engine dock. The Base Node makes the request after Admit.
 *
 * This TypeScript file is the one source of the gated fetch. lattice-gated-fetch.js
 * next to it is emitted from this file by tsc (npm run build:gated-fetch) and CI checks
 * that the committed JavaScript matches a fresh emit (npm run check:gated-fetch).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { connect } from "node:net";
import {
  GATEWAY_ACTION_PATH,
  egressPolicyFromEnv,
  type EgressPolicy,
} from "../../egress-address/lib/egress-address.mjs";
// The name lookup and the frame seal run the aep-lattice-log binary and node in a child
// process. Their one implementation is in the lattice transport. The gated fetch uses it,
// so this module starts no process of its own.
import {
  assertUrlNotSsrf as transportAssertUrlNotSsrf,
  buildLatticeFrame as transportBuildLatticeFrame,
  resolveLatticeLogBin as transportResolveLatticeLogBin,
} from "./lattice-transport.mjs";

export { GATEWAY_ACTION_PATH };

export interface LatticeGatewayMeta {
  agentId?: string;
  channelId?: string;
  contractId?: string;
  eventType?: string;
  sessionId?: string;
  gateway?: string;
  /** Extra payload fields. They never replace url, method, gateway, headers or body. */
  payloadExtra?: Record<string, unknown>;
}

export function latticeStrictEnabled(): boolean {
  const v = process.env.AEP_LATTICE_STRICT ?? "1";
  if (v === "0") {
    // A production kill switch is refused unless the explicit dev flag is set.
    if (process.env.AEP_LATTICE_STRICT_DEV === "1") return false;
    throw new Error("AEP_LATTICE_STRICT=0 refused outside AEP_LATTICE_STRICT_DEV=1 (fail-closed)");
  }
  return true;
}

export type SsrfLookup = (host: string) => string[];
export type SsrfPolicy = EgressPolicy;

export function ssrfPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): SsrfPolicy {
  return egressPolicyFromEnv(env);
}

/**
 * The address check of AEP-Components/egress-address: the full range list, the reserved
 * names and every address of the lookup. The kernel checks the destination again before it
 * connects, against the same list. Without a lookup the name lookup of the transport runs.
 */
export function assertUrlNotSsrf(
  urlInput: string | URL,
  lookup?: SsrfLookup,
  env: NodeJS.ProcessEnv = process.env,
): void {
  transportAssertUrlNotSsrf(urlInput, lookup, env);
}

export function resolveSocketBase(): string {
  if (process.env.AEP_SOCKET_BASE) return process.env.AEP_SOCKET_BASE;
  const data = process.env.AEP_DATA || join(homedir(), ".aep");
  return join(data, "sockets");
}

/** The aep-lattice-log binary: AEP_LATTICE_LOG_BIN, AEP_LATTICE_LOG_CLI, a repository build or the installed one. */
export function resolveLatticeLogBin(): string {
  return transportResolveLatticeLogBin(process.env);
}

function resolveConfigPath(): string | undefined {
  const data = process.env.AEP_DATA || join(homedir(), ".aep");
  const path = join(data, "base-node.json");
  return existsSync(path) ? path : undefined;
}

export interface SealedLatticeFrame {
  frame: Record<string, unknown>;
  signer_public_hex?: string;
  signerPublicHex?: string;
}

/** Seal an event as a lattice frame with aep-lattice-log build-frame. */
export function buildLatticeFrame(event: Record<string, unknown>): SealedLatticeFrame {
  return transportBuildLatticeFrame(event, {
    configPath: resolveConfigPath(),
    latticeLogBin: resolveLatticeLogBin(),
  });
}

/** Map a docking port name to its Unix socket file name under the socket base. */
export function dockSuffix(dockPort: string): string {
  if (dockPort === "inference_engine") return "inference";
  if (dockPort === "validation_engine") return "validation";
  if (dockPort === "future_features") return "future";
  if (dockPort === "regulation_module") return "regulation";
  return dockPort;
}

/**
 * Write one newline-terminated line to a lattice dock Unix socket and resolve with the
 * first response line (trimmed). Rejects when the socket file is missing, on socket
 * error, on timeout, or when the peer closes before sending a full line.
 */
export function sendLatticeLine(socketPath: string, line: string, timeoutMs = 8000): Promise<string> {
  if (!existsSync(socketPath)) {
    return Promise.reject(new Error(`lattice socket not found: ${socketPath}`));
  }
  return new Promise<string>((resolve, reject) => {
    const socket = connect({ path: socketPath });
    let buf = "";
    let done = false;
    const finish = (err: Error | null, value: string): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) {
        socket.destroy();
        reject(err);
        return;
      }
      socket.end();
      resolve(value.trim());
    };
    const timer = setTimeout(() => finish(new Error("lattice socket timeout"), ""), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${line}\n`));
    socket.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl >= 0) finish(null, buf.slice(0, nl));
    });
    socket.on("error", (err) => finish(err, ""));
    socket.on("close", () => finish(new Error("lattice socket closed before a response line"), ""));
  });
}

export interface DockHttpResponse {
  status?: number;
  status_text?: string;
  headers?: string[][];
  body_b64?: string;
}

export interface DockAllowResponse {
  ok?: boolean;
  event_id?: number;
  digest?: string;
  error?: string;
  http?: DockHttpResponse;
  pending?: boolean;
  http_queued?: boolean;
}

/**
 * The digest to collect with when a dock answer is pending, otherwise undefined. A
 * pending answer without a digest is a refusal, as the dock verdict reads it.
 */
export function pendingDigest(resp: DockAllowResponse): string | undefined {
  if (resp.pending !== true) return undefined;
  const digest = typeof resp.digest === "string" ? resp.digest : "";
  if (!digest) throw new Error("lattice dock answered pending without a digest");
  return digest;
}

function parseDockAnswer(line: string): DockAllowResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("lattice dock answer is not JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("lattice dock answer is not an object");
  }
  return parsed as DockAllowResponse;
}

/**
 * Send one frame line to a dock and read its answer. The dock answers a frame with
 * pending and a digest while the frame waits for its pulse and while the gateway request
 * of the kernel is in flight. On such an answer this function writes a collect line for
 * the digest on the same connection and reads again until the answer is no longer
 * pending. The whole exchange is bounded by timeoutMs.
 */
export function exchangeDockFrame(
  socketPath: string,
  line: string,
  timeoutMs = 30000,
): Promise<DockAllowResponse> {
  if (!existsSync(socketPath)) {
    return Promise.reject(new Error(`lattice socket not found: ${socketPath}`));
  }
  return new Promise<DockAllowResponse>((resolve, reject) => {
    const socket = connect({ path: socketPath });
    let buf = "";
    let done = false;
    const finish = (err: Error | null, value?: DockAllowResponse): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err || value === undefined) {
        socket.destroy();
        reject(err ?? new Error("lattice dock gave no answer"));
        return;
      }
      socket.end();
      resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("lattice socket timeout")), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${line}\n`));
    socket.on("data", (chunk: string) => {
      buf += chunk;
      let nl = buf.indexOf("\n");
      while (nl >= 0 && !done) {
        const answerLine = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (!answerLine) continue;
        try {
          const answer = parseDockAnswer(answerLine);
          const digest = pendingDigest(answer);
          if (digest === undefined) {
            finish(null, answer);
            return;
          }
          socket.write(`${JSON.stringify({ collect: digest })}\n`);
        } catch (err) {
          finish(err instanceof Error ? err : new Error(String(err)));
          return;
        }
      }
    });
    socket.on("error", (err) => finish(err));
    socket.on("close", () => finish(new Error("lattice socket closed before a response line")));
  });
}

/** Turn a dock allow reply into a fetch Response; a reply that is not ok throws. */
export function responseFromDockAllow(resp: DockAllowResponse | null | undefined): Response {
  if (!resp || resp.ok !== true) {
    throw new Error((resp && resp.error) || "lattice frame rejected");
  }
  const http = resp.http;
  if (!http) {
    throw new Error("lattice-gated-fetch: dock allow did not return http");
  }
  const raw = String(http.body_b64 || "");
  let body = new Uint8Array(0);
  if (raw) {
    const bin = atob(raw);
    body = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) body[i] = bin.charCodeAt(i);
  }
  const headers = new Headers();
  const pairs = Array.isArray(http.headers) ? http.headers : [];
  for (const pair of pairs) {
    const [name, value] = Array.isArray(pair) ? pair : [];
    if (name !== undefined && value !== undefined) {
      headers.append(String(name), String(value));
    }
  }
  const status = Number(http.status);
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new Error(`lattice-gated-fetch: dock allow returned invalid http status ${String(http.status)}`);
  }
  // 204, 205 and 304 carry no body; the Response constructor throws if one is given.
  const nullBody = status === 204 || status === 205 || status === 304;
  return new Response(nullBody ? null : body, { status, statusText: String(http.status_text || ""), headers });
}

/** Seal the gateway event, send it to the inference dock and return its settled answer. */
async function latticeDockRequest(socketPath: string, event: Record<string, unknown>): Promise<DockAllowResponse> {
  const sealed = buildLatticeFrame(event);
  const signer = sealed.signer_public_hex || sealed.signerPublicHex || "";
  if (!signer) {
    throw new Error("signer_public_hex required for lattice dock send (fail-closed)");
  }
  const wire = JSON.stringify({ frame: sealed.frame, signer_public_hex: signer });
  const resp = await exchangeDockFrame(socketPath, wire);
  if (resp.ok !== true) {
    throw new Error(resp.error ?? "lattice frame rejected");
  }
  return resp;
}

/** The request headers as the object of text values that the kernel reads. */
function gatewayHeaders(init: RequestInit): Record<string, string> | undefined {
  if (init.headers === undefined) return undefined;
  const out: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

/** The request body as the kernel reads it: text as body, bytes as body_b64. */
function gatewayBody(init: RequestInit): { body?: string; body_b64?: string } {
  const body = init.body;
  if (body === undefined || body === null) return {};
  if (typeof body === "string") return { body };
  if (body instanceof URLSearchParams) return { body: body.toString() };
  if (body instanceof Uint8Array) return { body_b64: Buffer.from(body).toString("base64") };
  if (body instanceof ArrayBuffer) return { body_b64: Buffer.from(new Uint8Array(body)).toString("base64") };
  throw new Error("lattice-gated-fetch: the request body must be text, bytes or URLSearchParams");
}

/**
 * The lattice event that latticeGatedFetch seals for the inference_engine dock. The
 * caller fields of payloadExtra go first, so the checked url and the request fields
 * always win over them.
 */
export function buildGatewayEvent(
  url: string | URL,
  init: RequestInit = {},
  meta: LatticeGatewayMeta = {},
): Record<string, unknown> {
  const headers = gatewayHeaders(init);
  const payload: Record<string, unknown> = {
    ...(meta.payloadExtra ?? {}),
    url: String(url),
    method: init.method ?? "GET",
    gateway: meta.gateway ?? "http",
    ...(headers === undefined ? {} : { headers }),
    ...gatewayBody(init),
  };
  return {
    agent_id: meta.agentId ?? "lattice-gateway",
    channel_id: meta.channelId ?? "ch-outbound-gateway",
    contract_id: meta.contractId ?? "lattice-channel-default",
    event_type: meta.eventType ?? "LATTICE_GATEWAY_REQUEST",
    action_path: GATEWAY_ACTION_PATH,
    session_id: meta.sessionId ?? "gateway-session",
    docking_port: "inference_engine",
    payload,
  };
}

export async function latticeGatedFetch(
  url: string | URL,
  init: RequestInit = {},
  meta: LatticeGatewayMeta = {},
  socketBase?: string,
): Promise<Response> {
  assertUrlNotSsrf(url);
  if (!latticeStrictEnabled()) {
    // The dev path of AEP_LATTICE_STRICT_DEV=1 with AEP_LATTICE_STRICT=0 only.
    // eslint-disable-next-line no-restricted-globals -- the one dev path, refused outside AEP_LATTICE_STRICT_DEV=1
    return fetch(url, init);
  }
  const base = socketBase ?? resolveSocketBase();
  const inferencePath = join(base, dockSuffix("inference_engine"));
  // The dock makes the outbound request, so the socket is checked before any frame is
  // built or sent: with no dock nothing is sealed and nothing leaves.
  if (!existsSync(inferencePath)) {
    throw new Error(`inference_engine dock required for lattice-gated fetch: ${inferencePath}`);
  }
  const event = buildGatewayEvent(url, init, meta);
  const resp = await latticeDockRequest(inferencePath, event);
  return responseFromDockAllow(resp);
}
