/**
 * MCP security scanners and tool-policy helpers (AEP 2.8).
 * Fail-closed defaults: unknown tools deny; empty policy denies all tools.
 */

export type McpToolPolicy = {
  allow?: string[];
  deny?: string[];
  /** When true (default), tools not in allow are denied. */
  defaultDeny?: boolean;
};

export type McpSecurityScanResult = {
  allowed: boolean;
  reason: string;
  tool: string;
};

export function scanToolCall(
  toolName: string,
  policy: McpToolPolicy = {}
): McpSecurityScanResult {
  const name = String(toolName || "").trim();
  if (!name) {
    return { allowed: false, reason: "empty tool name", tool: name };
  }
  const deny = new Set((policy.deny ?? []).map((s) => s.toLowerCase()));
  const allow = new Set((policy.allow ?? []).map((s) => s.toLowerCase()));
  const key = name.toLowerCase();
  if (deny.has(key)) {
    return { allowed: false, reason: "tool on deny list", tool: name };
  }
  // LOW: remove open default-allow; only explicit allow:["*"] opens all tools
  if (allow.size > 0) {
    if (allow.has("*")) {
      return { allowed: true, reason: "allow list wildcard", tool: name };
    }
    if (!allow.has(key)) {
      return { allowed: false, reason: "tool not on allow list", tool: name };
    }
    return { allowed: true, reason: "allow list match", tool: name };
  }
  // Always fail closed when no allow list (defaultDeny cannot open the gate)
  return {
    allowed: false,
    reason: "default deny (no allow list configured)",
    tool: name,
  };
}

export function assertToolAllowed(toolName: string, policy?: McpToolPolicy): void {
  const r = scanToolCall(toolName, policy);
  if (!r.allowed) {
    throw new Error(`mcp-security denied tool ${toolName}: ${r.reason}`);
  }
}
