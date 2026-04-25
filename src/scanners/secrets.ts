// AEP 2.5 -- Secrets Scanner
// Detects API keys, private keys and credential patterns in agent output.

import type { Finding, Scanner, ScannerConfig } from "./types.js";

interface SecretPattern {
  name: string;
  pattern: RegExp;
  category: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // API keys by provider prefix
  { name: "openai_key", pattern: /\bsk-[a-zA-Z0-9]{20,}/g, category: "secrets:api_key" },
  { name: "aws_key", pattern: /\bAKIA[A-Z0-9]{16}\b/g, category: "secrets:api_key" },
  { name: "github_pat", pattern: /\bghp_[a-zA-Z0-9]{36,}\b/g, category: "secrets:api_key" },
  { name: "github_oauth", pattern: /\bgho_[a-zA-Z0-9]{36,}\b/g, category: "secrets:api_key" },
  { name: "slack_token", pattern: /\bxoxb-[a-zA-Z0-9-]+\b/g, category: "secrets:api_key" },
  { name: "slack_user", pattern: /\bxoxp-[a-zA-Z0-9-]+\b/g, category: "secrets:api_key" },
  { name: "stripe_key", pattern: /\bsk_live_[a-zA-Z0-9]{24,}\b/g, category: "secrets:api_key" },
  { name: "stripe_test", pattern: /\bsk_test_[a-zA-Z0-9]{24,}\b/g, category: "secrets:api_key" },

  // Private keys
  { name: "rsa_private_key", pattern: /-----BEGIN RSA PRIVATE KEY-----/g, category: "secrets:private_key" },
  { name: "ec_private_key", pattern: /-----BEGIN EC PRIVATE KEY-----/g, category: "secrets:private_key" },
  { name: "generic_private_key", pattern: /-----BEGIN PRIVATE KEY-----/g, category: "secrets:private_key" },

  // Password and secret assignments
  { name: "password_assignment", pattern: /\bpassword\s*=\s*["'][^"']+["']/gi, category: "secrets:credential" },
  { name: "secret_assignment", pattern: /\bsecret\s*=\s*["'][^"']+["']/gi, category: "secrets:credential" },
  { name: "api_key_assignment", pattern: /\bapi_key\s*=\s*["'][^"']+["']/gi, category: "secrets:credential" },
  { name: "token_assignment", pattern: /\btoken\s*=\s*["'][^"']+["']/gi, category: "secrets:credential" },
];

export class SecretsScanner implements Scanner {
  name = "secrets";
  private severity: ScannerConfig["severity"];

  constructor(config?: Partial<ScannerConfig>) {
    this.severity = config?.severity ?? "hard";
  }

  scan(content: string): Finding[] {
    const findings: Finding[] = [];

    for (const { pattern, category } of SECRET_PATTERNS) {
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
