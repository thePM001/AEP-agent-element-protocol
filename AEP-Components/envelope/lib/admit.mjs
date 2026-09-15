// AEP 2.8 Envelope Admit (Node). Must match aep-envelope crate walls.
// The writing family lives in the one compiled set, so this gate asks the kernel.

import { execFileSync } from "node:child_process";

/** Ask the Base Node kernel for the one compiled writing wall set. */
function kernelClosedWritingRules(text) {
  const bin = process.env.AEP_LATTICE_LOG_BIN || "aep-lattice-log";
  try {
    const out = execFileSync(bin, ["validate-writing"], {
      input: JSON.stringify({ text: String(text ?? "") }),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
    const parsed = JSON.parse(out);
    return (parsed.violations ?? []).map((v) => String(v.rule));
  } catch (e) {
    return ["writing_kernel_unavailable"];
  }
}

function collectStrings(v, out) {
  if (typeof v === "string") {
    out.push(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectStrings(x, out);
    return;
  }
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) collectStrings(x, out);
  }
}

const CRITICAL = new Set(["market:trade:execute", "agent:email:send"]);
const OUTPUTS = new Set([
  "output:notify",
  "output:ui_mutation",
  "output:speech",
  "output:haptic",
]);
const FORBIDDEN = [
  ["system:shutdown", "agent:register"],
  ["system:shutdown", "agent:ready"],
  ["system:shutdown", "agent:propose_action"],
  ["agent:deregister", "agent:propose_action"],
  ["agent:deregister", "agent:interest:register"],
  ["market:trade:execute", "market:price:update"],
  ["agent:email:send", "email:incoming"],
];

function W(name, family, open, reason) {
  return { name, family, open, reason: reason || "" };
}

export function admit(action, snap) {
  const s = snap || {};
  const nodes = s.lattice_nodes || {};
  const satisfied = new Set(s.satisfied_actions || []);
  const walls = [];

  if (!Object.keys(nodes).length) {
    walls.push(W("dag.membership", "dag", false, "empty lattice closes membership"));
    walls.push(W("gap.agent_permission", "gap", false, "empty lattice closes agent_permission"));
  } else if (nodes[action.action_path]) {
    walls.push(W("dag.membership", "dag", true, "node exists"));
  } else {
    walls.push(W("dag.membership", "dag", false, "unknown action_path " + action.action_path));
  }

  const node = nodes[action.action_path];
  if (!node) {
    walls.push(W("dag.parents", "dag", true, "membership wall covers miss"));
  } else {
    const missing = (node.parents || []).filter((p) => !satisfied.has(p));
    if (missing.length) {
      walls.push(W("dag.parents", "dag", false, "missing parents " + missing.join(",")));
    } else {
      walls.push(W("dag.parents", "dag", true, "parents satisfied"));
    }
  }

  if (!Object.keys(nodes).length) {
    walls.push(W("gap.agent_permission", "gap", false, "empty lattice closes agent_permission"));
  } else if (!node) {
    walls.push(W("gap.agent_permission", "gap", true, "membership wall covers miss"));
  } else if (!(node.agent_permission || []).length) {
    walls.push(W("gap.agent_permission", "gap", false, "this agent does not have permission for this action"));
  } else {
    const listed = (node.agent_permission || []).some((item) => {
      if (item === "*") return !!action.agent_id;
      if (item === "unbound") return !action.agent_id;
      return item === action.agent_id;
    });
    if (listed) walls.push(W("gap.agent_permission", "gap", true, "agent permission listed"));
    else walls.push(W("gap.agent_permission", "gap", false, "this agent does not have permission for this action"));
  }

  if (s.gap_scan_payload === false) {
    walls.push(W("gap.writing", "gap", true, "gap scan off"));
  } else {
    const texts = [];
    collectStrings(action.payload, texts);
    texts.push(action.action_path || "");
    let closed = null;
    for (const t of texts) {
      const rules = kernelClosedWritingRules(t);
      if (rules.length) {
        closed = rules;
        break;
      }
    }
    if (closed) {
      walls.push(W("gap.writing", "gap", false, "writing wall closed in payload: " + closed.join(",")));
    } else {
      walls.push(W("gap.writing", "gap", true, "writing ok"));
    }
  }

  const scenes = new Set(s.proven_scene_ids || []);
  if (!scenes.size || !action.scene_id) {
    walls.push(W("scene.membership", "scene", true, "no scene bound"));
  } else if (scenes.has(action.scene_id)) {
    walls.push(W("scene.membership", "scene", true, "scene proven"));
  } else {
    walls.push(W("scene.membership", "scene", false, "scene " + action.scene_id + " not proven"));
  }

  if (!action.agent_ts_ms || !s.bridge_ts_ms) {
    walls.push(W("time.authority", "time", true, "no timestamps"));
  } else {
    const drift = Math.abs(action.agent_ts_ms - s.bridge_ts_ms);
    const maxDrift = s.max_drift_ms ?? 50;
    if (drift > maxDrift) {
      walls.push(W("time.authority", "time", false, "drift exceeds"));
    } else if (s.bridge_ts_ms - action.agent_ts_ms > (s.max_age_ms ?? 5000)) {
      walls.push(W("time.authority", "time", false, "stale event"));
    } else if (action.agent_ts_ms > s.bridge_ts_ms) {
      walls.push(W("time.authority", "time", false, "future stamp"));
    } else {
      walls.push(W("time.authority", "time", true, "time ok"));
    }
  }

  const docks = new Set(s.allowed_docks || []);
  if (!docks.size || !action.dest_dock) {
    walls.push(W("channel.dock", "channel", true, "no dock bound"));
  } else if (docks.has(action.dest_dock)) {
    walls.push(W("channel.dock", "channel", true, "dock allowed"));
  } else {
    walls.push(W("channel.dock", "channel", false, "dock denied"));
  }

  const last = s.actions_last_minute || 0;
  const max = s.max_actions_per_minute ?? 200;
  if (last >= max) walls.push(W("rate.session", "rate", false, "would exceed session rate"));
  else walls.push(W("rate.session", "rate", true, "rate open"));

  const needles = s.scanner_needles || [];
  if (!needles.length) {
    walls.push(W("scanner.bundle", "scanner", true, "no needles"));
  } else {
    const blob = JSON.stringify(action.payload || {}).toLowerCase();
    const hit = needles.find((n) => blob.includes(String(n).toLowerCase()));
    if (hit) walls.push(W("scanner.bundle", "scanner", false, "needle " + hit));
    else walls.push(W("scanner.bundle", "scanner", true, "clean"));
  }

  if (!Object.keys(nodes).length) {
    walls.push(W("rego.restricted", "rego", true, "no lattice"));
  } else if (!nodes[action.action_path]) {
    walls.push(W("rego.restricted", "rego", false, "path not in lattice"));
  } else if (CRITICAL.has(action.action_path) && !((nodes[action.action_path].agent_permission || []).some((item) => (item === "*" && action.agent_id) || item === action.agent_id))) {
    walls.push(W("rego.restricted", "rego", false, "this agent does not have permission for this action"));
  } else if ((s.event_rate || 0) >= (s.event_rate_max ?? 200)) {
    walls.push(W("rego.restricted", "rego", false, "event rate closed"));
  } else {
    walls.push(W("rego.restricted", "rego", true, "restricted fragment open"));
  }

  let seqOk = true;
  for (const [parent, child] of FORBIDDEN) {
    if (action.action_path === child && satisfied.has(parent)) {
      walls.push(W("rego.forbidden_seq", "rego", false, parent + " then " + child));
      seqOk = false;
      break;
    }
  }
  if (seqOk) walls.push(W("rego.forbidden_seq", "rego", true, "no forbidden sequence"));

  if (OUTPUTS.has(action.action_path) && (s.simultaneous_outputs || 0) > 3) {
    walls.push(W("rego.output_ceiling", "rego", false, "simultaneous outputs exceed 3"));
  } else {
    walls.push(W("rego.output_ceiling", "rego", true, "ceiling open"));
  }

  const forbid = new Set(s.forbid_tools || []);
  const permit = new Set(s.permit_tools || []);
  if (!action.tool && !forbid.size) {
    walls.push(W("covenant.tools", "covenant", true, "no tool bound"));
  } else if (action.tool && forbid.has(action.tool)) {
    walls.push(W("covenant.tools", "covenant", false, "tool forbidden"));
  } else if (permit.size && action.tool && !permit.has(action.tool)) {
    walls.push(W("covenant.tools", "covenant", false, "tool not permitted"));
  } else {
    walls.push(W("covenant.tools", "covenant", true, "covenant open"));
  }

  walls.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const closed_walls = walls.filter((w) => !w.open);
  const open_walls = walls.filter((w) => w.open);
  return {
    allow: closed_walls.length === 0,
    closed_walls,
    open_walls,
  };
}

export function planApply(result, snap) {
  if (result.allow) {
    return { increment_rate: true, ledger_allow: true };
  }
  return {
    increment_rate: false,
    ledger_allow: false,
  };
}

export function applySnapshot(snap, plan) {
  if (plan.increment_rate) {
    snap.actions_last_minute = (snap.actions_last_minute || 0) + 1;
    snap.event_rate = (snap.event_rate || 0) + 1;
  }
}
