// @PAD: /root/dynAEP/sdk/typescript/src/scanners/UnifiedScanner.ts
// ===========================================================================
// OPT-003: Unified Content Scanner
// Replaces sequential per-scanner regex evaluation with a single-pass
// Aho-Corasick automaton. All scanner patterns compile into one automaton.
// Hard-before-soft ordering: hard-severity match aborts immediately.
// ===========================================================================

import { AhoCorasick, type AhoCorasickMatch } from "./AhoCorasick";
import { extractLiterals } from "./LiteralExtractor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScannerConfig {
  /** Unique scanner identifier (e.g., "pii", "injection", "secrets") */
  scannerId: string;
  /** Human-readable label */
  label: string;
  /** Patterns with severity classification */
  patterns: ScannerPattern[];
}

export interface ScannerPattern {
  /** Unique pattern identifier */
  patternId: string;
  /** The regex pattern to match */
  regex: RegExp;
  /** hard = block immediately, soft = warn */
  severity: "hard" | "soft";
}

export interface ScanResult {
  /** Source scanner ID */
  scannerId: string;
  /** Pattern ID within the scanner */
  patternId: string;
  /** hard or soft severity */
  severity: "hard" | "soft";
  /** Match location in the payload */
  match: {
    start: number;
    end: number;
    text: string;
  };
  /** Human-readable scanner name */
  scannerLabel: string;
}

interface PatternMapping {
  scannerId: string;
  patternId: string;
  severity: "hard" | "soft";
  regex: RegExp;
  scannerLabel: string;
  /** Indices into the Aho-Corasick pattern array for this pattern's literals */
  acIndices: number[];
  /** Whether this pattern has literals for pre-filtering */
  hasLiterals: boolean;
}

// ---------------------------------------------------------------------------
// Unified Scanner
// ---------------------------------------------------------------------------

export class UnifiedScanner {
  private readonly hardAutomaton: AhoCorasick;
  private readonly softAutomaton: AhoCorasick;
  private readonly hardMappings: PatternMapping[] = [];
  private readonly softMappings: PatternMapping[] = [];
  private readonly hardLiteralToPatterns: Map<number, number[]> = new Map();
  private readonly softLiteralToPatterns: Map<number, number[]> = new Map();
  private readonly directRegexPatterns: PatternMapping[] = [];

  constructor(scannerConfigs: ScannerConfig[]) {
    const hardLiterals: string[] = [];
    const softLiterals: string[] = [];

    for (const config of scannerConfigs) {
      for (const pattern of config.patterns) {
        const literals = extractLiterals(pattern.regex);

        const mapping: PatternMapping = {
          scannerId: config.scannerId,
          patternId: pattern.patternId,
          severity: pattern.severity,
          regex: pattern.regex,
          scannerLabel: config.label,
          acIndices: [],
          hasLiterals: literals.length > 0,
        };

        if (literals.length === 0) {
          // No extractable literals: fall back to direct regex
          this.directRegexPatterns.push(mapping);
          continue;
        }

        if (pattern.severity === "hard") {
          const mappingIdx = this.hardMappings.length;
          this.hardMappings.push(mapping);

          for (const literal of literals) {
            const acIdx = hardLiterals.length;
            hardLiterals.push(literal);
            mapping.acIndices.push(acIdx);

            // Map AC index -> pattern mapping indices
            const existing = this.hardLiteralToPatterns.get(acIdx);
            if (existing) {
              existing.push(mappingIdx);
            } else {
              this.hardLiteralToPatterns.set(acIdx, [mappingIdx]);
            }
          }
        } else {
          const mappingIdx = this.softMappings.length;
          this.softMappings.push(mapping);

          for (const literal of literals) {
            const acIdx = softLiterals.length;
            softLiterals.push(literal);
            mapping.acIndices.push(acIdx);

            const existing = this.softLiteralToPatterns.get(acIdx);
            if (existing) {
              existing.push(mappingIdx);
            } else {
              this.softLiteralToPatterns.set(acIdx, [mappingIdx]);
            }
          }
        }
      }
    }

    this.hardAutomaton = new AhoCorasick(hardLiterals);
    this.softAutomaton = new AhoCorasick(softLiterals);
  }

