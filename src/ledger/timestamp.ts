export interface TimestampRequest {
  entryHash: string;
  queuedAt: number;
  token?: string;
}

export interface TimestampQueueOptions {
  tsaUrl?: string;
  batchSize?: number;
  flushIntervalMs?: number;
}

export class TimestampQueue {
  private queue: TimestampRequest[] = [];
  private processed: Map<string, string> = new Map();
  private options: Required<TimestampQueueOptions>;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: TimestampQueueOptions) {
    this.options = {
      tsaUrl: options?.tsaUrl ?? "",
      batchSize: options?.batchSize ?? 10,
      flushIntervalMs: options?.flushIntervalMs ?? 5000,
    };
  }

  enqueue(entryHash: string): void {
    this.queue.push({ entryHash, queuedAt: Date.now() });
  }

  async flush(): Promise<void> {
    const batch = this.queue.splice(0, this.options.batchSize);
    if (batch.length === 0) return;

    for (const req of batch) {
      try {
        const token = await this.requestTimestamp(req.entryHash);
        req.token = token;
        this.processed.set(req.entryHash, token);
      } catch {
        // TSA unreachable - entry remains valid via hash chain
        this.processed.set(req.entryHash, "offline:" + Date.now().toString(36));
      }
    }
  }

  getToken(entryHash: string): string | undefined {
    return this.processed.get(entryHash);
  }

  getPending(): number {
    return this.queue.length;
  }

  getProcessed(): number {
    return this.processed.size;
  }

  startAutoFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), this.options.flushIntervalMs);
  }

  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async requestTimestamp(hash: string): Promise<string> {
    if (!this.options.tsaUrl) {
      // No TSA configured - generate local timestamp token
      const { createHash } = await import("node:crypto");
      const token = createHash("sha256")
        .update(hash + Date.now().toString())
        .digest("hex");
      return "local:" + token.substring(0, 32);
    }

    // In production, this would make an HTTP request to the TSA
    // RFC 3161 TimeStampReq -> TimeStampResp
    throw new Error("TSA request not implemented for URL: " + this.options.tsaUrl);
  }
}
