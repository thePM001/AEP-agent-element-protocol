// Pure lint helpers of the CCA writing validator. validateCcaChatWritingDraft is
// not called here because its strict prose pass asks the Base Node kernel binary.

import { describe, expect, it } from "vitest";
import {
  lintCcaGreetingOutput,
  lintCcaInstructionEcho,
  lintCcaWritingHelpSymbolRefs,
  lintMissingSpaceAfterSentencePunct,
  lintMissingSpaceBeforeSentencePunct,
  lintSpaceBeforeCommaSemicolon,
  lintSpaceBeforeDoubleColon,
  stripLintExemptRegions,
  writingRuleIds,
} from "../lib/cca-writing-validator.mjs";

const rules = (list) => list.map((v) => v.rule);

describe("writingRuleIds", () => {
  it("reads the rule family from writing.gap", () => {
    const ids = writingRuleIds();
    for (const id of ["no_em_dashes", "no_oxford_comma", "space_before_spaced_signs", "attach_double_colon"]) {
      expect(ids).toContain(id);
    }
  });
});

describe("stripLintExemptRegions", () => {
  it("blanks backtick spans and keeps the length", () => {
    expect(stripLintExemptRegions("use `?` here")).toBe("use     here");
    expect(stripLintExemptRegions(null)).toBe("");
  });
});

describe("lintMissingSpaceBeforeSentencePunct", () => {
  it("closes on a sign glued to a word", () => {
    const out = lintMissingSpaceBeforeSentencePunct("is it ready?");
    expect(rules(out)).toEqual(["space_before_spaced_signs"]);
    expect(out[0].line).toBe(1);
    expect(rules(lintMissingSpaceBeforeSentencePunct("word[note ]"))).toEqual(["space_before_spaced_signs"]);
    expect(rules(lintMissingSpaceBeforeSentencePunct("ready" + String.fromCodePoint(0xff1f)))).toEqual(["space_before_spaced_signs"]);
  });

  it("allows a spaced sign and signs inside backticks", () => {
    expect(lintMissingSpaceBeforeSentencePunct("is it ready ?")).toEqual([]);
    expect(lintMissingSpaceBeforeSentencePunct("type `a?` now")).toEqual([]);
    expect(lintMissingSpaceBeforeSentencePunct("")).toEqual([]);
  });

  it("reports once per text", () => {
    expect(lintMissingSpaceBeforeSentencePunct("a? b! c(")).toHaveLength(1);
  });
});

describe("lintMissingSpaceAfterSentencePunct", () => {
  it("closes on a sign glued to the next word with a snippet", () => {
    const out = lintMissingSpaceAfterSentencePunct("ready ?Now go");
    expect(out).toHaveLength(1);
    expect(out[0].message).toBe('missing space after "?" before next word');
    expect(out[0].snippet).toContain("?Now");
    expect(["spaced_sign_word_space", "writing_rule_not_in_source"]).toContain(out[0].rule);
  });

  it("normalises full width signs in the message", () => {
    const [v] = lintMissingSpaceAfterSentencePunct("ok " + String.fromCodePoint(0xff01) + "Go");
    expect(v.message).toBe('missing space after "!" before next word');
  });

  it("skips url query, assignment and ampersand contexts", () => {
    expect(lintMissingSpaceAfterSentencePunct("see /?q=1 and a=(b) and &(x)")).toEqual([]);
  });

  it("allows spaced signs", () => {
    expect(lintMissingSpaceAfterSentencePunct("ready ? Now [ note ]")).toEqual([]);
  });
});

