export function transpileGapToCedar(gapSource: string): string {
  if (typeof gapSource !== "string" || gapSource.trim().length === 0) {
    throw new Error("GAP source is empty; refusing pass-through");
  }
  const gap = parseGap(gapSource);
  const domain = gap.domain;
  const invariants = gap.invariants;
  if (invariants.length === 0 && gap.constraints.length === 0) {
    throw new Error("GAP source has no invariants or constraints");
  }
  const lines: string[] = [];
  if (invariants.length === 0) {
    const cond = gap.constraints.map((c) => 'context.constraint == "' + escapeCedar(c) + '"').join(" && ");
    lines.push("forbid (");
    lines.push('  principal,');
    lines.push('  action,');
    lines.push('  resource');
    lines.push(") when {");
    lines.push("  " + (cond.length > 0 ? cond : "true"));
    lines.push("};");
  }
  for (let i = 0; i < invariants.length; i++) {
    const inv = invariants[i];
    const effect = inv.severity === "hard" ? "forbid" : "permit";
    lines.push(effect + " (");
    lines.push("  principal,");
    lines.push('  action == Action::"' + escapeCedar(inv.expr.length > 0 ? inv.expr : "policy") + '",');
    lines.push('  resource == Resource::"' + escapeCedar(domain) + '"');
    lines.push(") when {");
    lines.push('  context.invariant == "' + escapeCedar(inv.expr) + '"');
    if (inv.description.length > 0) {
      lines.push('  // ' + inv.description.replace(/\n/g, " ").slice(0, 160));
    }
    lines.push("};");
    if (i + 1 < invariants.length) {
      lines.push("");
    }
  }
  const out = lines.join("\n");
  if (out.trim().length === 0) {
    throw new Error("GAP to Cedar produced no statements");
  }
  return out + "\n";
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
    } else if (t.indexOf("constraint:") === 0 || t.indexOf("- ") === 0) {
      constraints.push(t.replace(/^- /, "").replace(/^constraint:\s*/, ""));
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

function escapeCedar(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
