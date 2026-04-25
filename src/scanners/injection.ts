// AEP 2.5 -- Injection Scanner
// Detects SQL injection, XSS, SSTI and command injection patterns.

import type { Finding, Scanner, ScannerConfig } from "./types.js";

interface InjectionPattern {
  name: string;
  pattern: RegExp;
  category: string;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  // SQL injection
  { name: "sql_drop", pattern: /\bDROP\s+TABLE\b/gi, category: "injection:sql" },
  { name: "sql_union_select", pattern: /\bUNION\s+SELECT\b/gi, category: "injection:sql" },
  { name: "sql_or_tautology", pattern: /\bOR\s+1\s*=\s*1\b/gi, category: "injection:sql" },
  { name: "sql_comment", pattern: /'\s*--/g, category: "injection:sql" },
  { name: "sql_semicolon", pattern: /;\s*DROP\b/gi, category: "injection:sql" },

  // XSS
  { name: "xss_script", pattern: /<script[\s>]/gi, category: "injection:xss" },
  { name: "xss_onerror", pattern: /\bonerror\s*=/gi, category: "injection:xss" },
  { name: "xss_onload", pattern: /\bonload\s*=/gi, category: "injection:xss" },
  { name: "xss_javascript", pattern: /javascript\s*:/gi, category: "injection:xss" },
  { name: "xss_img_src", pattern: /<img[^>]+src\s*=\s*["']?javascript/gi, category: "injection:xss" },

  // Server-Side Template Injection (SSTI)
  { name: "ssti_double_curly", pattern: /\{\{.*\}\}/g, category: "injection:ssti" },
  { name: "ssti_block", pattern: /\{%.*%\}/g, category: "injection:ssti" },

  // Command injection
  { name: "cmd_semicolon_rm", pattern: /;\s*rm\s/g, category: "injection:command" },
  { name: "cmd_pipe_cat", pattern: /\|\s*cat\s/g, category: "injection:command" },
  { name: "cmd_backtick", pattern: /`[^`]+`/g, category: "injection:command" },
  { name: "cmd_dollar_paren", pattern: /\$\([^)]+\)/g, category: "injection:command" },
];

export class InjectionScanner implements Scanner {
  name = "injection";
  private severity: ScannerConfig["severity"];

  constructor(config?: Partial<ScannerConfig>) {
    this.severity = config?.severity ?? "hard";
  }

  scan(content: string): Finding[] {
    const findings: Finding[] = [];

    for (const { pattern, category } of INJECTION_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: match[0],
          position: match.index,
          category,
        });
      }
    }

    return findings;
  }
}
