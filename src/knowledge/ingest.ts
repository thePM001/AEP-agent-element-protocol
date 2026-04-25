// AEP 2.5 -- Knowledge Ingestor
// Splits content into chunks and runs each through the scanner pipeline.
// Hard failures are rejected, soft failures are flagged, clean chunks are validated.

import { randomUUID } from "node:crypto";
import { ScannerPipeline } from "../scanners/pipeline.js";
import type { KnowledgeChunk, IngestReport } from "./types.js";
import type { EvidenceLedger } from "../ledger/ledger.js";

export class KnowledgeIngestor {
  private pipeline: ScannerPipeline;

  constructor(scannerPipeline: ScannerPipeline) {
    this.pipeline = scannerPipeline;
  }

  /**
   * Ingest content by splitting into chunks and scanning each one.
   * Hard scanner failures reject the chunk (not stored).
   * Soft scanner failures flag the chunk (stored with warning).
   * Clean chunks are validated (stored as approved).
   */
  ingest(
    content: string,
    source: string,
    chunkSize: number = 500,
    ledger?: EvidenceLedger
  ): { chunks: KnowledgeChunk[]; report: IngestReport } {
    const rawChunks = this.splitIntoChunks(content, chunkSize);
    const chunks: KnowledgeChunk[] = [];
    const report: IngestReport = {
      total: rawChunks.length,
      validated: 0,
      flagged: 0,
      rejected: 0,
    };

    for (const raw of rawChunks) {
      const id = randomUUID();
      const scanResult = this.pipeline.scan(raw);

      if (scanResult.passed) {
        // Clean chunk -- validated
        const chunk: KnowledgeChunk = {
          id,
          content: raw,
          source,
          metadata: {},
          scanResult,
          validated: true,
          validatedAt: new Date().toISOString(),
        };
        chunks.push(chunk);
        report.validated++;

        ledger?.append("knowledge:ingest", {
          chunkId: id,
          source,
          status: "validated",
          contentLength: raw.length,
        });
      } else {
        const hardFindings = scanResult.findings.filter(
          (f) => f.severity === "hard"
        );
        const softFindings = scanResult.findings.filter(
          (f) => f.severity === "soft"
        );

        if (hardFindings.length > 0) {
          // Hard failure -- rejected
          report.rejected++;

          ledger?.append("knowledge:reject", {
            chunkId: id,
            source,
            status: "rejected",
            findings: hardFindings.map((f) => ({
              scanner: f.scanner,
              category: f.category,
              severity: f.severity,
            })),
          });
        } else if (softFindings.length > 0) {
          // Soft failure -- flagged but stored
          const chunk: KnowledgeChunk = {
            id,
            content: raw,
            source,
            metadata: { flagged: true },
            scanResult,
            validated: false,
            validatedAt: new Date().toISOString(),
          };
          chunks.push(chunk);
          report.flagged++;

          ledger?.append("knowledge:flag", {
            chunkId: id,
            source,
            status: "flagged",
            findings: softFindings.map((f) => ({
              scanner: f.scanner,
              category: f.category,
              severity: f.severity,
            })),
          });
        }
      }
    }

    return { chunks, report };
  }

  /**
   * Split content into chunks of approximately the given token count.
   * Uses a simple word-based approximation (1 token ~ 0.75 words).
   * Tries to split at paragraph boundaries when possible.
   */
  private splitIntoChunks(content: string, tokenSize: number): string[] {
    if (!content.trim()) return [];

    // Approximate words per chunk (tokens * 0.75 words/token)
    const wordsPerChunk = Math.max(1, Math.floor(tokenSize * 0.75));
    const paragraphs = content.split(/\n\n+/);
    const chunks: string[] = [];
    let current = "";
    let currentWordCount = 0;

    for (const para of paragraphs) {
      const paraWords = para.trim().split(/\s+/).length;

      if (currentWordCount + paraWords > wordsPerChunk && current.trim()) {
        chunks.push(current.trim());
        current = para;
        currentWordCount = paraWords;
      } else {
        current += (current ? "\n\n" : "") + para;
        currentWordCount += paraWords;
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks;
  }
}
