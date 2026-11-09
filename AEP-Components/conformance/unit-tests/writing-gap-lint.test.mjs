import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WRITING_GAP_AGENT_RULES,
  collectWritingGapFiles,
  enforceWritingGapPlan,
  enforceWritingGapText,
  fixWritingGapProse,
  fixWritingGapProseLine,
  formatWritingGapReport,
  stripMarkdownCode,
} from "../lib/writing-gap-lint.mjs";

// Only the pure parts are exercised. lintWritingGapContent and lintWritingGapTree
// ask the Base Node kernel binary and are left to the kernel integration suite.

const EM = String.fromCodePoint(0x2014);
const EN = String.fromCodePoint(0x2013);
const BAR = String.fromCodePoint(0x2015);
const TWO_EM = String.fromCodePoint(0x2e3a);
const THREE_EM = String.fromCodePoint(0x2e3b);
const MINUS = String.fromCodePoint(0x2212);
const DOUBLE = " " + "-".repeat(2) + " ";
const TICKS = "`".repeat(3);

describe("fixWritingGapProseLine", () => {
  it("replaces em dash and dash substitutes with a spaced hyphen", () => {
    expect(fixWritingGapProseLine(`alpha${EM}beta`)).toBe("alpha - beta");
    expect(fixWritingGapProseLine(`a${BAR}b${TWO_EM}c${THREE_EM}d`)).toBe("a - b - c - d");
  });

  it("replaces en dash and minus sign with a plain hyphen", () => {
    expect(fixWritingGapProseLine(`pages 3${EN}9`)).toBe("pages 3-9");
    expect(fixWritingGapProseLine(`x ${MINUS} y`)).toBe("x - y");
  });

  it("drops Oxford commas before and and or", () => {
    expect(fixWritingGapProseLine("red, green, and blue")).toBe("red, green and blue");
    expect(fixWritingGapProseLine("tea, milk, or juice")).toBe("tea, milk or juice");
  });

  it("rewrites a spaced double hyphen in prose", () => {
    expect(fixWritingGapProseLine(`left${DOUBLE}right`)).toBe("left - right");
  });

  it("keeps command lines, ranges, comments and rules untouched", () => {
    const cargo = `cargo test${DOUBLE}nocapture`;
    expect(fixWritingGapProseLine(cargo)).toBe(cargo);
    const npm = `npm run x${DOUBLE}y, and z`;
    expect(fixWritingGapProseLine(npm)).toBe(npm);
    expect(fixWritingGapProseLine("<!-- note, and more -->")).toBe("<!-- note, and more -->");
    expect(fixWritingGapProseLine("---")).toBe("---");
    expect(fixWritingGapProseLine("1--2")).toBe("1--2");
  });

  it("keeps tree diagram lines untouched", () => {
    const tree = `${String.fromCodePoint(0x251c)}${EM} src, and lib`;
    expect(fixWritingGapProseLine(tree)).toBe(tree);
    const pipe = `| a${EM}b |`;
    expect(fixWritingGapProseLine(pipe)).toBe(pipe);
  });

  it("returns clean prose as is", () => {
    expect(fixWritingGapProseLine("plain words only")).toBe("plain words only");
  });
});

describe("fixWritingGapProse and enforceWritingGapText", () => {
  it("fixes every line of a multi line text", () => {
    expect(fixWritingGapProse(`a${EM}b\nc, d, and e`)).toBe("a - b\nc, d and e");
  });

  it("treats null and undefined as empty text", () => {
    expect(fixWritingGapProse(null)).toBe("");
    expect(fixWritingGapProse(undefined)).toBe("");
  });

  it("leaves fenced code blocks alone and fixes the prose around them", () => {
    const text = `before${EM}x\n${TICKS}\nkeep${EM}this, and that\n${TICKS}\nafter, a, and b`;
    const out = enforceWritingGapText(text);
    expect(out).toBe(`before - x\n${TICKS}\nkeep${EM}this, and that\n${TICKS}\nafter, a and b`);
  });

  it("returns falsy input unchanged", () => {
    expect(enforceWritingGapText("")).toBe("");
    expect(enforceWritingGapText(null)).toBe(null);
  });
});

