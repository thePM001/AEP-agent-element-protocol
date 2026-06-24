#!/usr/bin/env node
/**
 * AEP 2.8 Lattice Channel transport - the ONLY permitted inter-component wire format.
 * All internal service calls MUST seal payloads via aep-lattice-log before send.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultPaths } from "../../wizard/lib/paths.mjs";

export const DOCK_SUFFIXES = [
  { port: "inference_engine", suffix: "inference" },
  { port: "validation_engine", suffix: "validation" },
  { port: "future_features", suffix: "future" },
  { port: "pera", suffix: "pera" },
  { port: "regulation_module", suffix: "regulation" },
];

export const ALLOWED_DOCK_PORTS = DOCK_SUFFIXES.map((d) => d.port);

export function normalizeDockPort(dockPort, fallback = "validation_engine") {
  const port = String(dockPort ?? fallback).trim();
  if (!ALLOWED_DOCK_PORTS.includes(port)) {
    throw new Error(
      `invalid docking_port: ${port}; allowed: ${ALLOWED_DOCK_PORTS.join(", ")}`,
    );
  }
  return port;
}

export function latticeStrictEnabled(env = process.env) {
  return (env.AEP_LATTICE_STRICT ?? "1") !== "0";
}

function repoLatticeLogCandidates() {
  const here = new URL(".", import.meta.url).pathname;
  const root = join(here, "../../..");
  return [
    join(root, "rust/target/release/aep-lattice-log"),
    join(root, "rust/target/debug/aep-lattice-log"),
    join(root, "target/release/aep-lattice-log"),
    join(root, "target/debug/aep-lattice-log"),
  ];
}

export function resolveLatticeLogBin(env = process.env) {
  if (env.AEP_LATTICE_LOG_BIN) return env.AEP_LATTICE_LOG_BIN;
  if (env.AEP_LATTICE_LOG_CLI) return env.AEP_LATTICE_LOG_CLI;
  for (const candidate of repoLatticeLogCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return defaultPaths().latticeLogBin;
}

export function dockPath(socketBase, dockPort) {
  const port = normalizeDockPort(dockPort);
  const spec = DOCK_SUFFIXES.find((d) => d.port === port);
  return join(socketBase, spec.suffix);
}

export function wasmSandboxSocket(socketBase, env = process.env) {
  return env.WASM_SANDBOX_SOCKET || join(socketBase, "wasm_sandbox");
}

function runEpscomValidateWriting(text, { configPath, latticeLogBin } = {}) {
  const bin = latticeLogBin ?? resolveLatticeLogBin();
  const args = [];
  if (configPath) args.push("--config", configPath);
  args.push("validate-writing");
  const out = execFileSync(bin, args, {
    input: JSON.stringify({ text: String(text ?? "") }),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
  return JSON.parse(out);
}

/** EPSCOM kernel writing.gap enforcement (Base Node aep-lattice-log). */
export function epscomEnforceWriting(text, { configPath, latticeLogBin } = {}) {
  const parsed = runEpscomValidateWriting(text, { configPath, latticeLogBin });
  if (!parsed.ok) {
    const detail = parsed.violations?.map((v) => v.rule).join(", ") || "writing.gap";
    throw new Error(`EPSCOM writing enforcement failed: ${detail}`);
  }
  return parsed;
}

/**
 * Lint governed prose without auto-fix. Used before CCA chat release so violations
 * trigger LLM retry instead of silent kernel correction.
 */
export function lintGovernedProseStrict(text, opts = {}) {
  const raw = String(text ?? "");
  const violations = lintGovernedProse(raw, opts);
  if (violations.length) return violations;

  try {
    const kernel = runEpscomValidateWriting(raw, opts);
    if (!kernel.ok) {
      return (kernel.violations ?? []).map((v) => ({
        rule: v.rule ?? "epscom_kernel",
        message: v.message ?? "EPSCOM kernel rejected draft",
        line: v.line ?? null,
      }));
    }
    if (kernel.violations_corrected > 0) {
      return lintGovernedProse(raw, opts).length
        ? lintGovernedProse(raw, opts)
        : [
            {
              rule: "epscom_kernel",
              message: `EPSCOM kernel required ${kernel.violations_corrected} correction(s) on raw draft`,
            },
          ];
    }
  } catch {
    return lintGovernedProse(raw, opts);
  }
  return [];
}

