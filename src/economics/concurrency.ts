export class ConcurrencyLimiter {
  private maxConcurrent: number;
  private active: number = 0;
  private waitQueue: Array<() => void> = [];
  private acquired: Set<symbol> = new Set();

  constructor(maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  async acquire(): Promise<symbol> {
    const token = Symbol("acquire");
    if (this.active < this.maxConcurrent) {
      this.active++;
      this.acquired.add(token);
      return token;
    }
    return new Promise(resolve => {
      this.waitQueue.push(() => {
        this.active++;
        this.acquired.add(token);
        resolve(token);
      });
    });
  }

  release(token: symbol): void {
    if (!this.acquired.has(token)) return;
    this.acquired.delete(token);
    this.active--;
    if (this.active < 0) this.active = 0;
    if (this.waitQueue.length > 0) {
      this.active++;
      const resolve = this.waitQueue.shift()!;
      resolve();
    }
  }

  getActive(): number { return this.active; }
  getWaiting(): number { return this.waitQueue.length; }
}

export function createConcurrencyLimiter(maxConcurrent: number): ConcurrencyLimiter {
  return new ConcurrencyLimiter(maxConcurrent);
}
