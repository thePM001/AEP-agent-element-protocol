export class ConcurrencyLimiter {
  private maxConcurrent: number;
  private active: number = 0;
  private waitQueue: Array<(r: void) => void> = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }
    return new Promise(resolve => this.waitQueue.push(resolve));
  }

  release(): void {
    this.active--;
    if (this.active < 0) this.active = 0;
    if (this.waitQueue.length > 0) {
      this.active++;
      const resolve = this.waitQueue.shift()!;
      resolve();
    }
  }

  getActive(): number {
    return this.active;
  }

  getWaiting(): number {
    return this.waitQueue.length;
  }
}

export function createConcurrencyLimiter(maxConcurrent: number): ConcurrencyLimiter {
  return new ConcurrencyLimiter(maxConcurrent);
}
