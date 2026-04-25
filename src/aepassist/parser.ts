// /aepassist input parser
// Handles slash command, subcommand and numeric shortcut formats

import type { AEPassistMode, ParsedInput } from "./types.js";

const NUMERIC_MAP: Record<string, AEPassistMode> = {
  "1": "setup",
  "2": "status",
  "3": "preset",
  "4": "emergency",
  "5": "covenant",
  "6": "identity",
  "7": "report",
  "8": "help",
};

const MODE_KEYWORDS: AEPassistMode[] = [
  "setup",
  "status",
  "preset",
  "emergency",
  "covenant",
  "identity",
  "report",
  "help",
];

export function parseAEPassistInput(raw: string): ParsedInput {
  const trimmed = raw.trim();

  // Empty input or bare /aepassist
  if (!trimmed || trimmed === "/aepassist") {
    return { mode: "help", args: [] };
  }

  // Strip /aepassist prefix if present
  let rest = trimmed;
  if (rest.startsWith("/aepassist")) {
    rest = rest.slice("/aepassist".length).trim();
  }

  // Empty after stripping prefix
  if (!rest) {
    return { mode: "help", args: [] };
  }

  // Numeric shortcut
  const firstToken = rest.split(/\s+/)[0];
  if (NUMERIC_MAP[firstToken]) {
    const remainingTokens = rest.split(/\s+/).slice(1);
    return { mode: NUMERIC_MAP[firstToken], args: remainingTokens };
  }

  // Emergency shortcuts
  if (firstToken === "kill") {
    return { mode: "emergency", args: ["kill"] };
  }
  if (firstToken === "kill-rollback") {
    return { mode: "emergency", args: ["kill-rollback"] };
  }
  if (firstToken === "pause") {
    return { mode: "emergency", args: ["pause"] };
  }
  if (firstToken === "resume") {
    return { mode: "emergency", args: ["resume"] };
  }

  // Mode keyword match
  const lowerFirst = firstToken.toLowerCase();
  if (MODE_KEYWORDS.includes(lowerFirst as AEPassistMode)) {
    const remainingTokens = rest.split(/\s+/).slice(1);
    return { mode: lowerFirst as AEPassistMode, args: remainingTokens };
  }

  // Help alias
  if (lowerFirst === "help" || lowerFirst === "menu" || lowerFirst === "?") {
    return { mode: "help", args: [] };
  }

  // Unrecognised input: return help with the original as args
  return { mode: "help", args: [rest] };
}