/** Fail-closed on any writing.gap violation in raw LLM draft (no auto-fix). */
export function assertGovernedProseDraft(text, opts = {}) {
  const violations = lintGovernedProseStrict(text, opts);
  if (!violations.length) return String(text ?? "");
  const err = new Error(
    `EPSCOM writing.gap blocked draft: ${violations.map((v) => v.rule).join(", ")}`,
  );
  err.violations = violations;
  throw err;
}

/** EPSCOM kernel writing.gap enforcement for JSON plan/object values. */
export function epscomEnforceWritingValue(value, { configPath, latticeLogBin } = {}) {
  const bin = latticeLogBin ?? resolveLatticeLogBin();
  const args = [];
  if (configPath) args.push("--config", configPath);
  args.push("enforce-writing-value");
  const out = execFileSync(bin, args, {
    input: JSON.stringify({ value }),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
  const parsed = JSON.parse(out);
  if (!parsed.ok || parsed.value === undefined) {
    throw new Error("EPSCOM enforce-writing-value failed");
  }
  return parsed.value;
}

export const EPSCOM_WRITING_RULES = `Writing conventions (EPSCOM writing mode / writing.gap - mandatory):
- Never use em-dashes, en-dashes or Unicode dash substitutes; use a plain hyphen (-) or rewrite.
- Never use double-hyphen ( -- ) as a sentence separator in prose; use a hyphen (-) or rewrite.
- Never use spaced hyphen as a clause separator ("foo - bar"); use a colon, period or rewrite.
- Never use Oxford commas: write "foo, bar and baz" not "foo, bar, and baz". Same rule for "or".
- Put a single space before ? ! [ ] ( ) and a single space after them before the next word or bracket content.
- Commas, semicolons and double colons (::) are exceptions: attach them directly with no space before.
- Good: "Are you ready ? I am here." "Great ! Let me help." "Hello [ hola ]." and "foo, bar and baz".
- Bad: "Are you ready? I am here." "Hello[hola]." and "foo , bar".
- EPSCOM enforces these rules in the Base Node kernel before governed output is released.`;

const SENTENCE_PUNCT_CHARS = new Set(["?", "!", "\uFF1F", "\uFF01"]);

function normalizeSentencePunct(ch) {
  if (ch === "\uFF1F") return "?";
  if (ch === "\uFF01") return "!";
  return ch;
}

function skipPunctuationSpacingBefore(input, index) {
  const prev = index > 0 ? input[index - 1] : "";
  return prev === "/" || prev === "=" || prev === "&";
}

function punctuationSpacingViolationAt(input, index) {
  const ch = input[index];
  const next = input[index + 1];
  if (!next) return false;
  if (skipPunctuationSpacingBefore(input, index)) return false;
  if (SENTENCE_PUNCT_CHARS.has(ch) && /[A-Za-z]/.test(next)) return true;
  if (ch === "." && /[A-Z]/.test(next)) return true;
  return false;
}

function fixPunctuationWordSpacingOnce(input) {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (punctuationSpacingViolationAt(input, i)) {
      const normalized = SENTENCE_PUNCT_CHARS.has(ch) ? normalizeSentencePunct(ch) : ch;
      out += `${normalized} `;
      continue;
    }
    out += SENTENCE_PUNCT_CHARS.has(ch) ? normalizeSentencePunct(ch) : ch;
  }
  return out;
}

/** Insert missing space after ? ! (incl. fullwidth) when the next character starts a word. */
export function fixPunctuationWordSpacing(text) {
  let out = String(text ?? "");
  for (let pass = 0; pass < 12; pass += 1) {
    const next = fixPunctuationWordSpacingOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

const FORBIDDEN_DASH_CHARS = [
  { char: "\u2014", rule: "no_em_dashes" },
  { char: "\u2013", rule: "no_en_dashes" },
  { char: "\u2015", rule: "no_dash_substitutes" },
  { char: "\u2e3a", rule: "no_dash_substitutes" },
  { char: "\u2e3b", rule: "no_dash_substitutes" },
  { char: "\u2212", rule: "no_minus_as_dash" },
];

const CCA_CLOSING_QUESTION_RE =
  /\b(what would you like|how can i help|what can i help|what should we|anything else|anything specific|is there anything|would you like to|like to work on|like to build|like to configure|need help with|want to (?:do|build|configure|work on))\b[^.!?\n]*\?/i;

/** Rewrite CCA chat closings from questions to declarative prose. */
export function fixCcaDeclarativeClosings(text) {
  let out = String(text ?? "");
  out = out.replace(/\bWhat would you like to do\?/gi, "Tell me what you would like to do.");
  out = out.replace(
    /\bWhat would you like to ([^.!?\n]+)\?/gi,
    "Tell me what you would like to $1.",
  );
  out = out.replace(/\bHow can I help you(?: today)?\?/gi, "Tell me how I can help you today.");
  out = out.replace(/\bWhat can I help you with(?: today)?\?/gi, "Tell me what I can help you with.");
  out = out.replace(/\bWhat should we (do|work on)(?: today)?\?/gi, "Tell me what we should $1 today.");
  out = out.replace(
    /\bAnything else I can help with\?/gi,
    "Tell me if there is anything else I can help with.",
  );
  out = out.replace(
    /\bIs there anything(?: specific)? you(?:'d| would) like to (?:do|work on|build|configure)(?: today)?\?/gi,
    "Tell me what you would like to do today.",
  );
  out = out.replace(
    /\bWould you like to ([^.!?\n]+)\?/gi,
    "Tell me if you would like to $1.",
  );

  const lines = out.split("\n");
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && !lines[lastIdx].trim()) lastIdx -= 1;
  if (lastIdx >= 0) {
    const line = lines[lastIdx];
    const trimmed = line.trim();
    if (trimmed.endsWith("?") && CCA_CLOSING_QUESTION_RE.test(trimmed)) {
      const statement = trimmed.slice(0, -1).trim();
      const lower = statement.charAt(0).toLowerCase() + statement.slice(1);
      lines[lastIdx] = line.replace(trimmed, `Tell me ${lower}.`);
    }
  }
  return lines.join("\n");
}

function lintCcaDeclarativeClosings(text) {
  const violations = [];
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return violations;
  const paragraphs = trimmed.split(/\n\s*\n/);
  const lastParagraph = paragraphs[paragraphs.length - 1] ?? "";
  const lastLine = lastParagraph.split("\n").filter((l) => l.trim()).pop() ?? "";
  if (CCA_CLOSING_QUESTION_RE.test(lastLine)) {
    violations.push({
      rule: "cca_declarative_closing",
      message: "CCA chat must end with declarative prose, not a closing question",
      line: trimmed.split("\n").length,
    });
  }
  return violations;
}

/** Lint governed prose (JS mirror of EPSCOM kernel + Composer fixes). */
export function lintGovernedProse(text, opts = {}) {
  const violations = [];
  const lines = String(text ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/[├└│┌┐┘┬┴┤┼]/.test(line) || /^\s*[|`]/.test(line)) continue;
    for (const dash of FORBIDDEN_DASH_CHARS) {
      if (line.includes(dash.char)) {
        violations.push({
          rule: dash.rule,
          message: `forbidden dash ${dash.char}`,
          line: i + 1,
        });
      }
    }
    if (line.includes(", and ")) {
      violations.push({ rule: "no_oxford_comma", message: 'Oxford comma before "and"', line: i + 1 });
    }
    if (line.includes(", or ")) {
      violations.push({ rule: "no_oxford_comma", message: 'Oxford comma before "or"', line: i + 1 });
    }
    if (line.includes(" -- ") && !/\bgit\b.*\bcheckout\b/.test(line) && !/\b(cargo|npm|node)\b/.test(line)) {
      violations.push({ rule: "no_double_hyphen", message: "double-hyphen prose separator", line: i + 1 });
    }
    for (let j = 0; j < line.length - 1; j += 1) {
      if (punctuationSpacingViolationAt(line, j)) {
        const ch = line[j];
        violations.push({
          rule: "punctuation_word_space",
          message:
            ch === "."
              ? "missing space after sentence punctuation before next word"
              : "missing space after ? or ! before word",
          line: i + 1,
        });
        break;
      }
    }
  }
  if (opts.ccaChat) {
    violations.push(...lintCcaDeclarativeClosings(text));
  }
  return violations;
}

/** Rewrite common LLM "spaced hyphen" em-dash substitutes the kernel does not lint. */
export function fixSpacedHyphenClauseSeparators(text) {
  let out = String(text ?? "");
  out = out.replace(/\*\*([^*\n]+?)\s+-\s+([^*\n]+?)\*\*/g, "**$1: $2**");
  out = out.replace(
    /([.!?)\]}>])\s+-\s+(for|where|which|this|the|a|an|to|with|also|so|if|when|while|because)\b/gi,
    "$1 $2",
  );
  out = out.replace(/([^\n*-])\s+-\s+([A-Z][a-z])/g, "$1: $2");
  out = out.replace(/\b([a-z][a-z0-9]*)\s+-\s+([a-z][a-z0-9]*)\b/gi, "$1 $2");
  return out;
}

function applyGovernedProseFixes(text, opts = {}) {
  let current = String(text ?? "");
  if (opts.ccaChat) {
    current = fixCcaDeclarativeClosings(current);
  }
  current = fixPunctuationWordSpacing(current);
  current = fixSpacedHyphenClauseSeparators(current);
  current = epscomEnforceWriting(current, opts).text;
  return current;
}

/**
 * Release governed prose only when the raw text already satisfies writing.gap.
 * No auto-fix: violations must be corrected by LLM retry, not kernel rewrite.
 */
export function releaseGovernedProseStrict(text, opts = {}) {
  assertGovernedProseDraft(text, opts);
  return {
    text: String(text ?? ""),
    validation: {
      ok: true,
      authority: "epscom-core",
      violations: [],
      passes: 0,
      strict: true,
    },
  };
}

/**
 * Polish + mandatory EPSCOM validation before CCA releases prose.
 * Throws if violations remain after fix passes (fail-closed).
 * @deprecated For CCA chat use releaseGovernedProseStrict (no silent auto-fix).
 */
export function releaseGovernedProse(text, opts = {}) {
  let current = String(text ?? "");
  let passesUsed = 0;
  current = applyGovernedProseFixes(current, opts);
  passesUsed = 1;
  let violations = lintGovernedProse(current, opts);
  const maxPasses = 12;

  for (let pass = 1; pass < maxPasses && violations.length; pass += 1) {
    passesUsed = pass + 1;
    current = applyGovernedProseFixes(current, opts);
    violations = lintGovernedProse(current, opts);
  }

  if (violations.length) {
    const err = new Error(
      `EPSCOM writing.gap blocked release: ${violations.map((v) => v.rule).join(", ")}`,
    );
    err.violations = violations;
    err.corrected_text = current;
    throw err;
  }

  return {
    text: current,
    validation: {
      ok: true,
      authority: "epscom-core",
      violations: [],
      passes: passesUsed,
    },
  };
}

/** @deprecated Use releaseGovernedProse for fail-closed validation. */
export function polishGovernedProse(text, opts = {}) {
  return releaseGovernedProse(text, opts).text;
}

export function buildLatticeFrame(event, { configPath, latticeLogBin } = {}) {
  const bin = latticeLogBin ?? resolveLatticeLogBin();
  const args = [];
  if (configPath) args.push("--config", configPath);
  args.push("build-frame");
  const out = execFileSync(bin, args, {
    input: JSON.stringify(event),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
  const parsed = JSON.parse(out);
  if (!parsed.frame) {
    throw new Error("aep-lattice-log build-frame missing LatticeChannelFrame");
  }
  return parsed;
}

export function sealAndRecordLatticeEvent(event, { configPath, latticeDb, latticeLogBin } = {}) {
  const bin = latticeLogBin ?? resolveLatticeLogBin();
  const args = [];
  if (configPath) args.push("--config", configPath);
  if (latticeDb) args.push("--db", latticeDb);
  args.push("record");
  const out = execFileSync(bin, args, {
    input: JSON.stringify(event),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
  const parsed = JSON.parse(out);
  if (!parsed.ok) {
    throw new Error(parsed.error ?? "aep-lattice-log record failed");
  }
  if (!parsed.frame) {
    throw new Error("aep-lattice-log record did not return sealed frame");
  }
  return parsed;
}

const TLS_DOCK_PORTS = {
  inference: 28425,
  validation: 28426,
  future: 28427,
  regulation: 28428,
};

export function latticeDockEndpoint(socketBase, suffix) {
  if (process.env.AEP_LATTICE_TRANSPORT === "tls") {
    const host = process.env.AEP_LATTICE_TLS_HOST ?? "127.0.0.1";
    const port = TLS_DOCK_PORTS[suffix] ?? 28426;
    return `tls://${host}:${port}`;
  }
  return join(socketBase, suffix);
}

function sendLatticeTls(endpoint, line, timeoutMs) {
  const url = new URL(endpoint);
  const cert = process.env.AEP_LATTICE_TLS_CERT;
  const key = process.env.AEP_LATTICE_TLS_KEY;
  const ca = process.env.AEP_LATTICE_TLS_CA;
  if (!cert || !key || !ca) {
    throw new Error(
      "AEP_LATTICE_TRANSPORT=tls requires AEP_LATTICE_TLS_CERT, AEP_LATTICE_TLS_KEY, AEP_LATTICE_TLS_CA",
    );
  }
  const servername =
    process.env.AEP_LATTICE_TLS_SERVERNAME || "aep-dock-server";
  const payload = line.endsWith("\n") ? line : `${line}\n`;
  const script = `
    const tls = require("node:tls");
    const payload = ${JSON.stringify(payload)};
    const socket = tls.connect({
      host: ${JSON.stringify(url.hostname)},
      port: Number(${JSON.stringify(url.port)}),
      servername: ${JSON.stringify(servername)},
      cert: process.env.AEP_LATTICE_TLS_CERT,
      key: process.env.AEP_LATTICE_TLS_KEY,
      ca: process.env.AEP_LATTICE_TLS_CA,
      rejectUnauthorized: true,
    });
    let buf = "";
    const timer = setTimeout(() => socket.destroy(new Error("lattice tls timeout")), ${timeoutMs});
    socket.on("secureConnect", () => socket.write(payload));
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      if (buf.includes("\\n")) {
        clearTimeout(timer);
        process.stdout.write(buf.split("\\n")[0]);
        socket.end();
      }
    });
    socket.on("error", (err) => { clearTimeout(timer); console.error(err.message); process.exit(1); });
  `;
  return execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      AEP_LATTICE_TLS_CERT: cert,
      AEP_LATTICE_TLS_KEY: key,
      AEP_LATTICE_TLS_CA: ca,
    },
  }).trim();
}

export function sendLatticeLine(endpoint, line, timeoutMs = 8000) {
  if (String(endpoint).startsWith("tls://")) {
    return sendLatticeTls(endpoint, line, timeoutMs);
  }
  const socketPath = endpoint;
  if (!existsSync(socketPath)) {
    throw new Error(`lattice socket not found: ${socketPath}`);
  }
  const script = `
    const net = require("node:net");
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const path = process.env.LATTICE_SOCKET_PATH;
      const timeout = Number(process.env.LATTICE_SOCKET_TIMEOUT || "8000");
      let payload = Buffer.concat(chunks).toString("utf8");
      if (!payload.endsWith("\\n")) payload += "\\n";
      const socket = net.connect({ path });
      let buf = "";
      const timer = setTimeout(() => {
        socket.destroy(new Error("lattice socket timeout"));
      }, timeout);
      socket.on("connect", () => socket.write(payload));
      socket.on("data", (chunk) => {
        buf += chunk.toString();
        if (buf.includes("\\n")) {
          clearTimeout(timer);
          process.stdout.write(buf.split("\\n")[0]);
          socket.end();
        }
      });
      socket.on("error", (err) => {
        clearTimeout(timer);
        console.error(err.message);
        process.exit(1);
      });
    });
  `;
  const payload = line.endsWith("\n") ? line : `${line}\n`;
  return execFileSync(process.execPath, ["-e", script], {
    input: payload,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      LATTICE_SOCKET_PATH: socketPath,
      LATTICE_SOCKET_TIMEOUT: String(timeoutMs),
    },
  }).trim();
}

