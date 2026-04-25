// AEP 2.5 -- Commerce Spend Tracker
// Tracks cumulative daily spend across all sessions.
// Persists to .aep/commerce/spend.jsonl

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

interface SpendEntry {
  date: string;
  amount: number;
  currency: string;
  ts: string;
}

export class SpendTracker {
  private maxDaily: number;
  private currency: string;
  private todayTotal: number = 0;
  private todayDate: string;
  private filePath: string;

  constructor(maxDaily: number, currency: string, baseDir: string = ".aep/commerce") {
    this.maxDaily = maxDaily;
    this.currency = currency;
    this.filePath = join(baseDir, "spend.jsonl");
    this.todayDate = this.dateKey();
    this.loadToday();
  }

  private dateKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private loadToday(): void {
    const today = this.dateKey();
    this.todayDate = today;
    this.todayTotal = 0;

    if (!existsSync(this.filePath)) return;

    try {
      const content = readFileSync(this.filePath, "utf-8").trim();
      if (!content) return;

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry: SpendEntry = JSON.parse(line);
          if (entry.date === today) {
            this.todayTotal += entry.amount;
          }
        } catch {
          // Skip malformed entries
        }
      }
    } catch {
      // File not readable
    }
  }

  private ensureDir(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  record(amount: number): void {
    const today = this.dateKey();
    if (today !== this.todayDate) {
      this.todayDate = today;
      this.todayTotal = 0;
    }

    this.todayTotal += amount;

    this.ensureDir();
    const entry: SpendEntry = {
      date: today,
      amount,
      currency: this.currency,
      ts: new Date().toISOString(),
    };
    appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
  }

  canSpend(amount: number): boolean {
    const today = this.dateKey();
    if (today !== this.todayDate) {
      this.todayDate = today;
      this.todayTotal = 0;
    }

    if (this.maxDaily <= 0) return true;
    return (this.todayTotal + amount) <= this.maxDaily;
  }

  getToday(): number {
    const today = this.dateKey();
    if (today !== this.todayDate) {
      this.todayDate = today;
      this.todayTotal = 0;
    }
    return this.todayTotal;
  }

  getMaxDaily(): number {
    return this.maxDaily;
  }

  getCurrency(): string {
    return this.currency;
  }

  reset(): void {
    this.todayTotal = 0;
    this.todayDate = this.dateKey();
  }
}
