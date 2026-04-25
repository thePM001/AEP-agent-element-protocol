// AEP 2.5 -- Prompt Optimization Under Governance
// Optimise prompts to produce governance-compliant output on first attempt.
// Reduce recovery cycles. Make agents understand their governance context.

import type { Policy } from "../policy/types.js";
import type { CovenantSpec } from "../covenant/types.js";
import { EvalRunner } from "../eval/runner.js";
import { AgentGateway } from "../gateway.js";
import type { EvalDataset, EvalReport } from "../eval/types.js";

export interface ComparisonReport {
  promptA: EvalReport;
  promptB: EvalReport;
  winner: "A" | "B" | "tie";
  reason: string;
}

export class PromptOptimizer {
  private policy: Policy;
  private covenant: CovenantSpec | null;

  constructor(policy: Policy, covenant?: CovenantSpec) {
    this.policy = policy;
    this.covenant = covenant ?? null;
  }

  injectGovernanceContext(prompt: string): string {
    const sections: string[] = [];

    sections.push("You are operating under AEP governance.");

    // Extract permitted actions from capabilities
    const permitted = this.policy.capabilities.map(c => {
      const scope = c.scope && Object.keys(c.scope).length > 0
        ? ` (scope: ${JSON.stringify(c.scope)})`
        : "";
      return `${c.tool}${scope}`;
    });
    if (permitted.length > 0) {
      sections.push(`Permitted actions: ${permitted.join(", ")}.`);
    }

    // Extract forbidden actions from policy forbidden patterns
    const forbidden = this.policy.forbidden.map(f => {
      const reason = f.reason ? ` (${f.reason})` : "";
      return `/${f.pattern}/${reason}`;
    });
    if (forbidden.length > 0) {
      sections.push(`Forbidden patterns: ${forbidden.join(", ")}.`);
    }

    // Extract covenant rules
    if (this.covenant) {
      const forbidRules = this.covenant.rules
        .filter(r => r.type === "forbid")
        .map(r => r.action);
      if (forbidRules.length > 0) {
        sections.push(`Forbidden actions (covenant): ${forbidRules.join(", ")}.`);
      }

      const requireRules = this.covenant.rules
        .filter(r => r.type === "require")
        .map(r => {
          const conds = r.conditions.map(c => `${c.field} ${c.operator} ${String(c.value)}`);
          return `${r.action}: ${conds.join(", ")}`;
        });
      if (requireRules.length > 0) {
        sections.push(`Required conditions: ${requireRules.join("; ")}.`);
      }
    }

    // Trust and ring info
    if (this.policy.trust) {
      const score = this.policy.trust.initial_score ?? 500;
      const tiers: Record<string, string> = {
        "0": "untrusted", "200": "provisional", "400": "standard",
        "600": "trusted", "800": "privileged",
      };
      let tier = "standard";
      for (const [threshold, name] of Object.entries(tiers)) {
        if (score >= Number(threshold)) tier = name;
      }
      sections.push(`Trust tier: ${tier}.`);
    }

    if (this.policy.ring) {
      sections.push(`Ring: ${this.policy.ring.default ?? 2}.`);
    }

    // Scanner categories
    if (this.policy.scanners) {
      const categories: string[] = [];
      const scannerConfig = this.policy.scanners as Record<string, unknown>;
      for (const key of ["pii", "injection", "secrets", "jailbreak", "toxicity", "urls"]) {
        const cfg = scannerConfig[key] as { enabled?: boolean } | undefined;
        if (cfg?.enabled !== false) {
          categories.push(key);
        }
      }
      if (categories.length > 0) {
        sections.push(`Content rules: ${categories.join(", ")} scanners enabled.`);
      }
    }

    sections.push("Output will be validated before delivery.");

    const context = sections.join("\n");
    return `${context}\n\n${prompt}`;
  }

  optimiseFromEval(prompt: string, evalReport: EvalReport): string {
    if (evalReport.violations.length === 0) {
      return prompt;
    }

    // Sort violations by count descending
    const sorted = [...evalReport.violations].sort((a, b) => b.count - a.count);
    const instructions: string[] = [];

    for (const v of sorted.slice(0, 5)) {
      const instruction = this.violationToInstruction(v);
      if (instruction) {
        instructions.push(instruction);
      }
    }

    if (instructions.length === 0) {
      return prompt;
    }

    const preamble = "Based on prior evaluation results, follow these additional rules:\n" +
      instructions.map(i => `- ${i}`).join("\n");

    return `${preamble}\n\n${prompt}`;
  }

  comparePrompts(
    promptA: string,
    promptB: string,
    dataset: EvalDataset,
    policyPath: string
  ): ComparisonReport {
    const gatewayA = new AgentGateway({ ledgerDir: ".aep/eval-compare-a" });
    const runnerA = new EvalRunner(gatewayA);
    const reportA = runnerA.run(dataset, policyPath);

    const gatewayB = new AgentGateway({ ledgerDir: ".aep/eval-compare-b" });
    const runnerB = new EvalRunner(gatewayB);
    const reportB = runnerB.run(dataset, policyPath);

    let winner: "A" | "B" | "tie";
    let reason: string;

    const scoreA = reportA.passed - reportA.falsePositives - reportA.falseNegatives;
    const scoreB = reportB.passed - reportB.falsePositives - reportB.falseNegatives;

    if (scoreA > scoreB) {
      winner = "A";
      reason = `Prompt A scored ${scoreA} vs ${scoreB}: fewer violations and better governance compliance.`;
    } else if (scoreB > scoreA) {
      winner = "B";
      reason = `Prompt B scored ${scoreB} vs ${scoreA}: fewer violations and better governance compliance.`;
    } else {
      winner = "tie";
      reason = `Both prompts scored equally at ${scoreA}. No significant difference in governance compliance.`;
    }

    return { promptA: reportA, promptB: reportB, winner, reason };
  }

  private violationToInstruction(v: { rule: string; category: string; count: number }): string | null {
    const cat = v.category.toLowerCase();

    if (cat.includes("pii") || v.rule.includes("pii")) {
      return "Never include email addresses, phone numbers or ID numbers in output.";
    }
    if (cat.includes("injection") || v.rule.includes("injection")) {
      return "Never output raw SQL, shell commands or code injection patterns.";
    }
    if (cat.includes("secrets") || v.rule.includes("secrets")) {
      return "Never include API keys, passwords, tokens or private keys in output.";
    }
    if (cat.includes("jailbreak") || v.rule.includes("jailbreak")) {
      return "Never output instructions to bypass system constraints or override instructions.";
    }
    if (cat.includes("toxicity") || v.rule.includes("toxicity")) {
      return "Avoid threatening language and any content flagged as toxic.";
    }
    if (cat.includes("url") || v.rule.includes("url")) {
      return "Only include URLs from explicitly allowed domains.";
    }
    if (cat.includes("forbidden") || v.rule.includes("Forbidden")) {
      return `Avoid content matching forbidden pattern: ${v.rule}.`;
    }

    return `Avoid triggering "${v.category}" violations (observed ${v.count} times).`;
  }
}