/** Parse one JSON object from a dock line (handles concatenated JSON blobs). */
export function parseLatticeDockLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) throw new Error("empty dock response");
  try {
    return JSON.parse(trimmed);
  } catch {
    let depth = 0;
    let start = -1;
    for (let i = 0; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (ch === "{") {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          return JSON.parse(trimmed.slice(start, i + 1));
        }
      }
    }
    throw new Error(`Unexpected token in JSON at position ${trimmed.indexOf("{", 1)}`);
  }
}

export function sendLatticeFrame(socketPath, frame, opts = {}) {
  const { trustScore, signerPublicHex, signer_public_hex: signerSnake } = opts;
  const wire = { frame };
  if (trustScore != null) wire.trust_score = trustScore;
  const signer = signerPublicHex ?? signerSnake;
  if (signer) wire.signer_public_hex = signer;
  const line = sendLatticeLine(socketPath, JSON.stringify(wire));
  const resp = parseLatticeDockLine(line);
  if (!resp.ok) {
    throw new Error(resp.error ?? "lattice frame rejected");
  }
  return resp;
}

export function latticeDockRequest(socketBase, dockPort, event, opts = {}) {
  const socketPath = dockPath(socketBase, dockPort);
  const sealed = buildLatticeFrame(event, opts);
  return sendLatticeFrame(socketPath, sealed.frame, {
    ...opts,
    signerPublicHex: sealed.signer_public_hex,
  });
}

