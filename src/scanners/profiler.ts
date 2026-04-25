// AEP 2.5 -- Data Profiling Scanner
// Statistical checks on tabular and structured data.
// Detects null rates, duplicates, outliers, schema drift and class imbalance.
// Disabled by default -- opt-in via policy `scanners.profiler.enabled: true`.

import type { Finding, Scanner } from "./types.js";
import type { ViolationSeverity } from "../recovery/types.js";

export interface DataProfileScannerConfig {
  enabled: boolean;
  severity: ViolationSeverity;
  null_rate_threshold: number;
  duplicate_rate_threshold: number;
  outlier_stddev: number;
  imbalance_ratio: number;
}

export const DEFAULT_PROFILER_CONFIG: DataProfileScannerConfig = {
  enabled: false,
  severity: "soft",
  null_rate_threshold: 0.3,
  duplicate_rate_threshold: 0.5,
  outlier_stddev: 3.0,
  imbalance_ratio: 10.0,
};

interface ColumnProfile {
  name: string;
  totalRows: number;
  nullCount: number;
  values: string[];
}

export class DataProfileScanner implements Scanner {
  name = "profiler";
  private severity: ViolationSeverity;
  private nullRateThreshold: number;
  private duplicateRateThreshold: number;
  private outlierStddev: number;
  private imbalanceRatio: number;

  constructor(config?: Partial<DataProfileScannerConfig>) {
    this.severity = config?.severity ?? DEFAULT_PROFILER_CONFIG.severity;
    this.nullRateThreshold = config?.null_rate_threshold ?? DEFAULT_PROFILER_CONFIG.null_rate_threshold;
    this.duplicateRateThreshold = config?.duplicate_rate_threshold ?? DEFAULT_PROFILER_CONFIG.duplicate_rate_threshold;
    this.outlierStddev = config?.outlier_stddev ?? DEFAULT_PROFILER_CONFIG.outlier_stddev;
    this.imbalanceRatio = config?.imbalance_ratio ?? DEFAULT_PROFILER_CONFIG.imbalance_ratio;
  }

  scan(content: string): Finding[] {
    const findings: Finding[] = [];
    const trimmed = content.trim();
    if (!trimmed) return findings;

    // Attempt JSON array parse first, fall back to CSV
    let rows: Record<string, string>[] | null = null;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null) {
        rows = parsed.map((row: Record<string, unknown>) => {
          const mapped: Record<string, string> = {};
          for (const [k, v] of Object.entries(row)) {
            mapped[k] = v === null || v === undefined ? "" : String(v);
          }
          return mapped;
        });
      }
    } catch {
      // Not JSON -- try CSV
    }

    if (!rows) {
      rows = this.parseCSV(trimmed);
    }

    if (!rows || rows.length === 0) return findings;

    const columns = this.profileColumns(rows);

    // Check 1: Null rate per column
    for (const col of columns) {
      const nullRate = col.nullCount / col.totalRows;
      if (nullRate > this.nullRateThreshold) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: `${col.name}: ${(nullRate * 100).toFixed(1)}% null`,
          position: 0,
          category: "profiler:null_rate",
        });
      }
    }

    // Check 2: Duplicate rows
    const rowStrings = rows.map((r) => JSON.stringify(r));
    const uniqueRows = new Set(rowStrings);
    const duplicateRate = 1 - uniqueRows.size / rowStrings.length;
    if (duplicateRate > this.duplicateRateThreshold) {
      findings.push({
        scanner: this.name,
        severity: this.severity,
        match: `${(duplicateRate * 100).toFixed(1)}% duplicate rows`,
        position: 0,
        category: "profiler:duplicate_rate",
      });
    }

    // Check 3: Outliers in numeric columns (z-score)
    for (const col of columns) {
      const numericValues = col.values
        .filter((v) => v !== "" && !isNaN(Number(v)))
        .map(Number);

      if (numericValues.length < 3) continue;

      const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
      const variance = numericValues.reduce((a, b) => a + (b - mean) ** 2, 0) / numericValues.length;
      const stddev = Math.sqrt(variance);

      if (stddev === 0) continue;

      let outlierCount = 0;
      for (const val of numericValues) {
        if (Math.abs((val - mean) / stddev) > this.outlierStddev) {
          outlierCount++;
        }
      }

      if (outlierCount > 0) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: `${col.name}: ${outlierCount} outlier(s) beyond ${this.outlierStddev} stddev`,
          position: 0,
          category: "profiler:outlier",
        });
      }
    }

    // Check 4: Schema consistency (rows with different column counts)
    if (rows.length > 1) {
      const expectedKeys = Object.keys(rows[0]).sort().join(",");
      let inconsistentCount = 0;
      for (let i = 1; i < rows.length; i++) {
        const rowKeys = Object.keys(rows[i]).sort().join(",");
        if (rowKeys !== expectedKeys) {
          inconsistentCount++;
        }
      }
      if (inconsistentCount > 0) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: `${inconsistentCount} row(s) with inconsistent schema`,
          position: 0,
          category: "profiler:schema_inconsistency",
        });
      }
    }

    // Check 5: Class imbalance (last column treated as label if categorical)
    if (columns.length > 0) {
      const labelCol = columns[columns.length - 1];
      const nonEmpty = labelCol.values.filter((v) => v !== "");
      const labelCounts = new Map<string, number>();
      for (const v of nonEmpty) {
        labelCounts.set(v, (labelCounts.get(v) ?? 0) + 1);
      }

      if (labelCounts.size >= 2 && labelCounts.size <= 50) {
        const counts = Array.from(labelCounts.values());
        const maxCount = Math.max(...counts);
        const minCount = Math.min(...counts);
        const ratio = maxCount / Math.max(minCount, 1);

        if (ratio > this.imbalanceRatio) {
          findings.push({
            scanner: this.name,
            severity: this.severity,
            match: `${labelCol.name}: class imbalance ratio ${ratio.toFixed(1)}:1`,
            position: 0,
            category: "profiler:class_imbalance",
          });
        }
      }
    }

    return findings;
  }

  private parseCSV(content: string): Record<string, string>[] | null {
    const lines = content.split("\n").filter((l) => l.trim() !== "");
    if (lines.length < 2) return null;

    const headers = lines[0].split(",").map((h) => h.trim());
    if (headers.length === 0) return null;

    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim());
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[j] ?? "";
      }
      rows.push(row);
    }

    return rows;
  }

  private profileColumns(rows: Record<string, string>[]): ColumnProfile[] {
    if (rows.length === 0) return [];

    const columnNames = Object.keys(rows[0]);
    return columnNames.map((name) => {
      const values = rows.map((r) => r[name] ?? "");
      const nullCount = values.filter(
        (v) => v === "" || v === "null" || v === "NULL" || v === "None" || v === "NA" || v === "N/A"
      ).length;

      return { name, totalRows: rows.length, nullCount, values };
    });
  }
}
