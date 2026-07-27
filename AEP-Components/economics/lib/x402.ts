/**
 * AEP Economics - X402 Nanopayments Gateway
 * HTTP 402 Payment Required integration for nanopayment-enabled API calls
 * AEP 2.75e
 */
// @PAD: p0-v275-sec22-x402-verify-sig-v1
// @GCDE: document_sha256=p0-v275-sec22-sec28-h10-x402

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ProviderId } from './types.js';

export enum PaymentScheme { Exact = "exact", UpTo = "upto", BatchSettlement = "batch-settlement" }
export enum SignatureFormat { Ed25519 = "ed25519", Secp256k1 = "secp256k1" }

export const DEFAULT_X402 = {
  FACILITATOR_URL: process.env.X402_FACILITATOR_URL ?? "https://x402.facilitator.example",
  SETTLEMENT_CACHE_SECONDS: 120,
  PAYMENT_SCHEME: PaymentScheme.Exact,
  MAX_UNSETTLED_MICRO_USD: 10000,
} as const;

export interface X402Config {
  enabled: boolean;
  facilitator_url: string;
  service_key: string;
  default_scheme: PaymentScheme;
  settlement_cache_seconds: number;
  max_unsettled_micro_usd: number;
}

export interface X402Session {
  session_id: string; agent_id: string; scheme: PaymentScheme;
  unsettled_micro_usd: number; settled_micro_usd: number;
  created_at: number; last_settled_at?: number;
}

export interface X402VerifyRequest {
  session_id: string; agent_id: string; amount_micro_usd: number;
  scheme: PaymentScheme; signature_format?: SignatureFormat; signature?: string;
}

export interface X402VerifyResponse {
  authorized: boolean; payment_id?: string;
  max_authorized_micro_usd?: number; reason?: string;
}

export interface X402SettleRequest { session_id: string; agent_id: string; payment_ids: string[]; }

export interface X402SettleResponse {
  settled: boolean; total_settled_micro_usd: number;
  settlement_id?: string; error?: string;
}

export interface X402Metrics {
  total_sessions: number; active_sessions: number;
  total_verified_micro_usd: number; total_settled_micro_usd: number;
  pending_settlements: number; failed_verifications: number; failed_settlements: number;
}

export class X402Gateway {
  private config: X402Config;
  private sessions: Map<string, X402Session>;
  private metrics: X402Metrics;

  constructor(config: Partial<X402Config> = {}) {
    this.config = {
      enabled: false,
      facilitator_url: DEFAULT_X402.FACILITATOR_URL,
      service_key: "",
      default_scheme: DEFAULT_X402.PAYMENT_SCHEME,
      settlement_cache_seconds: DEFAULT_X402.SETTLEMENT_CACHE_SECONDS,
      max_unsettled_micro_usd: DEFAULT_X402.MAX_UNSETTLED_MICRO_USD,
      ...config,
    };
    this.sessions = new Map();
    this.metrics = { total_sessions: 0, active_sessions: 0, total_verified_micro_usd: 0, total_settled_micro_usd: 0, pending_settlements: 0, failed_verifications: 0, failed_settlements: 0 };
  }

  createSession(agentId: string, scheme?: PaymentScheme): X402Session {
    const safeAgentId = X402Gateway.sanitizeAgentId(agentId);
    const existing = this.sessions.get(safeAgentId);
    if (existing) return existing;
    const session: X402Session = {
      session_id: "x402-" + safeAgentId + "-" + randomUUID(),
      agent_id: safeAgentId,
      scheme: scheme || this.config.default_scheme,
      unsettled_micro_usd: 0, settled_micro_usd: 0, created_at: Date.now(),
    };
    this.sessions.set(safeAgentId, session);
    this.metrics.total_sessions++; this.metrics.active_sessions++;
    return session;
  }

  async verify(request: X402VerifyRequest): Promise<X402VerifyResponse> {
    // HIGH residual: disabled path must not authorize payment (was authorized:true)
    if (!this.config.enabled) {
      return { authorized: false, reason: "X402 disabled (fail-closed)" };
    }
    let agentId: string;
    try {
      agentId = X402Gateway.sanitizeAgentId(request.agent_id);
    } catch {
      this.metrics.failed_verifications++;
      return { authorized: false, reason: "Invalid agent_id" };
    }
    const session = this.sessions.get(agentId);
    if (!session) { this.metrics.failed_verifications++; return { authorized: false, reason: "No active session" }; }
    if (!Number.isFinite(request.amount_micro_usd) || request.amount_micro_usd <= 0) {
      this.metrics.failed_verifications++;
      return { authorized: false, reason: "amount_micro_usd must be positive" };
    }
    // SEC-22: payment signature mandatory when enabled
    if (!request.signature || !request.signature_format) {
      this.metrics.failed_verifications++;
      return { authorized: false, reason: "Payment signature required" };
    }
    if (!this.verifyPaymentSignature(request, agentId)) {
      this.metrics.failed_verifications++;
      return { authorized: false, reason: "Payment signature invalid" };
    }
    if (session.unsettled_micro_usd + request.amount_micro_usd > this.config.max_unsettled_micro_usd) {
      const settled = await this.settle({ session_id: session.session_id, agent_id: agentId, payment_ids: [] });
      if (!settled.settled) { this.metrics.failed_verifications++; return { authorized: false, reason: "Settlement required" }; }
    }
    // H-10: re-check cap after auto-settlement
    if (session.unsettled_micro_usd + request.amount_micro_usd > this.config.max_unsettled_micro_usd) {
      this.metrics.failed_verifications++;
      return { authorized: false, reason: "Exceeds max unsettled after settlement" };
    }
    session.unsettled_micro_usd += request.amount_micro_usd;
    this.metrics.total_verified_micro_usd += request.amount_micro_usd;
    this.metrics.pending_settlements++;
    return {
      authorized: true,
      payment_id: "pay-" + randomUUID(),
      max_authorized_micro_usd: this.config.max_unsettled_micro_usd - session.unsettled_micro_usd,
    };
  }