export function latticeHealthPing(socketBase, dockPort = "validation_engine", opts = {}) {
  return latticeDockRequest(
    socketBase,
    dockPort,
    {
      agent_id: opts.agentId ?? "lattice-channels",
      channel_id: "ch-lattice-health",
      contract_id: "lattice-channel-default",
      event_type: "LATTICE_HEALTH_PING",
      session_id: opts.sessionId ?? "health-check",
      docking_port: dockPort,
      trust_score: opts.trustScore ?? 700,
      payload: { probe: true },
    },
    opts,
  );
}

/**
 * Gate an outbound HTTP call behind inference_engine lattice audit.
 * External connectors (LLM APIs, Agentstream, registry) MUST use this path.
 */
export async function latticeGatedFetch(
  socketBase,
  meta,
  url,
  init = {},
  opts = {},
) {
  if (!latticeStrictEnabled()) {
    return fetch(url, init);
  }
  const inferencePath = dockPath(socketBase, "inference_engine");
  const event = {
    agent_id: meta.agentId ?? "lattice-gateway",
    channel_id: meta.channelId ?? "ch-outbound-gateway",
    contract_id: meta.contractId ?? "lattice-channel-default",
    event_type: meta.eventType ?? "LATTICE_GATEWAY_REQUEST",
    session_id: meta.sessionId ?? "gateway-session",
    docking_port: "inference_engine",
    trust_score: meta.trustScore ?? 750,
    payload: {
      url: String(url),
      method: init.method ?? "GET",
      gateway: meta.gateway ?? "http",
      ...(meta.payloadExtra ?? {}),
    },
  };
  latticeDockRequest(socketBase, "inference_engine", event, opts);
  if (!existsSync(inferencePath)) {
    throw new Error(`inference_engine dock required for lattice-gated fetch: ${inferencePath}`);
  }
  return fetch(url, init);
}

export function dockPaths(socketBase) {
  return DOCK_SUFFIXES.map((d) => ({
    port: d.port,
    path: join(socketBase, d.suffix),
  }));
}