describe("attach rules", () => {
  it("closes on a space before a comma or semicolon", () => {
    expect(rules(lintSpaceBeforeCommaSemicolon("one , two"))).toEqual(["attach_comma_semicolon"]);
    expect(rules(lintSpaceBeforeCommaSemicolon("one ; two"))).toEqual(["attach_comma_semicolon"]);
    expect(lintSpaceBeforeCommaSemicolon("one, two; three")).toEqual([]);
    expect(lintSpaceBeforeCommaSemicolon("code `a , b` here")).toEqual([]);
  });

  it("closes on a space before a double colon", () => {
    expect(rules(lintSpaceBeforeDoubleColon("Type ::new"))).toEqual(["attach_double_colon"]);
    expect(lintSpaceBeforeDoubleColon("Type::new")).toEqual([]);
  });
});

describe("lintCcaInstructionEcho", () => {
  it("closes on echoed internal instructions", () => {
    expect(rules(lintCcaInstructionEcho("Reply in chat mode only, as asked."))).toEqual(["cca_no_instruction_echo"]);
    expect(rules(lintCcaInstructionEcho("There is no JSON blocks here"))).toEqual(["cca_no_instruction_echo"]);
  });

  it("allows ordinary prose and empty text", () => {
    expect(lintCcaInstructionEcho("The hub routes every action.")).toEqual([]);
    expect(lintCcaInstructionEcho("   ")).toEqual([]);
  });
});

describe("lintCcaWritingHelpSymbolRefs", () => {
  it("does nothing outside writing help mode", () => {
    expect(lintCcaWritingHelpSymbolRefs("text", { userMessage: "question mark ?" })).toEqual([]);
  });

  it("requires backtick refs for each sign the user asked about", () => {
    const out = lintCcaWritingHelpSymbolRefs("Put a space before `?` always.", {
      writingHelp: true,
      userMessage: "how do I use the question mark and brackets",
    });
    expect(rules(out)).toEqual(["cca_writing_help_symbol_refs"]);
    expect(out[0].message).toBe("writing-help must name signs with backtick refs (missing `[`, `]`)");
  });

  it("passes when every needed ref is present", () => {
    expect(
      lintCcaWritingHelpSymbolRefs("Use `(` and `)` with spaces.", { writingHelp: true, userMessage: "parentheses" }),
    ).toEqual([]);
  });

  it("asks for the four main signs when the message has none of the words", () => {
    const [v] = lintCcaWritingHelpSymbolRefs("Some answer.", { writingHelp: true, userMessage: "what about )" });
    expect(v.message).toContain("`)`");
    const none = lintCcaWritingHelpSymbolRefs("Some answer.", { writingHelp: true, userMessage: "hello" });
    expect(none).toEqual([]);
  });

  it("ignores an empty reply", () => {
    expect(lintCcaWritingHelpSymbolRefs("  ", { writingHelp: true, userMessage: "?" })).toEqual([]);
  });
});

describe("lintCcaGreetingOutput", () => {
  it("allows a short plain greeting", () => {
    expect(lintCcaGreetingOutput("Hello. How can I help today ?")).toEqual([]);
    expect(lintCcaGreetingOutput("")).toEqual([]);
  });

  it("closes on long greetings, slang, canvas inventory and slogans", () => {
    expect(rules(lintCcaGreetingOutput("Hi. Welcome. Ready. Go."))).toEqual(["cca_greeting_length"]);
    expect(rules(lintCcaGreetingOutput("Hi biosecure friend."))).toEqual(["cca_greeting_no_slang_echo"]);
    expect(rules(lintCcaGreetingOutput("You have 3 nodes on the canvas."))).toEqual(["cca_greeting_no_canvas_inventory"]);
    expect(rules(lintCcaGreetingOutput("Welcome, governed for secure building."))).toEqual([
      "cca_greeting_no_deployment_slogan",
    ]);
  });

  it("reports every greeting rule that closes", () => {
    const out = lintCcaGreetingOutput("Hi. The lattice hub is biosecure and unvaccinated. Wow.");
    expect(rules(out)).toEqual([
      "cca_greeting_length",
      "cca_greeting_no_slang_echo",
      "cca_greeting_no_canvas_inventory",
      "cca_greeting_no_deployment_slogan",
    ]);
  });
});
