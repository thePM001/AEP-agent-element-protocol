import { describe, it, expect } from "vitest";
import { assertToolAllowed, scanToolCall } from "../lib/mcp-security/index.js";

describe("scanToolCall", () => {
  it("denies an empty or blank tool name", () => {
    expect(scanToolCall("", { allow: ["*"] })).toEqual({ allowed: false, reason: "empty tool name", tool: "" });
    expect(scanToolCall("   ", { allow: ["*"] }).allowed).toBe(false);
  });

  it("denies everything when no allow list is configured", () => {
    expect(scanToolCall("read_file")).toEqual({
      allowed: false,
      reason: "default deny (no allow list configured)",
      tool: "read_file",
    });
    expect(scanToolCall("read_file", { defaultDeny: false }).allowed).toBe(false);
    expect(scanToolCall("read_file", { allow: [] }).allowed).toBe(false);
  });

  it("allows only listed tools, ignoring case and surrounding space", () => {
    const policy = { allow: ["Read_File", "list_dir"] };
    expect(scanToolCall("  read_file ", policy)).toEqual({ allowed: true, reason: "allow list match", tool: "read_file" });
    expect(scanToolCall("LIST_DIR", policy).allowed).toBe(true);
    expect(scanToolCall("write_file", policy)).toEqual({
      allowed: false,
      reason: "tool not on allow list",
      tool: "write_file",
    });
  });

  it("opens all tools only through an explicit wildcard", () => {
    expect(scanToolCall("anything", { allow: ["*"] })).toEqual({
      allowed: true,
      reason: "allow list wildcard",
      tool: "anything",
    });
  });

  it("lets the deny list win over the allow list and the wildcard", () => {
    expect(scanToolCall("Exec", { allow: ["*"], deny: ["exec"] })).toEqual({
      allowed: false,
      reason: "tool on deny list",
      tool: "Exec",
    });
    expect(scanToolCall("exec", { allow: ["exec"], deny: ["EXEC"] }).allowed).toBe(false);
  });
});

describe("assertToolAllowed", () => {
  it("returns quietly for an allowed tool", () => {
    expect(() => assertToolAllowed("read_file", { allow: ["read_file"] })).not.toThrow();
  });

  it("throws with the reason for a denied tool", () => {
    expect(() => assertToolAllowed("rm", { allow: ["read_file"] })).toThrow("mcp-security denied tool rm: tool not on allow list");
    expect(() => assertToolAllowed("rm")).toThrow("mcp-security denied tool rm: default deny (no allow list configured)");
  });
});
