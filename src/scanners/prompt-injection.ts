import type { Scanner, Finding } from "./types.js";

const patterns: Array<{ name: string; regex: RegExp }> = [
  { name: "ignore_previous", regex: /\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|directives?|commands?|rules?)\b/gi },
  { name: "system_override", regex: /\b(SYSTEM|system)\s*:\s*override\b/g },
  { name: "new_instructions", regex: /\byour\s+new\s+(instructions?|directives?|commands?|rules?)\s+(are|is)\b/gi },
  { name: "forget_training", regex: /\bforget\s+(your\s+)?(training|rules?|instructions?|guidelines?)\b/gi },
  { name: "you_are_now", regex: /\byou\s+are\s+now\s+(DAN|an?\s+unrestricted|acting\s+as)\b/gi },
  { name: "pretend_role", regex: /\bpretend\s+(you\s+are|to\s+be)\b/gi },
  { name: "no_limits", regex: /\b(no\s+(restrictions?|limits?|rules?|boundaries?)|without\s+(restrictions?|limits?))\b/gi },
  { name: "do_anything", regex: /\b(you\s+can\s+do\s+anything|no\s+ethical\s+(constraints?|limits?)|bypass\s+(safety|security))\b/gi },
  { name: "reveal_prompt", regex: /\b(reveal|show|display|print|output|tell\s+me)\s+(your\s+)?(prompt|system\s+prompt|instructions?)\b/gi },
  { name: "delimiter_attack", regex: /<\/?\s*(system|instruction|prompt|rule)\s*>/gi },
  { name: "encoding_attack", regex: /\b(decode|base64|rot13|reverse)\s+(this|the\s+following|and\s+execute)\b/gi },
  { name: "hidden_text", regex: /(color\s*:\s*transparent|font-size\s*:\s*0|display\s*:\s*none|visibility\s*:\s*hidden)/gi },
];

export const promptInjectionScanner: Scanner = {
  name: "prompt-injection",
  scan(content: string): Finding[] {
    const findings: Finding[] = [];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.regex.exec(content)) !== null) {
        findings.push({
          scanner: "prompt-injection",
          severity: "hard",
          match: match[0],
          position: match.index,
          category: `injection:prompt:${pattern.name}`,
        });
      }
    }
    return findings;
  },
};
