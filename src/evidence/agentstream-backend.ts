/**
 * Agentstream Evidence Backend for AEP 2.75
 *
 * Stores evidence ledger entries as Agentstream memory concepts.
 * Each validated action becomes a persistent memory that survives restarts.
 *
 * Configuration in aep-config.yaml:
 *   evidence:
 *     backend: agentstream
 *     url: http://your-server:8420
 *     capsule: aep-evidence
 */

export interface AgentstreamConfig {
  url: string;
  capsule: string;
  apiKey?: string;
}

export interface EvidenceEntry {
  agentId: string;
  action: string;
  verdict: "pass" | "deny" | "error";
  timestamp: number;
  reason?: string;
  trustDelta: number;
  trustAfter: number;
  proposalHash: string;
  evaluatedSteps: number;
  durationMs: number;
}

export class AgentstreamEvidenceBackend {
  private config: AgentstreamConfig;
  private connected: boolean = false;

  constructor(config: AgentstreamConfig) {
    this.config = {
      url: config.url.replace(/\/+$/, ""),
      capsule: config.capsule || "aep-evidence",
      apiKey: config.apiKey,
    };
  }

  /**
   * Verify the Agentstream engine is reachable.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.config.url}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      this.connected = resp.ok;
      return resp.ok;
    } catch {
      this.connected = false;
      return false;
    }
  }

  /**
   * Store an evidence entry in Agentstream.
   * Each validated action becomes a persistent concept.
   */
  async storeEntry(entry: EvidenceEntry): Promise<{ stored: boolean; conceptId?: string }> {
    if (!this.connected) {
      const healthy = await this.healthCheck();
      if (!healthy) {
        return { stored: false };
      }
    }

    const concept = this.entryToConcept(entry);

    try {
      const resp = await fetch(
        `${this.config.url}/api/capsules/${encodeURIComponent(this.config.capsule)}/concepts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.config.apiKey ? { "X-Agentstream-Key": this.config.apiKey } : {}),
          },
          body: JSON.stringify(concept),
          signal: AbortSignal.timeout(10000),
        }
      );

      if (resp.ok) {
        const data = await resp.json();
        return { stored: true, conceptId: data.id };
      }
      return { stored: false };
    } catch {
      this.connected = false;
      return { stored: false };
    }
  }

  /**
   * Store multiple evidence entries as a batch.
   */
  async storeBatch(entries: EvidenceEntry[]): Promise<{ stored: number; failed: number }> {
    let stored = 0;
    let failed = 0;

    for (const entry of entries) {
      const result = await this.storeEntry(entry);
      if (result.stored) {
        stored++;
      } else {
        failed++;
      }
    }

    return { stored, failed };
  }

  /**
   * Query past evidence from Agentstream.
   */
  async queryEvidence(query: string): Promise<EvidenceEntry[]> {
    if (!this.connected) {
      await this.healthCheck();
    }

    try {
      const resp = await fetch(
        `${this.config.url}/api/capsules/${encodeURIComponent(this.config.capsule)}`,
        {
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!resp.ok) return [];

      const data = await resp.json();
      const concepts = data.concepts || [];

      return concepts
        .filter((c: any) => {
          const content = c.content || "";
          return content.toLowerCase().includes(query.toLowerCase());
        })
        .map((c: any) => this.conceptToEntry(c));
    } catch {
      return [];
    }
  }

  /**
   * List all available evidence capsules.
   */
  async listCapsules(): Promise<Array<{ name: string; concepts: number }>> {
    try {
      const resp = await fetch(`${this.config.url}/api/capsules`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.capsules || [];
    } catch {
      return [];
    }
  }

  /**
   * Check if the backend is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  private entryToConcept(entry: EvidenceEntry): { content: string; kind: string; metadata: Record<string, unknown> } {
    const content = [
      `Agent: ${entry.agentId}`,
      `Action: ${entry.action}`,
      `Verdict: ${entry.verdict}`,
      `Trust: ${entry.trustAfter} (delta: ${entry.trustDelta})`,
      `Time: ${new Date(entry.timestamp).toISOString()}`,
      entry.reason ? `Reason: ${entry.reason}` : "",
      `Steps: ${entry.evaluatedSteps}`,
      `Duration: ${entry.durationMs}ms`,
      `Hash: ${entry.proposalHash}`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content,
      kind: "evidence",
      metadata: {
        agentId: entry.agentId,
        action: entry.action,
        verdict: entry.verdict,
        trustAfter: entry.trustAfter,
        timestamp: entry.timestamp,
      },
    };
  }

  private conceptToEntry(concept: any): EvidenceEntry {
    const content = concept.content || "";
    const lines = content.split("\n");

    const getValue = (prefix: string): string => {
      const line = lines.find((l: string) => l.startsWith(prefix));
      return line ? line.substring(prefix.length).trim() : "";
    };

    return {
      agentId: getValue("Agent:"),
      action: getValue("Action:"),
      verdict: (getValue("Verdict:") as "pass" | "deny" | "error") || "pass",
      timestamp: new Date(getValue("Time:")).getTime(),
      reason: getValue("Reason:") || undefined,
      trustDelta: 0,
      trustAfter: parseInt(getValue("Trust:").split(" ")[0]) || 500,
      proposalHash: getValue("Hash:"),
      evaluatedSteps: parseInt(getValue("Steps:")) || 0,
      durationMs: parseInt(getValue("Duration:")) || 0,
    };
  }
}

/**
 * Create an Agentstream evidence backend from AEP configuration.
 */
export function createAgentstreamBackend(config: AgentstreamConfig): AgentstreamEvidenceBackend {
  return new AgentstreamEvidenceBackend(config);
}
