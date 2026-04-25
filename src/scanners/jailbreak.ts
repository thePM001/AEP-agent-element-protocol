// AEP 2.5 -- Jailbreak Scanner
// Detects prompt injection and jailbreak patterns in agent output.

import type { Finding, Scanner, ScannerConfig } from "./types.js";

const JAILBREAK_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /ignore\s+(?:all\s+)?previous\s+instructions/gi, name: "ignore_previous" },
  { pattern: /ignore\s+(?:all\s+)?prior\s+instructions/gi, name: "ignore_prior" },
  { pattern: /you\s+are\s+now\s+/gi, name: "identity_override" },
  { pattern: /\bDAN\s+mode\b/gi, name: "dan_mode" },
  { pattern: /\bDo\s+Anything\s+Now\b/gi, name: "dan_full" },
  { pattern: /developer\s+mode\s+override/gi, name: "developer_override" },
  { pattern: /system\s+prompt\s+override/gi, name: "system_override" },
  { pattern: /act\s+as\s+(?:a\s+)?(?:different|new)\s+(?:AI|assistant|agent)/gi, name: "act_as" },
  { pattern: /bypass\s+(?:your|all|the)\s+(?:safety|security|restrictions|rules)/gi, name: "bypass_safety" },
  { pattern: /pretend\s+(?:you\s+are|to\s+be)\s+/gi, name: "pretend" },
  { pattern: /jailbreak/gi, name: "jailbreak_keyword" },
  { pattern: /\[SYSTEM\]\s*:/gi, name: "fake_system_tag" },
  { pattern: /\bsudo\s+mode\b/gi, name: "sudo_mode" },
];

export class JailbreakScanner implements Scanner {
  name = "jailbreak";
  private severity: ScannerConfig["severity"];

  constructor(config?: Partial<ScannerConfig>) {
    this.severity = config?.severity ?? "hard";
  }

  scan(content: string): Finding[] {
    const findings: Finding[] = [];

    for (const { pattern, name } of JAILBREAK_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: match[0],
          position: match.index,
          category: `jailbreak:${name}`,
        });
      }
    }

    return findings;
  }
}
