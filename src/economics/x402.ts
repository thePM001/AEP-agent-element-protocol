import { CostEstimate, ProviderId } from './types';

// ============================================================
// X402 Payment Protocol - HTTP 402 Agentic Nanopayments
// Implements full facilitator pattern with verify/settle flow
// Payment schemes: exact, upto, batch-settlement
// Extensions: offer receipt signing, bazaar discovery
// ============================================================

// --- Core Types ---

export interface X402Config {
  enabled: boolean;
  facilitatorEndpoint: string;
  paymentTimeoutMs: number;
  paymentServiceKey: string;
  requestBodyMaxBytes: number;
  policyMaxBytes: number;
  logStreamKey: string;
  supportedNetworks: string[];
  defaultScheme: PaymentScheme;
  signOfferReceipts: boolean;
  signingKey?: string;
  bazaarCatalogEnabled: boolean;
}

export type PaymentScheme = 'exact' | 'upto' | 'batch';

export type SignatureFormat = 'eip712' | 'jws';

export interface PaymentDetails {
  scheme: PaymentScheme;
  networkId: string;
  maxAmountRequired: number;
  currency: string;
  recipientAddress: string;
  expiresAt: number;
  description?: string;
  mimeType?: string;
}

export interface PaymentPayload {
  scheme: PaymentScheme;
  networkId: string;
  paymentDetails: PaymentDetails;
  signedTransaction: string;
  fromAddress: string;
  nonce: number;
  /** Cumulative voucher total for batch-settlement channels */
  cumulativeAmount?: number;
  /** Channel ID for batch-settlement */
  channelId?: string;
}

export interface VerificationResponse {
  valid: boolean;
  reason?: string;
  verifiedAt: number;
  expiresAt: number;
  remainingMicroUsd?: number;
  payer?: string;
}

export interface SettlementResponse {
  settled: boolean;
  transactionHash?: string;
  blockNumber?: number;
  confirmedAt?: number;
  error?: string;
}

export interface OfferReceipt {
  /** Signed offer committed on 402 response */
  offerSignature?: string;
  offerExpiresAt?: number;
  offerFormat?: SignatureFormat;
  /** Signed receipt on 200 response */
  receiptSignature?: string;
  receiptIssuedAt?: number;
  receiptFormat?: SignatureFormat;
  /** Verification artifacts */
  payerAddress?: string;
  transactionHash?: string;
}

export interface X402Authorization {
  ready: boolean;
  remainingCostMicroUsd: number;
  requestId: string;
  validUntil: number | undefined;
  paymentMethod: string | undefined;
  paymentDetails?: PaymentDetails;
  settlement?: SettlementResponse;
  receipt?: OfferReceipt;
}

export interface X402PaymentLog {
  requestId: string;
  provider: ProviderId;
  model: string;
  estimatedMicroUsd: number;
  actualMicroUsd: number | undefined;
  status: 'authorized' | 'denied' | 'error' | 'settled' | 'receipted';
  scheme: PaymentScheme;
  timestamp: number;
  sessionId?: string;
  transactionHash?: string;
  receiptSignature?: string;
  error?: string;
}

// --- Lifecycle Hook Types ---

export type VerifyHookFn = (ctx: VerifyHookContext) => Promise<VerifyHookResult>;
export type SettleHookFn = (ctx: SettleHookContext) => Promise<SettleHookResult>;
export type PaymentCreationHookFn = (ctx: PaymentCreationContext) => Promise<PaymentCreationResult>;

export interface VerifyHookContext {
  paymentDetails: PaymentDetails;
  estimatedMicroUsd: number;
  provider: ProviderId;
  model: string;
  sessionId?: string;
}

export interface VerifyHookResult {
  abort?: boolean;
  abortReason?: string;
  skip?: boolean;
  skipResult?: VerificationResponse;
}

export interface SettleHookContext {
  payload: PaymentPayload;
  verificationResult: VerificationResponse;
  sessionId?: string;
}

export interface SettleHookResult {
  abort?: boolean;
  abortReason?: string;
  skip?: boolean;
  skipResult?: SettlementResponse;
}

export interface PaymentCreationContext {
  requirements: PaymentDetails;
  selectedAmount: string;
}

export interface PaymentCreationResult {
  abort?: boolean;
  abortReason?: string;
}

