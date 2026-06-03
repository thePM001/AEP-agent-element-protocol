/**
 * AEP Economics - X402 Nanopayments Gateway
 * HTTP 402 Payment Required integration for nanopayment-enabled API calls
 * AEP 2.75e
 */

import { ProviderId } from './types';

export enum PaymentScheme { Exact = "exact", UpTo = "upto", BatchSettlement = "batch-settlement" }
export enum SignatureFormat { Ed25519 = "ed25519", Secp256k1 = "secp256k1" }

export const DEFAULT_X402 = {
  FACILITATOR_URL: "https://x402.facilitator.nla.biosecure",
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
    const existing = this.sessions.get(agentId);
    if (existing) return existing;
    const session: X402Session = {
      session_id: "x402-" + agentId + "-" + Date.now(),
      agent_id: agentId,
      scheme: scheme || this.config.default_scheme,
      unsettled_micro_usd: 0, settled_micro_usd: 0, created_at: Date.now(),
    };
    this.sessions.set(agentId, session);
    this.metrics.total_sessions++; this.metrics.active_sessions++;
    return session;
  }

  async verify(request: X402VerifyRequest): Promise<X402VerifyResponse> {
    if (!this.config.enabled) return { authorized: true, reason: "X402 disabled" };
    const session = this.sessions.get(request.agent_id);
    if (!session) { this.metrics.failed_verifications++; return { authorized: false, reason: "No active session" }; }
    if (session.unsettled_micro_usd + request.amount_micro_usd > this.config.max_unsettled_micro_usd) {
      const settled = await this.settle({ session_id: session.session_id, agent_id: request.agent_id, payment_ids: [] });
      if (!settled.settled) { this.metrics.failed_verifications++; return { authorized: false, reason: "Settlement required" }; }
    }
    session.unsettled_micro_usd += request.amount_micro_usd;
    this.metrics.total_verified_micro_usd += request.amount_micro_usd;
    return { authorized: true, max_authorized_micro_usd: this.config.max_unsettled_micro_usd - session.unsettled_micro_usd };
  }

  async settle(request: X402SettleRequest): Promise<X402SettleResponse> {
    if (!this.config.enabled) return { settled: true, total_settled_micro_usd: 0 };
    const session = this.sessions.get(request.agent_id);
    if (!session) { this.metrics.failed_settlements++; return { settled: false, total_settled_micro_usd: 0, error: "No active session" }; }
    const amount = session.unsettled_micro_usd;
    session.settled_micro_usd += amount; session.unsettled_micro_usd = 0; session.last_settled_at = Date.now();
    this.metrics.total_settled_micro_usd += amount;
    this.metrics.pending_settlements = Math.max(0, this.metrics.pending_settlements - 1);
    return { settled: true, total_settled_micro_usd: amount, settlement_id: "settle-" + session.session_id + "-" + Date.now() };
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
