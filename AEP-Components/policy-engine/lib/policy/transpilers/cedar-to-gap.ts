export function transpileCedarToGap(cedarSource: string): string {
  if (typeof cedarSource !== "string" || cedarSource.trim().length === 0) {
    throw new Error("Cedar source is empty; refusing pass-through");
  }
  const text = cedarSource.trim();
  const statements = splitCedar(text);
  if (statements.length === 0) {
    throw new Error("Cedar source has no permit or forbid statement");
  }
  const constraints: string[] = [];
  const invariants: Array<Record<string, string>> = [];
  const steps: string[] = [];
  for (let i = 0; i < statements.length; i++) {
    const st = statements[i];
    const effect = st.effect;
    steps.push(effect === "forbid" ? "deny" : "allow");
    if (st.action.length > 0) {
      constraints.push("cedar:action:" + st.action);
    }
    if (st.principal.length > 0) {
      constraints.push("cedar:principal:" + st.principal);
    }
    if (st.resource.length > 0) {
      constraints.push("cedar:resource:" + st.resource);
    }
    if (st.when.length > 0) {
      constraints.push("cedar:when:" + st.when);
    }
    if (st.unless.length > 0) {
      constraints.push("cedar:unless:" + st.unless);
    }
    invariants.push({
      expr: "cedar_effect_" + effect + "_" + String(i + 1),
      lang: "gapdsl",
      severity: effect === "forbid" ? "hard" : "soft",
      description: st.raw.slice(0, 240),
    });
  }
  const gap = {
    address: { domain: "cedar.imported", id: "policy" },
    pattern: {
      guard: "true",
      constraints,
      invariants,
    },
    action: { type: "pipeline", steps },
    weight: 1.0,
    composition: { type: "atomic" },
    metadata: { source: "cedar", version: "1.0.0" },
  };
  return JSON.stringify(gap, null, 2);
}

type CedarStatement = {
  effect: "permit" | "forbid";
  principal: string;
  action: string;
  resource: string;
  when: string;
  unless: string;
  raw: string;
};

function splitCedar(text: string): CedarStatement[] {
  const out: CedarStatement[] = [];
  const re = /(permit|forbid)\s*\(/gi;
  let m: RegExpExecArray | null;
  const starts: Array<{ effect: "permit" | "forbid"; index: number }> = [];
  while ((m = re.exec(text)) !== null) {
    starts.push({
      effect: m[1].toLowerCase() as "permit" | "forbid",
      index: m.index,
    });
  }
  for (let i = 0; i < starts.length; i++) {
    const begin = starts[i].index;
    const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
    const raw = text.slice(begin, end).trim().replace(/;+\s*$/, "");
    out.push(parseOne(starts[i].effect, raw));
  }
  return out;
}

function parseOne(effect: "permit" | "forbid", raw: string): CedarStatement {
  const body = extractParen(raw);
  const fields = splitArgs(body);
  let principal = "";
  let action = "";
  let resource = "";
  for (const f of fields) {
    const t = f.trim();
    if (/^principal\b/i.test(t)) {
      principal = t.replace(/^principal\s*(==)?\s*/i, "").trim();
    } else if (/^action\b/i.test(t)) {
      action = t.replace(/^action\s*(==|in)?\s*/i, "").trim();
    } else if (/^resource\b/i.test(t)) {
      resource = t.replace(/^resource\s*(==|in)?\s*/i, "").trim();
    }
  }
  const when = extractClause(raw, "when");
  const unless = extractClause(raw, "unless");
  return { effect, principal, action, resource, when, unless, raw };
}

function extractParen(raw: string): string {
  const open = raw.indexOf("(");
  if (open < 0) {
    return "";
  }
  let depth = 0;
  for (let i = open; i < raw.length; i++) {
    const ch = raw.charAt(i);
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(open + 1, i);
      }
    }
  }
  return raw.slice(open + 1);
}

function splitArgs(body: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body.charAt(i);
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      cur += ch;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) {
    out.push(cur);
  }
  return out;
}

function extractClause(raw: string, word: string): string {
  const re = new RegExp("\\b" + word + "\\s*\\{", "i");
  const m = re.exec(raw);
  if (m === null) {
    return "";
  }
  const start = m.index + m[0].length;
  let depth = 1;
  for (let i = start; i < raw.length; i++) {
    const ch = raw.charAt(i);
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, i).trim();
      }
    }
  }
  return raw.slice(start).trim();
}
