// AEP UCM TypeScript client. Talks to aep-ucm over HTTP; the service listens on loopback
// port 8414 unless UCM_HOST and UCM_PORT say otherwise.
// Uses the global fetch of Node 18+ and browsers; it has no dependencies.

export type ResultValue =
  | { type: "int" | "decimal" | "float" | "bool" | "date" | "text"; value: string }
  | { type: "rational"; value: string; decimal?: string }
  | { type: "money"; currency: string; value: string; decimal?: string }
  | { type: "quantity"; unit: string; value: string }
  | { type: "interval"; lo: string; hi: string }
  | { type: "instant"; value: string; seconds: string }
  | { type: "vector"; items: ResultValue[] };

/** A signed receipt, schema ucm-receipt-v1. Every scalar is a string. */
export interface Receipt {
  ucm: "ucm-receipt-v1";
  receipt_id: string;
  program: unknown;
  program_hash: string;
  inputs: Record<string, unknown>;
  input_digest: string;
  library_digests: string[];
  engine_build: string;
  budget_limits: Record<string, string>;
  budget_used: Record<string, string>;
  float_used: "true" | "false";
  program_source: "agent" | "library";
  result: ResultValue;
  result_digest: string;
  node_id: string;
  public_key: string;
  issued_at: string;
  signature: string;
}

export interface EvalReply {
  ok: true;
  result: ResultValue;
  result_type: string;
  receipt_id: string;
  receipt: Receipt;
  ledger: Record<string, string>;
}

export interface CatalogEntry {
  id: string;
  kind: "function" | "unit" | "constant" | "formula";
  name: string;
  category: string;
  signature: string;
  description: string;
  aliases: string[];
  example: string;
  citation?: string;
  library_digest?: string;
}

export interface LookupReply {
  ucm: "ucm-lookup-reply-v1";
  query: string;
  tier: "tier1" | "tier2";
  library_digest: string;
  note: string;
  entries: { score: string; entry: CatalogEntry }[];
}

export interface VerifyReply {
  ok: true;
  mode: "signature" | "replay";
  receipt_id: string;
  node_id: string;
  trusted: "true" | "false";
}

export class UcmError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(`${code}: ${message}`);
  }
}

export interface UcmClientOptions {
  /** Address of the aep-ucm service, for example the loopback address on port 8414. */
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class UcmClient {
  private baseUrl: string;
  private apiKey: string | undefined;
  private fetchImpl: typeof fetch;

  constructor(opts: UcmClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    // Call the fetch function unbound: browser fetch throws "Illegal invocation" when it
    // is called as a method of another object.
    const fetchFn = this.fetchImpl;
    const res = await fetchFn(`${this.baseUrl}${path}`, init);
    let data: { ok?: boolean; error?: { code: string; message: string } };
    try {
      data = (await res.json()) as { ok?: boolean; error?: { code: string; message: string } };
    } catch {
      // A proxy or crash page answers with HTML or an empty body; report it as a UcmError.
      throw new UcmError(res.ok ? "bad_response" : "http_error", res.ok ? "response body is not JSON" : res.statusText, res.status);
    }
    if (!res.ok || data.ok === false) {
      throw new UcmError(data.error?.code ?? "http_error", data.error?.message ?? res.statusText, res.status);
    }
    return data as T;
  }

  /** System-1 lookup: which function, unit, constant or formula fits the task. Never a result. */
  lookup(query: string, k = 5): Promise<LookupReply> {
    return this.call("POST", "/ucm/v1/lookup", { query, k: String(k) });
  }

  /** Evaluate a UCM-IR program. Inputs are strings: "12.50 EUR", "9.81 m/s^2", "1/3". */
  evaluate(program: string, inputs: Record<string, string | boolean | string[]> = {}, opts: { libraryFormula?: string; budget?: Record<string, string> } = {}): Promise<EvalReply> {
    return this.call("POST", "/ucm/v1/eval", { program, inputs, library_formula: opts.libraryFormula, budget: opts.budget });
  }

  verify(receipt: Receipt | string, mode: "signature" | "replay" = "signature"): Promise<VerifyReply> {
    return this.call("POST", "/ucm/v1/verify", { receipt, mode });
  }

  explain(program: string): Promise<Record<string, unknown>> {
    return this.call("POST", "/ucm/v1/explain", { program });
  }

  capabilities(): Promise<Record<string, unknown>> {
    return this.call("GET", "/ucm/v1/capabilities");
  }

  /**
   * Attach receipts to an action payload so Admit (policy ucm-computed-claims) can check the
   * fields that the task manifest declares as computed. Keys are JSON pointers such as "/total".
   */
  static attachReceipts(payload: Record<string, unknown>, receipts: Record<string, Receipt>): Record<string, unknown> {
    const ucm = (payload["ucm"] as Record<string, unknown> | undefined) ?? {};
    return { ...payload, ucm: { ...ucm, receipts: { ...(ucm["receipts"] as object | undefined), ...receipts } } };
  }
}