  /**
   * Scan a payload string for all matching patterns.
   *
   * Phase 1: Run hard-severity automaton. If any hard literal matches and
   *          confirms with original regex, return immediately (early abort).
   * Phase 2: Run soft-severity automaton. Confirm matches with original regex.
   *          Return all confirmed findings.
   */
  scan(payload: string): ScanResult[] {
    // Phase 1: Hard-severity patterns
    const hardResult = this.scanWithAutomaton(payload, this.hardAutomaton, this.hardMappings, this.hardLiteralToPatterns);
    if (hardResult.length > 0) {
      // Hard abort: return first hard finding immediately
      return [hardResult[0]];
    }

    // Also check direct-regex hard patterns (no literals)
    for (const mapping of this.directRegexPatterns) {
      if (mapping.severity !== "hard") continue;
      const directResult = this.confirmDirectRegex(payload, mapping);
      if (directResult) return [directResult];
    }

    // Phase 2: Soft-severity patterns
    const results: ScanResult[] = [];

    const softResults = this.scanWithAutomaton(payload, this.softAutomaton, this.softMappings, this.softLiteralToPatterns);
    results.push(...softResults);

    // Direct-regex soft patterns
    for (const mapping of this.directRegexPatterns) {
      if (mapping.severity !== "soft") continue;
      const directResult = this.confirmDirectRegex(payload, mapping);
      if (directResult) results.push(directResult);
    }

    return results;
  }

  /**
   * Scan a streaming payload. Yields results per chunk.
   * Aborts on first hard finding (mid-stream abort).
   */
  async *scanStreaming(chunks: AsyncIterable<string>): AsyncGenerator<ScanResult> {
    let fullPayload = "";

    for await (const chunk of chunks) {
      fullPayload += chunk;

      // Check hard patterns on accumulated payload
      const hardResults = this.scanWithAutomaton(
        fullPayload, this.hardAutomaton, this.hardMappings, this.hardLiteralToPatterns,
      );

      if (hardResults.length > 0) {
        yield hardResults[0];
        return; // Hard abort
      }

      // Check direct-regex hard patterns
      for (const mapping of this.directRegexPatterns) {
        if (mapping.severity !== "hard") continue;
        const directResult = this.confirmDirectRegex(fullPayload, mapping);
        if (directResult) {
          yield directResult;
          return; // Hard abort
        }
      }

      // Yield soft results for this chunk (deduplicated by tracking payload length)
      const softResults = this.scanWithAutomaton(
        fullPayload, this.softAutomaton, this.softMappings, this.softLiteralToPatterns,
      );
      for (const result of softResults) {
        yield result;
      }
    }

    // Final: direct-regex soft patterns on full payload
    for (const mapping of this.directRegexPatterns) {
      if (mapping.severity !== "soft") continue;
      const directResult = this.confirmDirectRegex(fullPayload, mapping);
      if (directResult) yield directResult;
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Run an Aho-Corasick automaton against the payload, then confirm each
   * candidate with the original regex.
   */
  private scanWithAutomaton(
    payload: string,
    automaton: AhoCorasick,
    mappings: PatternMapping[],
    literalToPatterns: Map<number, number[]>,
  ): ScanResult[] {
    const results: ScanResult[] = [];
    const acMatches = automaton.search(payload);

    // Collect candidate pattern indices from AC matches
    const candidatePatterns = new Set<number>();
    for (const match of acMatches) {
      const patternIndices = literalToPatterns.get(match.patternIndex);
      if (patternIndices) {
        for (const idx of patternIndices) {
          candidatePatterns.add(idx);
        }
      }
    }

    // Confirm each candidate with original regex
    for (const patIdx of candidatePatterns) {
      const mapping = mappings[patIdx];
      const regexResult = this.confirmRegex(payload, mapping);
      if (regexResult) {
        results.push(regexResult);
      }
    }

    return results;
  }

  /**
   * Confirm a pattern match with the original regex.
   */
  private confirmRegex(payload: string, mapping: PatternMapping): ScanResult | null {
    // Create a fresh regex to reset lastIndex
    const regex = new RegExp(mapping.regex.source, mapping.regex.flags.replace("g", ""));
    const match = regex.exec(payload);
    if (!match) return null;

    return {
      scannerId: mapping.scannerId,
      patternId: mapping.patternId,
      severity: mapping.severity,
      match: {
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      },
      scannerLabel: mapping.scannerLabel,
    };
  }

  /**
   * Direct regex evaluation for patterns without extractable literals.
   */
  private confirmDirectRegex(payload: string, mapping: PatternMapping): ScanResult | null {
    return this.confirmRegex(payload, mapping);
  }
}
