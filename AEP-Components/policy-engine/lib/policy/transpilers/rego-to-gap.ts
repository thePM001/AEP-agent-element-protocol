export function transpileRegoToGap(regoSource: string): string {
  if (typeof regoSource !== "string" || regoSource.trim().length === 0) {
    throw new Error("Rego source is empty; refusing pass-through");
  }
  const text = regoSource.trim();
  const pkg = matchPackage(text);
  if (pkg.length === 0 && /deny|allow/.test(text) === false) {
    throw new Error("Rego source has no package or deny/allow rule");
  }
  const rules = extractRules(text);
  if (rules.length === 0) {
    throw new Error("Rego source has no deny or allow rule");
  }
  const constraints: string[] = [];
  const invariants: Array<Record<string, string>> = [];
  const steps: string[] = [];
  constraints.push("rego:package:" + (pkg.length > 0 ? pkg : "data"));
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    steps.push(r.kind === "deny" ? "deny" : "allow");
    constraints.push("rego:" + r.kind + ":" + String(i + 1));
    if (r.msg.length > 0) {
      constraints.push("rego:msg:" + r.msg.slice(0, 120));
    }
    invariants.push({
      expr: "rego_" + r.kind + "_" + String(i + 1),
      lang: "gapdsl",
      severity: r.kind === "deny" ? "hard" : "soft",
      description: r.body.slice(0, 240),
    });
  }
  const gap = {
    address: { domain: pkg.length > 0 ? pkg : "rego.imported", id: "policy" },
    pattern: {
      guard: "true",
      constraints,
      invariants,
    },
    action: { type: "pipeline", steps },
    weight: 1.0,
    composition: { type: "atomic" },
    metadata: { source: "rego", version: "1.0.0" },
  };
  return JSON.stringify(gap, null, 2);
}

type RegoRule = { kind: "deny" | "allow"; body: string; msg: string };

function matchPackage(text: string): string {
  const m = text.match(/^\s*package\s+([A-Za-z0-9_.]+)/m);
  if (m === null) {
    return "";
  }
  return m[1];
}

function extractRules(text: string): RegoRule[] {
  const out: RegoRule[] = [];
  const re = /\b(deny|allow)(?:\s*\[[^\]]+\])?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1] === "deny" ? "deny" : "allow";
    const start = m.index + m[0].length;
    let depth = 1;
    let end = start;
    for (let i = start; i < text.length; i++) {
      const ch = text.charAt(i);
      if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = text.slice(start, end).trim();
    const msgMatch = body.match(/msg\s*:?=\s*sprintf\("([^"]+)"/) || body.match(/msg\s*:?=\s*"([^"]+)"/);
    const msg = msgMatch !== null ? msgMatch[1] : "";
    out.push({ kind, body, msg });
  }
  return out;
}
