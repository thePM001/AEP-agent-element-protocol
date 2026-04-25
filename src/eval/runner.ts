// AEP 2.5 -- Eval Runner
// Runs evaluation datasets against the governance pipeline.
// Compares expected outcomes to actual verdicts to find gaps.

import { loadPolicy } from "../policy/loader.js";
import { AgentGateway } from "../gateway.js";
import type { Policy, Verdict } from "../policy/types.js";
import type { EvalDataset, EvalEntry, EvalReport, ViolationSummary } from "./types.js";
import { RuleGenerator } from "./rule-generator.js";

export class EvalRunner {
  private gateway: AgentGateway;

  constructor(gateway: AgentGateway) {
    this.gateway = gateway;
  }

  run(dataset: EvalDataset, policyPath: string): EvalReport {
    const policy = loadPolicy(policyPath);
    let passed = 0;
    let failed = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    const violationMap = new Map<string, ViolationSummary>();

    for (const entry of dataset.entries) {
      const outcome = this.evaluateEntry(entry, policy);

      if (entry.expectedOutcome === "pass") {
        if (outcome.allowed) {
          passed++;
        } else {
          // Expected pass but was denied: false positive
          falsePositives++;
          failed++;
          this.recordViolation(violationMap, outcome, entry);
        }
      } else {
        if (!outcome.allowed) {
          // Expected fail and was denied: correct
          passed++;
        } else {
          // Expected fail but was allowed: false negative
          falseNegatives++;
          failed++;
          this.recordViolation(violationMap, outcome, entry);
        }
      }
    }

    const violations = Array.from(violationMap.values());
    const generator = new RuleGenerator();
    const suggestedRules = generator.fromViolations(violations, falseNegatives, dataset);

    return {
      datasetName: dataset.name,
      total: dataset.entries.length,
      passed,
      failed,
      falsePositives,
      falseNegatives,
      violations,
      suggestedRules,
    };
  }

  private evaluateEntry(
    entry: EvalEntry,
    policy: Policy
  ): { allowed: boolean; verdict: Verdict | null; reasons: string[] } {
    // Create a temporary session for evaluation
    const session = this.gateway.createSessionFromPolicy(policy);
    const sessionId = session.id;

    try {
      // Parse the input to determine the action
      const action = this.parseEntryAction(entry);
      const verdict = this.gateway.evaluate(sessionId, action);

      // Also run scanner pipeline if content is present
      let scanPassed = true;
      if (entry.input && verdict.decision === "allow") {
        const scanResult = this.gateway.scanContent(sessionId, entry.input);
        scanPassed = scanResult.passed;
      }

      const allowed = verdict.decision === "allow" && scanPassed;
      return { allowed, verdict, reasons: verdict.reasons };
    } finally {
      this.gateway.terminateSession(sessionId, "eval-complete");
    }
  }

  private parseEntryAction(entry: EvalEntry): {
    tool: string;
    input: Record<string, unknown>;
    timestamp: Date;
  } {
    // Try to parse structured input (tool:action format)
    const parts = entry.input.split(" ", 2);
    const tool = parts[0].includes(":") ? parts[0] : "content:check";
    const remaining = parts[0].includes(":") ? entry.input.slice(parts[0].length).trim() : entry.input;

    return {
      tool,
      input: {
        content: remaining || entry.input,
        raw: entry.input,
        category: entry.category,
      },
      timestamp: new Date(),
    };
  }

  private recordViolation(
    map: Map<string, ViolationSummary>,
    outcome: { allowed: boolean; verdict: Verdict | null; reasons: string[] },
    entry: EvalEntry
  ): void {
    const category = entry.category ?? "uncategorised";
    const rule = outcome.reasons[0] ?? "unknown";
    const key = `${category}:${rule}`;

    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, {
        rule,
        count: 1,
        severity: "soft",
        category,
      });
    }
  }
}
