/**
 * AEP Economics - Concurrency Limiter
 * Limits simultaneous in-flight requests with queuing
 * AEP 2.75e
 */

export class ConcurrencyLimiter {
  private maxConcurrent: number;
  private inFlight: number;
  private waitQueue: Array<() => void>;

  constructor(maxConcurrent: number = 10) {
    this.maxConcurrent = maxConcurrent;
    this.inFlight = 0;
    this.waitQueue = [];
  }

  async acquire(): Promise<void> {
    if (this.inFlight < this.maxConcurrent) { this.inFlight++; return Promise.resolve(); }
    return new Promise<void>(resolve => { this.waitQueue.push(() => { this.inFlight++; resolve(); }); });
  }

  tryAcquire(): boolean {
    if (this.inFlight < this.maxConcurrent) { this.inFlight++; return true; }
    return false;
  }

  release(): void {
    if (this.inFlight > 0) this.inFlight--;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  get active(): number { return this.inFlight; }
  get waiting(): number { return this.waitQueue.length; }
  get limit(): number { return this.maxConcurrent; }

  setLimit(n: number): void {
    this.maxConcurrent = Math.max(1, n);
    while (this.inFlight < this.maxConcurrent && this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }

  reset(): void { this.inFlight = 0; this.waitQueue = []; }

  get utilization(): number {
    return this.maxConcurrent > 0 ? this.inFlight / this.maxConcurrent : 0;
  }
}

export function createConcurrencyLimiter(maxConcurrent?: number): ConcurrencyLimiter {
  return new ConcurrencyLimiter(maxConcurrent || 10);
}
