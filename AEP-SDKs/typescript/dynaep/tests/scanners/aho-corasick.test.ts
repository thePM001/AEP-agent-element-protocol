// @PAD: /root/dynAEP/sdk/typescript/tests/scanners/aho-corasick.test.ts
// ===========================================================================
// Tests: OPT-003 Aho-Corasick Multi-Pattern String Matching
// ===========================================================================

import { describe, it, expect } from "vitest";
import { AhoCorasick } from "../../src/scanners/AhoCorasick";

describe("AhoCorasick", () => {
  it("finds a single pattern in text", () => {
    const ac = new AhoCorasick(["hello"]);
    const matches = ac.search("say hello world");
    expect(matches.length).toBe(1);
    expect(matches[0].patternIndex).toBe(0);
    expect(matches[0].start).toBe(4);
    expect(matches[0].end).toBe(9);
    expect(matches[0].text).toBe("hello");
  });

  it("finds multiple patterns in text", () => {
    const ac = new AhoCorasick(["api_key", "secret", "password"]);
    const matches = ac.search("my api_key is secret and my password is hidden");
    expect(matches.length).toBe(3);

    const found = matches.map(m => m.text.toLowerCase());
    expect(found).toContain("api_key");
    expect(found).toContain("secret");
    expect(found).toContain("password");
  });

  it("handles overlapping patterns", () => {
    const ac = new AhoCorasick(["he", "her", "here"]);
    const matches = ac.search("here is the answer");

    // Should find all overlapping: he, her, here at position 0, and "he" at position 11
    const texts = matches.map(m => m.text.toLowerCase());
    expect(texts).toContain("he");
    expect(texts).toContain("her");
    expect(texts).toContain("here");
  });

  it("handles patterns that are prefixes of other patterns", () => {
    const ac = new AhoCorasick(["abc", "abcd", "abcde"]);
    const matches = ac.search("xabcdey");

    const texts = matches.map(m => m.text.toLowerCase());
    expect(texts).toContain("abc");
    expect(texts).toContain("abcd");
    expect(texts).toContain("abcde");
  });

  it("case-insensitive matching", () => {
    const ac = new AhoCorasick(["SELECT", "FROM"], false);
    const matches = ac.search("select * from users");
    expect(matches.length).toBe(2);
  });

  it("case-sensitive matching", () => {
    const ac = new AhoCorasick(["SELECT", "FROM"], true);
    const matches = ac.search("select * from users");
    expect(matches.length).toBe(0);

    const matches2 = ac.search("SELECT * FROM users");
    expect(matches2.length).toBe(2);
  });

  it("returns empty for no matches", () => {
    const ac = new AhoCorasick(["xyz", "abc"]);
    const matches = ac.search("nothing here to find");
    expect(matches.length).toBe(0);
  });

  it("returns empty for empty text", () => {
    const ac = new AhoCorasick(["test"]);
    const matches = ac.search("");
    expect(matches.length).toBe(0);
  });

  it("handles empty pattern list", () => {
    const ac = new AhoCorasick([]);
    const matches = ac.search("some text");
    expect(matches.length).toBe(0);
    expect(ac.patternCount).toBe(0);
  });

  it("finds multiple occurrences of the same pattern", () => {
    const ac = new AhoCorasick(["the"]);
    const matches = ac.search("the cat sat on the mat in the sun");
    expect(matches.length).toBe(3);
    expect(matches.every(m => m.patternIndex === 0)).toBe(true);
  });

  it("correctly reports pattern index for multiple patterns", () => {
    const patterns = ["alpha", "beta", "gamma"];
    const ac = new AhoCorasick(patterns);
    const matches = ac.search("start beta middle gamma end alpha");

    const indices = matches.map(m => m.patternIndex).sort();
    expect(indices).toEqual([0, 1, 2]);
  });

  it("handles special characters in patterns", () => {
    const ac = new AhoCorasick(["api_key=", "password:"]);
    const matches = ac.search("config has api_key=abc123 and password:secret");
    expect(matches.length).toBe(2);
  });
});
