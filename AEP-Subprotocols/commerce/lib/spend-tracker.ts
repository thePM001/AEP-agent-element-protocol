// BL-X2: TS SpendTracker with exclusive lockfile (fail-closed multi-process)
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface SpendEntry {
  date: string;
  amount: number;
  currency: string;
  ts: string;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Exclusive lock via O_EXCL lockfile with retry.
 * Multi-process safe on local FS (not NFS-perfect).
 */
function withExclusiveLock<T>(lockPath: string, fn: () => T): T {
  const parent = dirname(lockPath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const maxAttempts = 50;
  let fd: number | null = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch {
      // spin briefly
      const end = Date.now() + 20;
      while (Date.now() < end) {
        /* busy wait */
      }
    }
  }
  if (fd === null) {
    throw new Error("spend ledger lock timeout (fail-closed)");
  }
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Daily spend tracker aligned with Rust SpendTracker semantics.
 */
export class SpendTracker {
  private maxDaily: number;
  private currency: string;
  private filePath: string;
  private lockPath: string;
  private todayTotal = 0;
  private today = todayDate();

  constructor(maxDaily: number, currency: string, baseDir: string) {
    this.maxDaily = maxDaily;
    this.currency = currency;
    this.filePath = join(baseDir, "spend.jsonl");
    this.lockPath = join(baseDir, "spend.jsonl.lock");
    this.reloadUnlocked();
  }

  private reloadUnlocked(): void {
    this.today = todayDate();
    this.todayTotal = 0;
    if (!existsSync(this.filePath)) return;
    const text = readFileSync(this.filePath, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as SpendEntry;
        if (e.date === this.today) this.todayTotal += Number(e.amount) || 0;
      } catch {
        // skip corrupt line
      }
    }
  }

  record(amount: number): void {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("amount must be finite and non-negative");
    }
    withExclusiveLock(this.lockPath, () => {
      this.reloadUnlocked();
      const day = todayDate();
      if (day !== this.today) {
        this.today = day;
        this.todayTotal = 0;
      }
      const parent = dirname(this.filePath);
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
      const entry: SpendEntry = {
        date: day,
        amount,
        currency: this.currency,
        ts: nowIso(),
      };
      appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf8");
      this.todayTotal += amount;
    });
  }

  /**
   * Atomic check+record under exclusive lock (MEDIUM multi-process race closed).
   */
  reserveAndRecord(amount: number): boolean {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("amount must be finite and non-negative");
    }
    return withExclusiveLock(this.lockPath, () => {
      this.reloadUnlocked();
      // fail-closed: maxDaily <= 0 denies positive spend
      if (this.maxDaily <= 0) return false;
      if (this.todayTotal + amount > this.maxDaily) return false;
      const day = todayDate();
      const parent = dirname(this.filePath);
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
      const entry: SpendEntry = {
        date: day,
        amount,
        currency: this.currency,
        ts: nowIso(),
      };
      appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf8");
      this.todayTotal += amount;
      return true;
    });
  }

  canSpend(amount: number): boolean {
    return withExclusiveLock(this.lockPath, () => {
      this.reloadUnlocked();
      if (this.maxDaily <= 0) return false;
      return this.todayTotal + amount <= this.maxDaily;
    });
  }

  getTodayTotal(): number {
    return withExclusiveLock(this.lockPath, () => {
      this.reloadUnlocked();
      return this.todayTotal;
    });
  }
}

export function ensureSpendFile(path: string): void {
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  if (!existsSync(path)) writeFileSync(path, "", "utf8");
}
