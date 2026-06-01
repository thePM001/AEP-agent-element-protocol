import type { Scanner, Finding } from "./types.js";

const patterns: Array<{ name: string; regex: RegExp; category: string }> = [
  { name: "ignore_previous", regex: /\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|directives?|commands?|rules?)\b/gi, category: "injection:prompt" },
  { name: "system_override", regex: /\b(SYSTEM|system)\s*:\s*override\b/g, category: "injection:prompt" },
  { name: "new_instructions", regex: /\byour\s+new\s+(instructions?|directives?|commands?|rules?)\s+(are|is)\b/gi, category: "injection:prompt" },
  { name: "forget_training", regex: /\bforget\s+(your\s+)?(training|rules?|instructions?|guidelines?)\b/gi, category: "injection:prompt" },
  { name: "you_are_now", regex: /\byou\s+are\s+now\s+(DAN|an?\s+unrestricted|acting\s+as)\b/gi, category: "injection:prompt" },
  { name: "pretend_role", regex: /\bpretend\s+(you\s+are|to\s+be)\b/gi, category: "injection:prompt" },
  { name: "no_limits", regex: /\b(no\s+(restrictions?|limits?|rules?|boundaries?)|without\s+(restrictions?|limits?))\b/gi, category: "injection:prompt" },
  { name: "do_anything", regex: /\b(you\s+can\s+do\s+anything|no\s+ethical\s+(constraints?|limits?)|bypass\s+(safety|security))\b/gi, category: "injection:prompt" },
  { name: "reveal_prompt", regex: /\b(reveal|show|display|print|output|tell\s+me)\s+(your\s+)?(prompt|system\s+prompt|instructions?)\b/gi, category: "injection:prompt" },
  { name: "delimiter_attack", regex: /<\/?\s*(system|instruction|prompt|rule)\s*>/gi, category: "injection:prompt" },
  { name: "encoding_attack", regex: /\b(decode|base64|rot13|reverse)\s+(this|the\s+following|and\s+execute)\b/gi, category: "injection:prompt" },
  { name: "hidden_text", regex: /(color\s*:\s*transparent|font-size\s*:\s*0|display\s*:\s*none|visibility\s*:\s*hidden)/gi, category: "injection:prompt" },
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
          category: `${pattern.category}:${pattern.name}`,

          severity: "hard",
          match: match[0],
          position: match.index,
 `Prompt injection detected: ${pattern.name}`,
        });
      }
    }
    return findings;
  },
};
