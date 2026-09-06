export function transpileGapToRego(gapSource: string): string {
  if (typeof gapSource !== "string" || gapSource.trim().length === 0) {
    throw new Error("GAP source is empty; refusing pass-through");
  }
  const gap = parseGap(gapSource);
  const pkg = toPackage(gap.domain);
  const lines: string[] = [];
  lines.push("package " + pkg);
  lines.push("");
  if (gap.invariants.length === 0 && gap.constraints.length === 0) {
    throw new Error("GAP source has no invariants or constraints");
  }
  for (let i = 0; i < gap.invariants.length; i++) {
    const inv = gap.invariants[i];
    const ident = identOf(inv.expr, i);
    lines.push("deny[msg] {");
    lines.push("  not input.satisfied[\"" + ident + "\"]");
    const desc = inv.description.length > 0 ? inv.description : inv.expr;
    lines.push("  msg := sprintf(\"" + escapeRego(desc) + "\", [])");
    lines.push("}");
    lines.push("");
  }
  for (let i = 0; i < gap.constraints.length; i++) {
    const c = gap.constraints[i];
    const ident = identOf(c, i + gap.invariants.length);
    lines.push("deny[msg] {");
    lines.push("  not input.constraints[\"" + ident + "\"]");
    lines.push("  msg := sprintf(\"constraint failed: " + escapeRego(c) + "\", [])");
    lines.push("}");
    lines.push("");
  }
  const out = lines.join("\n");
  if (out.indexOf("package ") !== 0 || out.indexOf("deny[msg]") < 0) {
    throw new Error("GAP to Rego produced no package deny rules");
  }
  return out;
}

type GapInv = { expr: string; severity: string; description: string };
type GapDoc = { domain: string; invariants: GapInv[]; constraints: string[] };

function parseGap(src: string): GapDoc {
  const trimmed = src.trim();
  if (trimmed.charAt(0) === "{") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_e) {
      throw new Error("GAP JSON is not parseable");
    }
    return fromUnknown(parsed);
  }
  return fromLines(trimmed);
}

function fromUnknown(v: unknown): GapDoc {
  if (v === null || typeof v !== "object") {
    throw new Error("GAP document is not an object");
  }
  const o = v as Record<string, unknown>;
  const address = o.address as Record<string, unknown> | undefined;
  const pattern = o.pattern as Record<string, unknown> | undefined;
  const domain =
    address !== undefined && typeof address.domain === "string" && address.domain.length > 0
      ? address.domain
      : "gap.imported";
  const constraints: string[] = [];
  const invariants: GapInv[] = [];
  if (pattern !== undefined && Array.isArray(pattern.constraints)) {
    for (const c of pattern.constraints) {
      if (typeof c === "string") {
        constraints.push(c);
      }
    }
  }
  if (pattern !== undefined && Array.isArray(pattern.invariants)) {
    for (const inv of pattern.invariants) {
      if (inv !== null && typeof inv === "object") {
        const r = inv as Record<string, unknown>;
        invariants.push({
          expr: typeof r.expr === "string" ? r.expr : "gap_item",
          severity: typeof r.severity === "string" ? r.severity : "hard",
          description: typeof r.description === "string" ? r.description : "",
        });
      }
    }
  }
  if (invariants.length === 0 && constraints.length === 0) {
    throw new Error("GAP JSON has no pattern invariants or constraints");
  }
  return { domain, invariants, constraints };
}

function fromLines(src: string): GapDoc {
  const constraints: string[] = [];
  const invariants: GapInv[] = [];
  let domain = "gap.imported";
  const lines = src.split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (t.indexOf("domain:") === 0) {
      domain = t.slice("domain:".length).trim().replace(/["']/g, "");
    } else if (t.indexOf("constraint:") === 0) {
      constraints.push(t.slice("constraint:".length).trim());
    } else if (t.indexOf("expr:") === 0) {
      invariants.push({
        expr: t.slice("expr:".length).trim().replace(/["']/g, ""),
        severity: "hard",
        description: "",
      });
    }
  }
  if (invariants.length === 0 && constraints.length === 0) {
    throw new Error("GAP source has no address pattern items");
  }
  return { domain, invariants, constraints };
}

function toPackage(domain: string): string {
  const cleaned = domain.replace(/[^A-Za-z0-9_.]/g, "_");
  if (cleaned.length === 0) {
    return "gap.imported";
  }
  if (/^[0-9]/.test(cleaned)) {
    return "gap_" + cleaned;
  }
  return cleaned;
}

function identOf(expr: string, i: number): string {
  const cleaned = expr.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_");
  if (cleaned.length === 0) {
    return "item_" + String(i + 1);
  }
  return cleaned.slice(0, 72);
}

function escapeRego(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
