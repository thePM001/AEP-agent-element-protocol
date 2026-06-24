#!/usr/bin/env node

import { lintGovernedProseStrict } from "../../../AEP-Components/lattice-channels/lib/lattice-transport.mjs";

const GREETING_SLANG_RE = /\b(biosecure|unvaccinated)\b/i;
const CANVAS_INVENTORY_RE =
  /\b(lattice hub|docks?|agents?|ucb|storage|node counts?|\d+\s+nodes?|\d+\s+edges?)\b/i;
const DEPLOYMENT_SLOGAN_RE =
  /\b(governed for secure building|solid lattice hub|biosecure and unvaccinated)\b/i;

/** Backtick spans are symbol references, not governed prose (e.g. `?` and `[`). */
export function stripLintExemptRegions(text) {
  return String(text ?? "").replace(/`[^`]*`/g, (match) => " ".repeat(match.length));
}

const SPACED_SIGN_CHARS = new Set(["?", "!", "[", "]", "(", ")", "\uFF1F", "\uFF01"]);

function normalizeSpacedSign(ch) {
  if (ch === "\uFF1F") return "?";
  if (ch === "\uFF01") return "!";
  return ch;
}

function skipSpacedSignAfterContext(raw, index) {
  const prev = index > 0 ? raw[index - 1] : "";
  return prev === "/" || prev === "=" || prev === "&";
}

/** EPSCOM writing mode: space before ? ! [ ] ( ) (e.g. "building ?" not "building?"). */
export function lintMissingSpaceBeforeSentencePunct(text) {
  const violations = [];
  const raw = stripLintExemptRegions(text);
  for (let i = 1; i < raw.length; i += 1) {
    const ch = raw[i];
    const prev = raw[i - 1];
    if (SPACED_SIGN_CHARS.has(ch) && /[A-Za-z0-9]/.test(prev)) {
      violations.push({
        rule: "space_before_spaced_signs",
        message: "add space before ? ! [ ] ( ) (write \"building ?\" or \"word [ note ]\" not \"building?\" or \"word[note]\")",
        line: 1,
      });
      break;
    }
  }
  return violations;
}

/** Missing space after ? ! [ ] ( ) before the next word (e.g. "ready ?I" or "[note"). */
export function lintMissingSpaceAfterSentencePunct(text) {
  const violations = [];
  const raw = stripLintExemptRegions(text);
  for (let i = 0; i < raw.length - 1; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (SPACED_SIGN_CHARS.has(ch) && /[A-Za-z0-9]/.test(next)) {
      if (skipSpacedSignAfterContext(raw, i)) continue;
      violations.push({
        rule: "spaced_sign_word_space",
        message: `missing space after "${normalizeSpacedSign(ch)}" before next word`,
        line: 1,
        snippet: raw.slice(Math.max(0, i - 12), i + 14),
      });
      break;
    }
  }
  return violations;
}

/** Commas and semicolons attach directly; no space before them. */
export function lintSpaceBeforeCommaSemicolon(text) {
  const raw = stripLintExemptRegions(text);
  if (!/\s[,;]/.test(raw)) return [];
  return [
    {
      rule: "attach_comma_semicolon",
      message: "attach comma or semicolon directly to the preceding word (no space before)",
      line: 1,
    },
  ];
}

/** Double colons attach directly; no space before ::. */
export function lintSpaceBeforeDoubleColon(text) {
  const raw = stripLintExemptRegions(text);
  if (!/\s::/.test(raw)) return [];
  return [
    {
      rule: "attach_double_colon",
      message: "attach double colon directly to the preceding word (no space before ::)",
      line: 1,
    },
  ];
}

const INSTRUCTION_ECHO_RE =
  /\b(use words like|when describing the rule itself|describe mistakes in words instead|compliant example sentences|reply in chat mode only|no json blocks|no implementationplan|canvas inventory|epscom writing\.gap punctuation or style rules|explain the rule in plain language)\b/i;

/** Reject replies that parrot internal CCA prompt instructions to the user. */
export function lintCcaInstructionEcho(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || !INSTRUCTION_ECHO_RE.test(trimmed)) return [];
  return [
    {
      rule: "cca_no_instruction_echo",
      message: "reply must not echo internal CCA instructions; explain the rule in natural prose",
    },
  ];
}

/** Writing-help answers must use backtick symbol refs for the signs discussed. */
export function lintCcaWritingHelpSymbolRefs(text, opts = {}) {
  if (!opts.writingHelp) return [];
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return [];
  const userMsg = String(opts.userMessage ?? "");
  const needs = [];
  if (/[?]|question mark/i.test(userMsg)) needs.push("`?`");
  if (/[!]|exclamation/i.test(userMsg)) needs.push("`!`");
  if (/[\[]|bracket/i.test(userMsg)) needs.push("`[`");
  if (/[\]]|bracket/i.test(userMsg)) needs.push("`]`");
  if (/[(]|parenthes/i.test(userMsg)) needs.push("`(`");
  if (/[)]|parenthes/i.test(userMsg)) needs.push("`)`");
  if (!needs.length && /[?!\[\]\(\)]/.test(userMsg)) {
    needs.push("`?`", "`!`", "`[`", "`]`");
  }
  const missing = needs.filter((ref) => !trimmed.includes(ref));
  if (missing.length) {
    return [
      {
        rule: "cca_writing_help_symbol_refs",
        message: `writing-help must name signs with backtick refs (missing ${missing.join(", ")})`,
      },
    ];
  }
  return [];
}

export function lintCcaGreetingOutput(text) {
  const violations = [];
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return violations;

  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length > 2) {
    violations.push({
      rule: "cca_greeting_length",
      message: `greeting must be one or two sentences (got ${sentences.length})`,
    });
  }
  if (GREETING_SLANG_RE.test(trimmed)) {
    violations.push({
      rule: "cca_greeting_no_slang_echo",
      message: "greeting must not echo user slang or joke phrases",
    });
  }
  if (CANVAS_INVENTORY_RE.test(trimmed)) {
    violations.push({
      rule: "cca_greeting_no_canvas_inventory",
      message: "greeting must not inventory canvas nodes, docks, agents, UCB or storage",
    });
  }
  if (DEPLOYMENT_SLOGAN_RE.test(trimmed)) {
    violations.push({
      rule: "cca_greeting_no_deployment_slogan",
      message: "greeting must not use deployment slogans",
    });
  }
  return violations;
}

/**
 * Full CCA chat writing validation for hyperlattice validate_writing stage.
 * No auto-fix. Fail-closed on any constraint from cca-writing-chat.gap + EPSCOM.
 */
export function validateCcaChatWritingDraft(text, opts = {}) {
  const violations = [
    ...lintMissingSpaceBeforeSentencePunct(text),
    ...lintMissingSpaceAfterSentencePunct(text),
    ...lintSpaceBeforeCommaSemicolon(text),
    ...lintSpaceBeforeDoubleColon(text),
    ...lintGovernedProseStrict(text, {
      ccaChat: opts.ccaChat ?? true,
      latticeLogBin: opts.latticeLogBin,
      configPath: opts.configPath,
    }),
    ...lintCcaInstructionEcho(text),
    ...lintCcaWritingHelpSymbolRefs(text, opts),
  ];

  if (opts.greeting) {
    violations.push(...lintCcaGreetingOutput(text));
  }

  const seen = new Set();
  const unique = violations.filter((v) => {
    const key = `${v.rule}:${v.line ?? 0}:${v.message ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    ok: unique.length === 0,
    authority: "epscom-core",
    violations: unique,
    rules_checked: [
      "space_before_spaced_signs",
      "spaced_sign_word_space",
      "attach_comma_semicolon",
      "attach_double_colon",
      "no_em_dashes",
      "no_en_dashes",
      "no_oxford_comma",
      "no_double_hyphen",
      "cca_declarative_closing",
      "cca_no_instruction_echo",
      ...(opts.writingHelp ? ["cca_writing_help_symbol_refs"] : []),
      ...(opts.greeting
        ? [
            "cca_greeting_length",
            "cca_greeting_no_slang_echo",
            "cca_greeting_no_canvas_inventory",
            "cca_greeting_no_deployment_slogan",
          ]
        : []),
    ],
    strict: true,
    greeting_mode: Boolean(opts.greeting),
  };
}

/** Throws with violations when draft fails hyperlattice writing gate. */
export function assertCcaChatWritingDraft(text, opts = {}) {
  const validation = validateCcaChatWritingDraft(text, opts);
  if (validation.ok) return String(text ?? "");
  const err = new Error(
    `CCA hyperlattice writing.gap blocked draft: ${validation.violations.map((v) => v.rule).join(", ")}`,
  );
  err.violations = validation.violations;
  err.writing_validation = { ...validation, ok: false };
  throw err;
}