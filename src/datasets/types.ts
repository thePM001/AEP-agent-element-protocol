// AEP 2.5 -- Governed Dataset Management Types
// Versioned evaluation datasets. Importable from production ledgers.
// The feedback loop: production -> dataset -> eval -> rules -> policy.

export interface DatasetEntry {
  id: string;
  input: string;
  context?: string;
  expectedOutcome: "pass" | "fail";
  category?: string;
  tags?: string[];
}

export interface Dataset {
  name: string;
  version: string;
  description: string;
  entries: DatasetEntry[];
  created: string;
  updated: string;
}

export interface DatasetSummary {
  name: string;
  version: string;
  description: string;
  entryCount: number;
  created: string;
  updated: string;
}
