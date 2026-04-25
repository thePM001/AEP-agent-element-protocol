import { describe, it, expect } from "vitest";
import { parseAEPassistInput } from "../../src/aepassist/parser.js";

describe("parseAEPassistInput", () => {
  describe("empty and bare input", () => {
    it("returns help for empty string", () => {
      expect(parseAEPassistInput("")).toEqual({ mode: "help", args: [] });
    });

    it("returns help for bare /aepassist", () => {
      expect(parseAEPassistInput("/aepassist")).toEqual({ mode: "help", args: [] });
    });

    it("returns help for whitespace-only", () => {
      expect(parseAEPassistInput("   ")).toEqual({ mode: "help", args: [] });
    });

    it("returns help for /aepassist with trailing spaces", () => {
      expect(parseAEPassistInput("/aepassist   ")).toEqual({ mode: "help", args: [] });
    });
  });

  describe("numeric shortcuts", () => {
    it("maps 1 to setup", () => {
      expect(parseAEPassistInput("1")).toEqual({ mode: "setup", args: [] });
    });

    it("maps 2 to status", () => {
      expect(parseAEPassistInput("2")).toEqual({ mode: "status", args: [] });
    });

    it("maps 3 to preset", () => {
      expect(parseAEPassistInput("3")).toEqual({ mode: "preset", args: [] });
    });

    it("maps 4 to emergency", () => {
      expect(parseAEPassistInput("4")).toEqual({ mode: "emergency", args: [] });
    });

    it("maps 5 to covenant", () => {
      expect(parseAEPassistInput("5")).toEqual({ mode: "covenant", args: [] });
    });

    it("maps 6 to identity", () => {
      expect(parseAEPassistInput("6")).toEqual({ mode: "identity", args: [] });
    });

    it("maps 7 to report", () => {
      expect(parseAEPassistInput("7")).toEqual({ mode: "report", args: [] });
    });

    it("maps 8 to help", () => {
      expect(parseAEPassistInput("8")).toEqual({ mode: "help", args: [] });
    });

    it("passes remaining args after numeric shortcut", () => {
      expect(parseAEPassistInput("1 ui standard")).toEqual({
        mode: "setup",
        args: ["ui", "standard"],
      });
    });

    it("works with /aepassist prefix", () => {
      expect(parseAEPassistInput("/aepassist 3 strict")).toEqual({
        mode: "preset",
        args: ["strict"],
      });
    });
  });

  describe("keyword modes", () => {
    it("parses setup keyword", () => {
      expect(parseAEPassistInput("setup")).toEqual({ mode: "setup", args: [] });
    });

    it("parses status keyword", () => {
      expect(parseAEPassistInput("status")).toEqual({ mode: "status", args: [] });
    });

    it("parses preset with args", () => {
      expect(parseAEPassistInput("preset strict")).toEqual({
        mode: "preset",
        args: ["strict"],
      });
    });

    it("is case-insensitive for keywords", () => {
      expect(parseAEPassistInput("SETUP")).toEqual({ mode: "setup", args: [] });
    });

    it("handles keyword with /aepassist prefix", () => {
      expect(parseAEPassistInput("/aepassist emergency kill")).toEqual({
        mode: "emergency",
        args: ["kill"],
      });
    });
  });

  describe("emergency shortcuts", () => {
    it("parses kill as emergency", () => {
      expect(parseAEPassistInput("kill")).toEqual({
        mode: "emergency",
        args: ["kill"],
      });
    });

    it("parses kill-rollback as emergency", () => {
      expect(parseAEPassistInput("kill-rollback")).toEqual({
        mode: "emergency",
        args: ["kill-rollback"],
      });
    });

    it("parses pause as emergency", () => {
      expect(parseAEPassistInput("pause")).toEqual({
        mode: "emergency",
        args: ["pause"],
      });
    });

    it("parses resume as emergency", () => {
      expect(parseAEPassistInput("resume")).toEqual({
        mode: "emergency",
        args: ["resume"],
      });
    });
  });

  describe("help aliases", () => {
    it("parses help keyword", () => {
      expect(parseAEPassistInput("help")).toEqual({ mode: "help", args: [] });
    });

    it("parses menu as help", () => {
      expect(parseAEPassistInput("menu")).toEqual({ mode: "help", args: [] });
    });

    it("parses ? as help", () => {
      expect(parseAEPassistInput("?")).toEqual({ mode: "help", args: [] });
    });
  });

  describe("unrecognised input", () => {
    it("returns help with original as args", () => {
      const result = parseAEPassistInput("foobar");
      expect(result.mode).toBe("help");
      expect(result.args).toEqual(["foobar"]);
    });

    it("returns full unrecognised input in args", () => {
      const result = parseAEPassistInput("unknown command here");
      expect(result.mode).toBe("help");
      expect(result.args).toEqual(["unknown command here"]);
    });
  });
});