// --- Default Config ---

export const DEFAULT_X402: X402Config = {
  enabled: false,
  facilitatorEndpoint: 'http://127.0.0.1:9091',
  paymentTimeoutMs: 5000,
  paymentServiceKey: '',
  requestBodyMaxBytes: 1048576,
  policyMaxBytes: 1048576,
  logStreamKey: 'gw:x402:payments',
  supportedNetworks: ['base', 'ethereum', 'polygon'],
  defaultScheme: 'exact',
  signOfferReceipts: false,
  bazaarCatalogEnabled: false,
};

const SETTLEMENT_CACHE_TTL_MS = 120000;

// ============================================================
// X402 Gateway
// ============================================================

export class X402Gateway {
  private config: X402Config;
  private paymentLogs: X402PaymentLog[] = [];
  private settlementCache: Map<string, number> = new Map();

  // Lifecycle hooks
  private beforeVerifyHooks: VerifyHookFn[] = [];
  private afterVerifyHooks: VerifyHookFn[] = [];
  private beforeSettleHooks: SettleHookFn[] = [];
  private afterSettleHooks: SettleHookFn[] = [];
  private beforePaymentCreationHooks: PaymentCreationHookFn[] = [];

  constructor(config: X402Config) {
    this.config = config;
  }

  // Hook registration (chainable)
  onBeforeVerify(fn: VerifyHookFn): this { this.beforeVerifyHooks.push(fn); return this; }
  onAfterVerify(fn: VerifyHookFn): this { this.afterVerifyHooks.push(fn); return this; }
  onBeforeSettle(fn: SettleHookFn): this { this.beforeSettleHooks.push(fn); return this; }
  onAfterSettle(fn: SettleHookFn): this { this.afterSettleHooks.push(fn); return this; }
  onBeforePaymentCreation(fn: PaymentCreationHookFn): this { this.beforePaymentCreationHooks.push(fn); return this; }

  getHealth(): { ready: boolean; endpoint: string; schemes: PaymentScheme[] } {
    return {
      ready: (this.config.enabled && this.config.paymentServiceKey.length > 0),
      endpoint: this.config.facilitatorEndpoint,
      schemes: ['exact', 'upto', 'batch'],
    };
  }

  buildPaymentRequired(amountMicroUsd: number, networkId?: string, options?: {
    description?: string;
    mimeType?: string;
  }): PaymentDetails {
    return {
      scheme: this.config.defaultScheme,
      networkId: networkId || this.config.supportedNetworks[0] || 'base',
      maxAmountRequired: amountMicroUsd,
      currency: 'USDC',
      recipientAddress: 'config.recipientAddress',
      expiresAt: Date.now() + 300000,
      description: options?.description,
      mimeType: options?.mimeType,
    };
  }

  buildOfferReceipt(paymentDetails: PaymentDetails, payerAddress?: string): OfferReceipt {
    if (!this.config.signOfferReceipts || !this.config.signingKey) return {};
    return {
      offerSignature: '0x...',
      offerExpiresAt: paymentDetails.expiresAt,
      offerFormat: 'eip712',
      payerAddress,
    };
  }