describe("enforceWritingGapPlan", () => {
  it("fixes intent, warnings, component reasons and topology labels without mutating the input", () => {
    const plan = {
      user_intent: `ship${EM}now`,
      warnings: ["a, b, and c", 7],
      components: [{ id: "x", reason: `why${EN}not` }, { id: "y", reason: 3 }],
      topology: { edges: [1], nodes: [{ id: "n", label: `l${EM}m` }, { id: "o" }] },
      other: `kept${EM}raw`,
    };
    const out = enforceWritingGapPlan(plan);
    expect(out.user_intent).toBe("ship - now");
    expect(out.warnings).toEqual(["a, b and c", 7]);
    expect(out.components).toEqual([{ id: "x", reason: "why-not" }, { id: "y", reason: 3 }]);
    expect(out.topology.edges).toEqual([1]);
    expect(out.topology.nodes).toEqual([{ id: "n", label: "l - m" }, { id: "o", label: undefined }]);
    expect(out.other).toBe(`kept${EM}raw`);
    expect(plan.user_intent).toBe(`ship${EM}now`);
    expect(out).not.toBe(plan);
  });

  it("passes non objects through", () => {
    expect(enforceWritingGapPlan(null)).toBe(null);
    expect(enforceWritingGapPlan("text")).toBe("text");
  });
});

describe("stripMarkdownCode", () => {
  it("removes fenced blocks and inline code spans", () => {
    const md = `keep\n${TICKS}js\nconst a = 1;\n${TICKS}\nuse \`x${EM}y\` here`;
    expect(stripMarkdownCode(md)).toBe("keep\n\nuse  here");
  });
});

describe("formatWritingGapReport", () => {
  it("passes on no violations", () => {
    expect(formatWritingGapReport([])).toBe("PASS writing.gap: no documentation style violations.");
  });

  it("lists violations with snippets", () => {
    const out = formatWritingGapReport([
      { file: "a.md", line: 3, rule: "no_em_dashes", message: "em dash", snippet: "bad line" },
      { file: "b.md", line: 0, rule: "read_error", message: "could not read", snippet: "" },
    ]);
    expect(out.split("\n")).toEqual([
      "FAIL writing.gap: 2 violation(s):",
      "  a.md:3 [no_em_dashes] em dash",
      "    bad line",
      "  b.md:0 [read_error] could not read",
    ]);
  });

  it("caps the listing at fifty and counts the rest", () => {
    const many = Array.from({ length: 53 }, (_, i) => ({
      file: `f${i}.md`,
      line: i,
      rule: "r",
      message: "m",
      snippet: "",
    }));
    const lines = formatWritingGapReport(many).split("\n");
    expect(lines[0]).toBe("FAIL writing.gap: 53 violation(s):");
    expect(lines.length).toBe(52);
    expect(lines[51]).toBe("  ... and 3 more");
  });
});

describe("WRITING_GAP_AGENT_RULES", () => {
  it("names the dash and Oxford comma rules for agents", () => {
    expect(WRITING_GAP_AGENT_RULES).toMatch(/em-dashes/);
    expect(WRITING_GAP_AGENT_RULES).toMatch(/Oxford commas/);
  });
});

describe("collectWritingGapFiles", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  function put(rel, body = "x") {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }

  it("collects markdown everywhere and json only under registry, skipping build folders", () => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    put("README.md");
    put("docs/guide.md");
    put("registry/entry.json");
    put("other/data.json");
    put("node_modules/pkg/README.md");
    put("target/out.md");
    put("docs/notes.txt");
    const files = collectWritingGapFiles(dir);
    expect(files.map((f) => [f.rel, f.kind])).toEqual([
      ["docs/guide.md", "markdown"],
      ["README.md", "markdown"],
      ["registry/entry.json", "json"],
    ].sort((a, b) => a[0].localeCompare(b[0])));
    expect(files[0].path.startsWith(dir)).toBe(true);
  });

  it("honours the shipped roots list for top level folders", () => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    put("AEP-User-Experience/harness/shipped-roots.list", "# shipped\nAEP-User-Experience\n\ndocs\n");
    put("docs/a.md");
    put("internal/b.md");
    put("top.md");
    const rels = collectWritingGapFiles(dir).map((f) => f.rel);
    expect(rels).toEqual(["docs/a.md", "top.md"]);
  });

  it("accepts custom extension specs", () => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    put("a.txt");
    put("b.md");
    const files = collectWritingGapFiles(dir, { extensions: [{ ext: ".txt", kind: "text" }] });
    expect(files).toEqual([{ path: join(dir, "a.txt"), rel: "a.txt", kind: "text" }]);
  });

  it("returns nothing for a missing root", () => {
    expect(collectWritingGapFiles(join(tmpdir(), "aep-missing-root-for-test"))).toEqual([]);
  });
});
