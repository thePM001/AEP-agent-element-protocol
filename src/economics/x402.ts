import { CostEstimate, ProviderId } from './types';

export interface X402Config {
  enabled: boolean;
  paymentEndpoint: string;
  paymentTimeoutMs: number;
  paymentServiceKey: string;
  requestBodyMaxBytes: number;
  policyMaxBytes: number;
  logStreamKey: string;
}

export interface X402Authorization {
  ready: boolean;
  remainingCostMicroUsd: number;
  requestId: string;
  validUntil: number | undefined;
  paymentMethod: string | undefined;
}

export interface X402PaymentLog {
  requestId: string;
  provider: ProviderId;
  model: string;
  estimatedMicroUsd: number;
  actualMicroUsd: number | undefined;
  status: 'authorized' | 'denied' | 'error';
  timestamp: number;
  sessionId?: string;
  error?: string;
}

export const DEFAULT_X402: X402Config = {
  enabled: false,
  paymentEndpoint: 'http://127.0.0.1:9091/payment',
  paymentTimeoutMs: 5000,
  paymentServiceKey: '',
  requestBodyMaxBytes: 1048576,
  policyMaxBytes: 1048576,
  logStreamKey: 'gw:x402:payments',
};

export class X402Gateway {
  private config: X402Config;
  private paymentLogs: X402PaymentLog[] = [];

  constructor(config: X402Config) {
    this.config = config;
  }

  getHealth(): { ready: boolean; endpoint: string } {
    return {
      ready: (this.config.enabled && this.config.paymentServiceKey.length > 0),
      endpoint: this.config.paymentEndpoint,
    };
  }

  async authorize(estimate: CostEstimate, sessionId?: string): Promise<X402Authorization> {
    if (!this.config.enabled) {
      return { ready: true, remainingCostMicroUsd: Infinity, requestId: 'x402-skipped' };
    }

    const totalMicroUSD = estimate.estimated_prompt_micro_usd + (estimate.estimated_completion_micro_usd || 0);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.paymentTimeoutMs);

      const response = await fetch(this.config.paymentEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ${this.config.paymentServiceKey}',
        },
        body: JSON.stringify({
          estimatedMicroUsd: totalMicroUSD,
          provider: estimate.provider,
          model: estimate.model,
          sessionId: sessionId,
          inputTokens: estimate.estimated_input_tokens,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 402) {
          const body = await response.json().catch(() => ({}));
          return {
            ready: false,
            remainingCostMicroUsd: body.remainingMicroUsd ?? 0,
            requestId: body.requestId ?? 'x402-denied',
            validUntil: body.validUntil,
            paymentMethod: body.paymentMethod,
          };
        }

        this.log(estimate, sessionId, 'error', undefined, 'HTTP ${response.status}');
        return { ready: false, remainingCostMicroUsd: 0, requestId: 'x402-error' };
      }

      const auth = await response.json() as X402Authorization;
      if (!auth.ready) {
        this.log(estimate, sessionId, 'denied', undefined, 'Payment not ready');
      } else {
        this.log(estimate, sessionId, 'authorized', undefined);
      }

      return auth;
    } catch (err) {
      this.log(estimate, sessionId, 'error', undefined, String(err));
      return { ready: false, remainingCostMicroUsd: 0, requestId: 'x402-error' };
    }
  }

  private log(
    estimate: CostEstimate,
    sessionId: string | undefined,
    status: X402PaymentLog['status'],
    actualMicroUsd: number | undefined,
    error?: string
  ): void {
    const entry: X402PaymentLog = {
      requestId: '${Date.now()}-${Math.random().toString(36).slice(2)}',
      provider: estimate.provider,
      model: estimate.model,
      estimatedMicroUsd: estimate.estimated_prompt_micro_usd + (estimate.estimated_completion_micro_usd || 0),
      actualMicroUsd,
      status,
      timestamp: Date.now(),
      sessionId,
      error,
    };
    this.paymentLogs.push(entry);
    if (this.paymentLogs.length > 1000) this.paymentLogs.shift();
  }

  getLogs(): X402PaymentLog[] {
    return [...this.paymentLogs];
  }

  getMetrics(): { authorized: number; denied: number; errors: number } {
    const authorized = this.paymentLogs.filter(l => l.status === 'authorized').length;
    const denied = this.paymentLogs.filter(l => l.status === 'denied').length;
    const err = this.paymentLogs.filter(l => l.status === 'error').length;
    return { authorized, denied, errors: err };
  }

  reset(): void {
    this.paymentLogs = [];
  }
}

export function createX402Gateway(config?: X402Config): X402Gateway {
  return new X402Gateway(config || DEFAULT_X402);
}
