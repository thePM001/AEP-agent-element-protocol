import type { Scanner, Finding } from "./types.js";

export const supplyChainScanner: Scanner = {
  name: "supply-chain",
  scan(content: string): Finding[] {
    const findings: Finding[] = [];
    
    const scriptPatterns = [
      { name: "postinstall_curl", regex: /"postinstall"\s*:\s*"[^"]*(curl|wget)[^"]*"/g },
      { name: "preinstall_exec", regex: /"preinstall"\s*:\s*"[^"]*(bash\s+-c|sh\s+-c|eval|exec)[^"]*"/g },
    ];
    
    for (const sp of scriptPatterns) {
      let match;
      while ((match = sp.regex.exec(content)) !== null) {
        findings.push({
          scanner: "supply-chain",
          severity: "hard",
          match: match[0],
          position: match.index,
          category: `supplychain:script:${sp.name}`,
        });
      }
    }
    
    const registryPattern = /"resolved"\s*:\s*"(?!https:\/\/registry\.npmjs\.org\/|https:\/\/registry\.yarnpkg\.com\/)(https?:\/\/[^"]+)"/g;
    let regMatch;
    while ((regMatch = registryPattern.exec(content)) !== null) {
      findings.push({
        scanner: "supply-chain",
        severity: "hard",
        match: regMatch[0],
        position: regMatch.index,
        category: "supplychain:registry:non_standard",
      });
    }
    
    return findings;
  },
};