  private verifyPaymentSignature(request: X402VerifyRequest, agentId: string): boolean {
    // BM-20: only HMAC-SHA256 is implemented. Ed25519/Secp256k1 claims must fail closed.
    const fmt = String(request.signature_format ?? "").toLowerCase();
    if (fmt === "ed25519" || fmt === "secp256k1") {
      return false;
    }
    if (fmt && fmt !== "hmac-sha256" && fmt !== "hmac_sha256" && fmt !== "hmac") {
      return false;
    }
    if (!this.config.service_key) return false;
    const payload = [
      request.session_id,
      agentId,
      String(request.amount_micro_usd),
      String(request.scheme),
    ].join("|");
    const expected = createHmac("sha256", this.config.service_key).update(payload).digest("hex");
    const got = (request.signature ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(got) || got.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(got, "hex"));
    } catch {
      return false;
    }
  }

  static sanitizeAgentId(agentId: string): string {
    const raw = String(agentId ?? "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw)) {
      throw new Error("Invalid agentId for X402 session");
    }
    return raw;
  }

  async settle(request: X402SettleRequest): Promise<X402SettleResponse> {
    if (!this.config.enabled) return { settled: true, total_settled_micro_usd: 0 };
    const session = this.sessions.get(request.agent_id);
    if (!session) {
      this.metrics.failed_settlements++;
      return { settled: false, total_settled_micro_usd: 0, error: "No active session" };
    }
    const amount = session.unsettled_micro_usd;
    if (amount <= 0) {
      return { settled: true, total_settled_micro_usd: 0, settlement_id: `noop-${session.session_id}` };
    }

    const settlement = await this.submitFacilitatorSettlement(session, request, amount);
    if (!settlement.ok) {
      this.metrics.failed_settlements++;
      return {
        settled: false,
        total_settled_micro_usd: 0,
        error: settlement.error ?? "Facilitator settlement failed",
      };
    }
    session.settled_micro_usd += amount;
    session.unsettled_micro_usd = 0;
    session.last_settled_at = Date.now();
    this.metrics.total_settled_micro_usd += amount;
    this.metrics.pending_settlements = Math.max(0, this.metrics.pending_settlements - 1);
    return {
      settled: true,
      total_settled_micro_usd: amount,
      settlement_id: settlement.settlementId,
    };
  }

  private async submitFacilitatorSettlement(
    session: X402Session,
    request: X402SettleRequest,
    amount: number,
  ): Promise<{ ok: boolean; settlementId?: string; error?: string }> {
    const url = `${this.config.facilitator_url.replace(/\/$/, "")}/v1/settle`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.service_key}`,
        },
        body: JSON.stringify({
          session_id: request.session_id,
          agent_id: request.agent_id,
          payment_ids: request.payment_ids,
          amount_micro_usd: amount,
          scheme: session.scheme,
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          settlement_id?: string;
          id?: string;
        };
        return {
          ok: true,
          settlementId:
            data.settlement_id ?? data.id ?? `facilitator-${session.session_id}-${Date.now()}`,
        };
      }
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Facilitator returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Facilitator unreachable",
      };
    }
  }

  getMetrics(): X402Metrics { return { ...this.metrics }; }

  async closeSession(agentId: string): Promise<X402SettleResponse> {
    const session = this.sessions.get(agentId);
    if (!session) return { settled: true, total_settled_micro_usd: 0 };
    const result = await this.settle({ session_id: session.session_id, agent_id: agentId, payment_ids: [] });
    this.sessions.delete(agentId);
    this.metrics.active_sessions = Math.max(0, this.metrics.active_sessions - 1);
    return result;
  }

  getSession(agentId: string): X402Session | null { return this.sessions.get(agentId) || null; }
  get activeSessionCount(): number { return this.sessions.size; }
  get isEnabled(): boolean { return this.config.enabled; }

  health(): { enabled: boolean; facilitator: string; active_sessions: number; metrics: X402Metrics } {
    return { enabled: this.config.enabled, facilitator: this.config.facilitator_url, active_sessions: this.sessions.size, metrics: this.getMetrics() };
  }

  validate(): string[] {
    const errors: string[] = [];
    if (this.config.enabled) {
      if (!this.config.facilitator_url) errors.push("facilitator_url is required when X402 is enabled");
      if (!this.config.service_key) errors.push("service_key is required when X402 is enabled");
    }
    return errors;
  }
}

export function createX402Gateway(config?: Partial<X402Config>): X402Gateway {
  return new X402Gateway(config);
}
