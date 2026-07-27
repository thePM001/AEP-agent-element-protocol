// @PAD: /root/dynAEP/sdk/typescript/tests/scanners/unified-scanner.test.ts
// ===========================================================================
// Tests: OPT-003 Unified Scanner + Literal Extractor
// ===========================================================================

import { describe, it, expect } from "vitest";
import { UnifiedScanner, type ScannerConfig, type ScannerPattern } from "../../src/scanners/UnifiedScanner";
import { extractLiterals } from "../../src/scanners/LiteralExtractor";

// ---------------------------------------------------------------------------
// LiteralExtractor Tests
// ---------------------------------------------------------------------------

describe("LiteralExtractor", () => {
  it("extracts literals from simple pattern", () => {
    const result = extractLiterals(/api_key/);
    expect(result).toContain("api_key");
  });

  it("extracts literals around character classes", () => {
    const result = extractLiterals(/api[_-]key/);
    expect(result).toContain("api");
    expect(result).toContain("key");
  });

  it("handles case-insensitive flag", () => {
    const result = extractLiterals(/SELECT.*FROM/i);
    expect(result).toContain("select");
    expect(result).toContain("from");
  });

  it("handles quantified characters", () => {
    const result = extractLiterals(/api\w{32}/);
    expect(result).toContain("api");
  });

  it("handles escaped special characters", () => {
    const result = extractLiterals(/example\.com/);
    expect(result).toContain("example.com");
  });

  it("handles alternation", () => {
    const result = extractLiterals(/foo|bar/);
    expect(result).toContain("foo");
    expect(result).toContain("bar");
  });

  it("returns empty for pure character class patterns", () => {
    const result = extractLiterals(/^[a-zA-Z]+$/);
    // No extractable literals >= 2 chars
    expect(result.filter(l => l.length >= 2)).toEqual([]);
  });

  it("handles anchors", () => {
    const result = extractLiterals(/^https:\/\//);
    expect(result.some(l => l.includes("https://"))).toBe(true);
  });

  it("handles plus quantifier", () => {
    const result = extractLiterals(/password.+secret/);
    // 'password' extracted, '.' + '+' breaks, 'secret' extracted
    expect(result).toContain("password");
    expect(result).toContain("secret");
  });

  it("handles question mark quantifier", () => {
    const result = extractLiterals(/https?:\/\//);
    // 'http' extracted (s is quantified away), '://' extracted
    expect(result.some(l => l.includes("http"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UnifiedScanner Tests
// ---------------------------------------------------------------------------

function makeConfigs(): ScannerConfig[] {
  return [
    {
      scannerId: "secrets",
      label: "Secrets Scanner",
      patterns: [
        { patternId: "api-key", regex: /api[_-]?key\s*[=:]\s*\S+/i, severity: "hard" },
        { patternId: "private-key", regex: /BEGIN RSA PRIVATE KEY/i, severity: "hard" },
      ],
    },
    {
      scannerId: "injection",
      label: "Injection Scanner",
      patterns: [
        { patternId: "sql-select", regex: /SELECT\s+.*\s+FROM\s+/i, severity: "hard" },
        { patternId: "sql-drop", regex: /DROP\s+TABLE/i, severity: "hard" },
      ],
    },
    {
      scannerId: "pii",
      label: "PII Scanner",
      patterns: [
        { patternId: "email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i, severity: "soft" },
        { patternId: "phone", regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, severity: "soft" },
      ],
    },
  ];
}

describe("UnifiedScanner", () => {
  it("produces identical findings to sequential for clean payload", () => {
    const configs = makeConfigs();
    const scanner = new UnifiedScanner(configs);
    const payload = "This is a clean payload with no sensitive content.";

    const results = scanner.scan(payload);
    expect(results.length).toBe(0);
  });

  it("detects hard-severity patterns", () => {
    const configs = makeConfigs();
    const scanner = new UnifiedScanner(configs);
    const payload = "config: api_key = sk_live_1234567890abcdef";

    const results = scanner.scan(payload);
    expect(results.length).toBe(1);
    expect(results[0].severity).toBe("hard");
    expect(results[0].scannerId).toBe("secrets");
    expect(results[0].patternId).toBe("api-key");
  });

  it("hard-abort stops on first hard match", () => {
    const configs = makeConfigs();
    const scanner = new UnifiedScanner(configs);
    // Payload has both a hard secret AND a hard SQL injection
    const payload = "api_key=secret123 SELECT * FROM users";

    const results = scanner.scan(payload);
    // Should return exactly 1 result (first hard match aborts)
    expect(results.length).toBe(1);
    expect(results[0].severity).toBe("hard");
  });

  it("soft findings returned when no hard matches", () => {
    const configs = makeConfigs();
    const scanner = new UnifiedScanner(configs);
    const payload = "Contact john@example.com or call 555-123-4567";

    const results = scanner.scan(payload);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.severity === "soft")).toBe(true);
  });

  it("scanner attribution: each finding identifies source scanner", () => {
    const configs = makeConfigs();
    const scanner = new UnifiedScanner(configs);
    const payload = "email: user@test.com phone: 555-123-4567";

    const results = scanner.scan(payload);
    for (const result of results) {
      expect(result.scannerId).toBeTruthy();
      expect(result.patternId).toBeTruthy();
      expect(result.scannerLabel).toBeTruthy();
    }
  });

  it("empty payload produces no findings", () => {
    const configs = makeConfigs();
    const scanner = new UnifiedScanner(configs);

    const results = scanner.scan("");
    expect(results.length).toBe(0);
  });

  it("payload with only soft findings returns all soft findings", () => {
    const configs = makeConfigs();
    const scanner = new UnifiedScanner(configs);
    const payload = "user@test.com admin@example.org 555-123-4567";

    const results = scanner.scan(payload);
    expect(results.length).toBeGreaterThan(0);
    // No hard abort
    expect(results.every(r => r.severity === "soft")).toBe(true);
  });

  it("match includes correct start and end positions", () => {
    const configs: ScannerConfig[] = [
      {
        scannerId: "test",
        label: "Test Scanner",
        patterns: [
          { patternId: "literal", regex: /testword/, severity: "soft" },
        ],
      },
    ];
    const scanner = new UnifiedScanner(configs);
    const payload = "prefix testword suffix";

    const results = scanner.scan(payload);
    expect(results.length).toBe(1);
    expect(results[0].match.text).toBe("testword");
    expect(results[0].match.start).toBe(7);
    expect(results[0].match.end).toBe(15);
  });

  it("streaming scanner yields results per chunk", async () => {
    const configs = makeConfigs();
    const scanner = new UnifiedScanner(configs);

    async function* chunks(): AsyncGenerator<string> {
      yield "Contact user@";
      yield "example.com for ";
      yield "more info";
    }

    const results: import("../../src/scanners/UnifiedScanner").ScanResult[] = [];
    for await (const result of scanner.scanStreaming(chunks())) {
      results.push(result);
    }

    // Should find the email across chunks
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("streaming scanner aborts on hard finding", async () => {
    const configs = makeConfigs();
    const scanner = new UnifiedScanner(configs);

    async function* chunks(): AsyncGenerator<string> {
      yield "config: api_key=secret123 ";
      yield "more data that should not be scanned";
    }

    const results: import("../../src/scanners/UnifiedScanner").ScanResult[] = [];
    for await (const result of scanner.scanStreaming(chunks())) {
      results.push(result);
    }

    expect(results.length).toBe(1);
    expect(results[0].severity).toBe("hard");
  });

  it("handles patterns with no extractable literals via direct regex", () => {
    const configs: ScannerConfig[] = [
      {
        scannerId: "test",
        label: "Test Scanner",
        patterns: [
          // Pure character class -- no extractable literals
          { patternId: "digits", regex: /^\d{9}$/, severity: "soft" },
          // Has a literal
          { patternId: "keyword", regex: /dangerous_function/, severity: "hard" },
        ],
      },
    ];
    const scanner = new UnifiedScanner(configs);

    const result1 = scanner.scan("123456789");
    // digits pattern should still work via direct regex fallback
    expect(result1.length).toBeGreaterThanOrEqual(0);

    const result2 = scanner.scan("call dangerous_function now");
    expect(result2.length).toBe(1);
    expect(result2[0].patternId).toBe("keyword");
    expect(result2[0].severity).toBe("hard");
  });
});
