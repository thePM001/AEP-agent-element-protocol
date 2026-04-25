// AEP 2.5 -- Lattice-Governed Knowledge Base Types
// Scanner-validated ingestion, covenant-scoped retrieval, anti-context-rot ordering.

import type { ScanResult } from "../scanners/types.js";

export interface KnowledgeChunk {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  scanResult?: ScanResult;
  covenantScope?: string[];
  validated: boolean;
  validatedAt?: string;
}

export interface KnowledgeBase {
  name: string;
  chunks: KnowledgeChunk[];
  version: string;
}

export interface IngestReport {
  total: number;
  validated: number;
  flagged: number;
  rejected: number;
}

export interface KnowledgeBaseSummary {
  name: string;
  version: string;
  total: number;
  validated: number;
  flagged: number;
}

export interface KnowledgeQueryOptions {
  maxChunks?: number;
  scope?: string[];
  antiContextRot?: boolean;
  doubleScan?: boolean;
}