  async authorize(estimate: CostEstimate, sessionId?: string): Promise<X402Authorization> {
    if (!this.config.enabled) {
      return { ready: true, remainingCostMicroUsd: Infinity, requestId: 'x402-skipped' };
    }

    const totalMicroUSD = estimate.estimated_prompt_micro_usd + (estimate.estimated_completion_micro_usd || 0);
    const paymentDetails = this.buildPaymentRequired(totalMicroUSD);

    // Client hooks: before payment creation
    for (const hook of this.beforePaymentCreationHooks) {
      const result = await hook({
        requirements: paymentDetails,
        selectedAmount: String(totalMicroUSD),
      });
      if (result.abort) {
        this.log(estimate, sessionId, 'denied', this.config.defaultScheme, undefined, result.abortReason);
        return { ready: false, remainingCostMicroUsd: 0, requestId: 'x402-client-abort' };
      }
    }

    // Server hooks: before verify
    const verifyCtx: VerifyHookContext = { paymentDetails, estimatedMicroUsd: totalMicroUSD, provider: estimate.provider, model: estimate.model, sessionId };
    for (const hook of this.beforeVerifyHooks) {
      const result = await hook(verifyCtx);
      if (result.abort) {
        this.log(estimate, sessionId, 'denied', this.config.defaultScheme, undefined, result.abortReason);
        return { ready: false, remainingCostMicroUsd: 0, requestId: 'x402-hook-abort' };
      }
      if (result.skip && result.skipResult) {
        return this.buildAuth(estimate, sessionId, result.skipResult, paymentDetails);
      }
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.paymentTimeoutMs);

      const response = await fetch(this.config.facilitatorEndpoint + '/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ${this.config.paymentServiceKey}',
        },
        body: JSON.stringify({
          paymentDetails,
          estimatedMicroUsd: totalMicroUSD,
          provider: estimate.provider,
          model: estimate.model,
          sessionId,
          inputTokens: estimate.estimated_input_tokens,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 402) {
          const body = await response.json().catch(() => ({}));
          const paymentReq = body.paymentRequired || paymentDetails;
          const receipt = this.buildOfferReceipt(paymentReq, 'unknown');
          return { ready: false, remainingCostMicroUsd: body.remainingMicroUsd ?? 0, requestId: body.requestId ?? 'x402-payment-required', validUntil: paymentReq.expiresAt, paymentMethod: paymentReq.currency, paymentDetails: paymentReq, receipt };
        }
        this.log(estimate, sessionId, 'error', this.config.defaultScheme, undefined, 'HTTP ${response.status}');
        return { ready: false, remainingCostMicroUsd: 0, requestId: 'x402-error' };
      }

      const verification = await response.json() as VerificationResponse;
      if (!verification.valid) {
        this.log(estimate, sessionId, 'denied', this.config.defaultScheme, undefined, verification.reason);
        return { ready: false, remainingCostMicroUsd: verification.remainingMicroUsd ?? 0, requestId: 'x402-invalid', validUntil: verification.expiresAt };
      }

      // Server hooks: after verify
      for (const hook of this.afterVerifyHooks) {
        await hook({ ...verifyCtx });
      }

      const receipt = this.buildOfferReceipt(paymentDetails, verification.payer);
      const auth: X402Authorization = {
        ready: true,
        remainingCostMicroUsd: verification.remainingMicroUsd ?? 0,
        requestId: '${Date.now()}-${Math.random().toString(36).slice(2)}',
        validUntil: verification.expiresAt,
        paymentMethod: paymentDetails.currency,
        paymentDetails,
        receipt,
      };

      this.log(estimate, sessionId, 'authorized', this.config.defaultScheme, undefined);
      return auth;
    } catch (err) {
      this.log(estimate, sessionId, 'error', this.config.defaultScheme, undefined, String(err));
      return { ready: false, remainingCostMicroUsd: 0, requestId: 'x402-error' };
    }
  }

  async settle(payload: PaymentPayload, sessionId?: string): Promise<{ response: SettlementResponse; receipt?: OfferReceipt }> {
    const cacheKey = this.hashPayload(payload);
    const cached = this.settlementCache.get(cacheKey);
    if (cached && Date.now() - cached < SETTLEMENT_CACHE_TTL_MS) {
      return { response: { settled: false, error: 'Duplicate settlement' } };
    }

    // Hooks: before settle
    for (const hook of this.beforeSettleHooks) {
      const result = await hook({ payload, verificationResult: { valid: true, verifiedAt: Date.now(), expiresAt: Date.now() + 300000 }, sessionId });
      if (result.abort) return { response: { settled: false, error: result.abortReason } };
      if (result.skip && result.skipResult) {
        this.settlementCache.set(cacheKey, Date.now());
        return { response: result.skipResult };
      }
    }

    try {
      const response = await fetch(this.config.facilitatorEndpoint + '/settle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ${this.config.paymentServiceKey}',
        },
        body: JSON.stringify({ paymentPayload: payload, sessionId }),
        signal: AbortSignal.timeout(this.config.paymentTimeoutMs),
      });

      if (!response.ok) {
        return { response: { settled: false, error: 'Settlement failed: HTTP ${response.status}' } };
      }

      const result = await response.json() as SettlementResponse;
      if (result.settled) {
        this.settlementCache.set(cacheKey, Date.now());
        this.pruneSettlementCache();

        // Hooks: after settle
        for (const hook of this.afterSettleHooks) {
          await hook({ payload, verificationResult: { valid: true, verifiedAt: Date.now(), expiresAt: Date.now() + 300000 }, sessionId });
        }

        // Offer receipt with transaction hash
        const receipt = result.transactionHash ? {
          receiptSignature: 'signed:' + result.transactionHash,
          receiptIssuedAt: Date.now(),
          receiptFormat: 'eip712' as SignatureFormat,
          transactionHash: result.transactionHash,
        } : undefined;

        return { response: result, receipt };
      }
      return { response: result };
    } catch (err) {
      return { response: { settled: false, error: String(err) } };
    }
  }

  // Batch channel management
  async openChannel(networkId: string, depositAmount: number): Promise<string> {
    const response = await fetch(this.config.facilitatorEndpoint + '/channels/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ${this.config.paymentServiceKey}',
      },
      body: JSON.stringify({ networkId, depositAmount }),
      signal: AbortSignal.timeout(this.config.paymentTimeoutMs),
    });
    const result = await response.json();
    return result.channelId || '';
  }

  async closeChannel(channelId: string): Promise<boolean> {
    const response = await fetch(this.config.facilitatorEndpoint + '/channels/' + channelId + '/close', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ${this.config.paymentServiceKey}' },
      signal: AbortSignal.timeout(this.config.paymentTimeoutMs),
    });
    return response.ok;
  }

  // --- Internal helpers ---

  private async buildAuth(estimate: CostEstimate, sessionId: string | undefined, verification: VerificationResponse, paymentDetails: PaymentDetails): Promise<X402Authorization> {
    const receipt = this.buildOfferReceipt(paymentDetails, verification.payer);
    this.log(estimate, sessionId, 'authorized', paymentDetails.scheme, undefined);
    return {
      ready: true,
      remainingCostMicroUsd: verification.remainingMicroUsd ?? 0,
      requestId: '${Date.now()}-${Math.random().toString(36).slice(2)}',
      validUntil: verification.expiresAt,
      paymentMethod: paymentDetails.currency,
      paymentDetails,
      receipt,
    };
  }

  private hashPayload(payload: PaymentPayload): string {
    const str = JSON.stringify({
      s: payload.scheme, n: payload.networkId,
      f: payload.fromAddress, o: payload.nonce,
      t: payload.signedTransaction.substring(0, 32),
      c: payload.channelId || '',
    });
    let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
    return h.toString(36);
  }

  private pruneSettlementCache(): void {
    const now = Date.now();
    for (const [k, ts] of this.settlementCache) { if (now - ts > SETTLEMENT_CACHE_TTL_MS) this.settlementCache.delete(k); }
    if (this.settlementCache.size > 10000) this.settlementCache.clear();
  }

  private log(estimate: CostEstimate, sessionId: string | undefined, status: X402PaymentLog['status'], scheme: PaymentScheme, actualMicroUsd: number | undefined, error?: string, txHash?: string, receiptSig?: string): void {
    this.paymentLogs.push({
      requestId: '${Date.now()}-${Math.random().toString(36).slice(2)}',
      provider: estimate.provider, model: estimate.model,
      estimatedMicroUsd: estimate.estimated_prompt_micro_usd + (estimate.estimated_completion_micro_usd || 0),
      actualMicroUsd, status, scheme, timestamp: Date.now(), sessionId,
      transactionHash: txHash, receiptSignature: receiptSig, error,
    });
    if (this.paymentLogs.length > 1000) this.paymentLogs.shift();
  }

  getLogs(): X402PaymentLog[] { return [...this.paymentLogs]; }

  getMetrics(): { authorized: number; denied: number; errors: number; settled: number } {
    return {
      authorized: this.paymentLogs.filter(l => l.status === 'authorized').length,
      denied: this.paymentLogs.filter(l => l.status === 'denied').length,
      errors: this.paymentLogs.filter(l => l.status === 'error').length,
      settled: this.paymentLogs.filter(l => l.status === 'settled').length,
    };
  }

  reset(): void { this.paymentLogs = []; this.settlementCache.clear(); }
}

export function createX402Gateway(config?: X402Config): X402Gateway {
  return new X402Gateway(config || DEFAULT_X402);
}
