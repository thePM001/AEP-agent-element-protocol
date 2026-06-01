import type { Scanner, Finding } from "./types.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export const supplyChainScanner: Scanner = {
  name: "supply-chain",
  scan(content: string): Finding[] {
    const findings: Finding[] = [];
    
    // Check for suspicious postinstall/preinstall scripts
    const scriptPatterns = [
      { name: "postinstall_curl", regex: /"postinstall"\s*:\s*"[^"]*(curl|wget)[^"]*"/g },
      { name: "preinstall_exec", regex: /"preinstall"\s*:\s*"[^"]*(bash\s+-c|sh\s+-c|eval|exec)[^"]*"/g },
    ];
    
    for (const sp of scriptPatterns) {
      let match;
      while ((match = sp.regex.exec(content)) !== null) {
        findings.push({
          scanner: "supply-chain",
          rule: sp.name,
          category: "supplychain:script",
          severity: "hard",
          match: match[0],
          position: match.index,
 `Suspicious install script detected: ${sp.name}`,
        });
      }
    }
    
    // Check for non-standard package registries
    const registryPattern = /"resolved"\s*:\s*"(?!https:\/\/registry\.npmjs\.org\/|https:\/\/registry\.yarnpkg\.com\/)(https?:\/\/[^"]+)"/g;
    let regMatch;
    while ((regMatch = registryPattern.exec(content)) !== null) {
      findings.push({
        scanner: "supply-chain",
        rule: "non_standard_registry",
        category: "supplychain:registry",
        severity: "hard",
        match: regMatch[0],
        index: regMatch.index,
        message: `Non-standard package registry: ${regMatch[1]}`,
      });
    }
    
    // Check for missing integrity hashes
    const missingIntegrity = /"version"\s*:\s*"([^"]+)"\s*\}[^}]*$/gm;
    let intMatch;
    while ((intMatch = missingIntegrity.exec(content)) !== null) {
      if (!content.substring(intMatch.index - 200, intMatch.index).includes("integrity")) {
        findings.push({
          scanner: "supply-chain",
          category: "supplychain:integrity:missing",

          severity: "soft",
          match: intMatch[1],
          position: intMatch.index,
 `Package ${intMatch[1]} missing integrity hash`,
        });
      }
    }
    
    return findings;
  },
};
