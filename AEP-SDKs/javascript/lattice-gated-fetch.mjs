/**
 * AEP 2.8 JavaScript SDK - lattice-gated outbound HTTP.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function latticeStrictEnabled() {
  const v = process.env.AEP_LATTICE_STRICT ?? "1";
  if (v === "0") {
    if (process.env.AEP_LATTICE_STRICT_DEV === "1") return false;
    throw new Error(
      "AEP_LATTICE_STRICT=0 refused outside AEP_LATTICE_STRICT_DEV=1 (fail-closed)",
    );
  }
  return true;
}

function ssrfPolicyFromEnv(env = process.env) {
  return {
    allowLoopback: env.AEP_LATTICE_ALLOW_LOOPBACK === "1",
    allowPrivate: env.AEP_LATTICE_ALLOW_PRIVATE === "1",
  };
}

function parseIpv4NumericPart(part) {
  if (!part) return null;
  if (/^0x[0-9a-f]+$/i.test(part)) {
    const n = Number.parseInt(part.slice(2), 16);
    return Number.isFinite(n) ? n >>> 0 : null;
  }
  if (part.length > 1 && part.startsWith("0") && /^[0-7]+$/.test(part)) {
    const n = Number.parseInt(part, 8);
    return Number.isFinite(n) ? n >>> 0 : null;
  }
  if (/^\d+$/.test(part)) {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n >>> 0 : null;
  }
  return null;
}

function parseWeirdIpv4(host) {
  if (!host || host.includes(":")) return null;
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums = parts.map(parseIpv4NumericPart);
  if (nums.some((n) => n === null)) return null;
  const typed = nums;
  if (typed.length === 1) {
    const n = typed[0] >>> 0;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  if (typed.length === 2) {
    const [a, b] = typed;
    if (a > 255 || b > 0xffffff) return null;
    return [a, (b >>> 16) & 255, (b >>> 8) & 255, b & 255];
  }
  if (typed.length === 3) {
    const [a, b, c] = typed;
    if (a > 255 || b > 255 || c > 0xffff) return null;
    return [a, b, (c >>> 8) & 255, c & 255];
  }
  const [a, b, c, d] = typed;
  if (a > 255 || b > 255 || c > 255 || d > 255) return null;
  return [a, b, c, d];
}

function classifyV4(octets) {
  const a = octets[0];
  const b = octets[1];
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "linklocal";
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return "private";
  if (a === 255 && b === 255 && octets[2] === 255 && octets[3] === 255) return "private";
  return "public";
}

function parseIpv6MappedV4(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const dotted = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return parseWeirdIpv4(dotted[1]);
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
  }
  return null;
}

function classifyIpv6(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = parseIpv6MappedV4(h);
  if (mapped) return classifyV4(mapped);
  if (h === "::1") return "loopback";
  if (h === "::" || h === "0:0:0:0:0:0:0:0") return "unspecified";
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return "private";
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return "linklocal";
  return "public";
}

function denyClass(cls, policy) {
  if (cls === "public") return;
  if (cls === "loopback" || cls === "unspecified") {
    if (!policy.allowLoopback) throw new Error("lattice-gated-fetch: loopback blocked");
    return;
  }
  if (!policy.allowPrivate) throw new Error("lattice-gated-fetch: private/metadata host blocked");
}

function isMetadataName(host) {
  const h = host.replace(/\.+$/, "").toLowerCase();
  return h === "metadata" || h === "metadata.google.internal" || h.endsWith(".internal") || h.endsWith(".local");
}

function defaultLookup(host) {
  const script =
    "const dns=require('node:dns');dns.lookup(" +
    JSON.stringify(host) +
    ",{all:true,verbatim:true},(err,addrs)=>{if(err){process.stderr.write(String(err.message||err));process.exit(2);}process.stdout.write(JSON.stringify((addrs||[]).map(a=>a.address)));});";
  try {
    const out = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(String(out).trim());
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("empty");
    return parsed.map(String);
  } catch {
    throw new Error("lattice-gated-fetch: DNS resolve failed");
  }
}

function classifyAddressString(addr) {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, "");
  if (a.includes(":")) return classifyIpv6(a);
  const v4 = parseWeirdIpv4(a);
  if (v4) return classifyV4(v4);
  throw new Error("lattice-gated-fetch: DNS resolve failed");
}

export function ssrfPolicyFromEnv(env = process.env) {
  return {
    allowLoopback: env.AEP_LATTICE_ALLOW_LOOPBACK === "1",
    allowPrivate: env.AEP_LATTICE_ALLOW_PRIVATE === "1",
  };
}

function parseIpv4NumericPart(part) {
  if (!part) return null;
  if (/^0x[0-9a-f]+$/i.test(part)) {
    const n = Number.parseInt(part.slice(2), 16);
    return Number.isFinite(n) ? n >>> 0 : null;
  }
  if (part.length > 1 && part.startsWith("0") && /^[0-7]+$/.test(part)) {
    const n = Number.parseInt(part, 8);
    return Number.isFinite(n) ? n >>> 0 : null;
  }
  if (/^\d+$/.test(part)) {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n >>> 0 : null;
  }
  return null;
}

function parseWeirdIpv4(host) {
  if (!host || host.includes(":")) return null;
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums = parts.map(parseIpv4NumericPart);
  if (nums.some((n) => n === null)) return null;
  const typed = nums;
  if (typed.length === 1) {
    const n = typed[0] >>> 0;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  if (typed.length === 2) {
    const [a, b] = typed;
    if (a > 255 || b > 0xffffff) return null;
    return [a, (b >>> 16) & 255, (b >>> 8) & 255, b & 255];
  }
  if (typed.length === 3) {
    const [a, b, c] = typed;
    if (a > 255 || b > 255 || c > 0xffff) return null;
    return [a, b, (c >>> 8) & 255, c & 255];
  }
  const [a, b, c, d] = typed;
  if (a > 255 || b > 255 || c > 255 || d > 255) return null;
  return [a, b, c, d];
}

function classifyV4(octets) {
  const a = octets[0];
  const b = octets[1];
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "linklocal";
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return "private";
  if (a === 255 && b === 255 && octets[2] === 255 && octets[3] === 255) return "private";
  return "public";
}

function parseIpv6MappedV4(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const dotted = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return parseWeirdIpv4(dotted[1]);
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
  }
  return null;
}

function classifyIpv6(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = parseIpv6MappedV4(h);
  if (mapped) return classifyV4(mapped);
  if (h === "::1") return "loopback";
  if (h === "::" || h === "0:0:0:0:0:0:0:0") return "unspecified";
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return "private";
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return "linklocal";
  return "public";
}

function denyClass(cls, policy) {
  if (cls === "public") return;
  if (cls === "loopback" || cls === "unspecified") {
    if (!policy.allowLoopback) throw new Error("lattice-gated-fetch: loopback blocked");
    return;
  }
  if (!policy.allowPrivate) throw new Error("lattice-gated-fetch: private/metadata host blocked");
}

function isMetadataName(host) {
  const h = host.replace(/\.+$/, "").toLowerCase();
  return h === "metadata" || h === "metadata.google.internal" || h.endsWith(".internal") || h.endsWith(".local");
}

function defaultLookup(host) {
  const script =
    "const dns=require('node:dns');dns.lookup(" +
    JSON.stringify(host) +
    ",{all:true,verbatim:true},(err,addrs)=>{if(err){process.stderr.write(String(err.message||err));process.exit(2);}process.stdout.write(JSON.stringify((addrs||[]).map(a=>a.address)));});";
  try {
    const out = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(String(out).trim());
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("empty");
    return parsed.map(String);
  } catch {
    throw new Error("lattice-gated-fetch: DNS resolve failed");
  }
}

function classifyAddressString(addr) {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, "");
  if (a.includes(":")) return classifyIpv6(a);
  const v4 = parseWeirdIpv4(a);
  if (v4) return classifyV4(v4);
  throw new Error("lattice-gated-fetch: DNS resolve failed");
}

function ssrfPolicyFromEnv(env = process.env) {
  return {
    allowLoopback: env.AEP_LATTICE_ALLOW_LOOPBACK === "1",
    allowPrivate: env.AEP_LATTICE_ALLOW_PRIVATE === "1",
  };
}

function parseIpv4NumericPart(part) {
  if (!part) return null;
  if (/^0x[0-9a-f]+$/i.test(part)) {
    const n = Number.parseInt(part.slice(2), 16);
    return Number.isFinite(n) ? n >>> 0 : null;
  }
  if (part.length > 1 && part.startsWith("0") && /^[0-7]+$/.test(part)) {
    const n = Number.parseInt(part, 8);
    return Number.isFinite(n) ? n >>> 0 : null;
  }
  if (/^\d+$/.test(part)) {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n >>> 0 : null;
  }
  return null;
}

function parseWeirdIpv4(host) {
  if (!host || host.includes(":")) return null;
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums = parts.map(parseIpv4NumericPart);
  if (nums.some((n) => n === null)) return null;
  const typed = nums;
  if (typed.length === 1) {
    const n = typed[0] >>> 0;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  if (typed.length === 2) {
    const [a, b] = typed;
    if (a > 255 || b > 0xffffff) return null;
    return [a, (b >>> 16) & 255, (b >>> 8) & 255, b & 255];
  }
  if (typed.length === 3) {
    const [a, b, c] = typed;
    if (a > 255 || b > 255 || c > 0xffff) return null;
    return [a, b, (c >>> 8) & 255, c & 255];
  }
  const [a, b, c, d] = typed;
  if (a > 255 || b > 255 || c > 255 || d > 255) return null;
  return [a, b, c, d];
}

function classifyV4(octets) {
  const a = octets[0];
  const b = octets[1];
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "linklocal";
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return "private";
  if (a === 255 && b === 255 && octets[2] === 255 && octets[3] === 255) return "private";
  return "public";
}

function parseIpv6MappedV4(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const dotted = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return parseWeirdIpv4(dotted[1]);
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
  }
  return null;
}

function classifyIpv6(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = parseIpv6MappedV4(h);
  if (mapped) return classifyV4(mapped);
  if (h === "::1") return "loopback";
  if (h === "::" || h === "0:0:0:0:0:0:0:0") return "unspecified";
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return "private";
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return "linklocal";
  return "public";
}

function denyClass(cls, policy) {
  if (cls === "public") return;
  if (cls === "loopback" || cls === "unspecified") {
    if (!policy.allowLoopback) throw new Error("lattice-gated-fetch: loopback blocked");
    return;
  }
  if (!policy.allowPrivate) throw new Error("lattice-gated-fetch: private/metadata host blocked");
}

function isMetadataName(host) {
  const h = host.replace(/\.+$/, "").toLowerCase();
  return h === "metadata" || h === "metadata.google.internal" || h.endsWith(".internal") || h.endsWith(".local");
}

function defaultLookup(host) {
  const script =
    "const dns=require('node:dns');dns.lookup(" +
    JSON.stringify(host) +
    ",{all:true,verbatim:true},(err,addrs)=>{if(err){process.stderr.write(String(err.message||err));process.exit(2);}process.stdout.write(JSON.stringify((addrs||[]).map(a=>a.address)));});";
  try {
    const out = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(String(out).trim());
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("empty");
    return parsed.map(String);
  } catch {
    throw new Error("lattice-gated-fetch: DNS resolve failed");
  }
}

function classifyAddressString(addr) {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, "");
  if (a.includes(":")) return classifyIpv6(a);
  const v4 = parseWeirdIpv4(a);
  if (v4) return classifyV4(v4);
  throw new Error("lattice-gated-fetch: DNS resolve failed");
}

export function ssrfPolicyFromEnv(env = process.env) {
  return {
    allowLoopback: env.AEP_LATTICE_ALLOW_LOOPBACK === "1",
    allowPrivate: env.AEP_LATTICE_ALLOW_PRIVATE === "1",
  };
}

function parseIpv4NumericPart(part) {
  if (!part) return null;
  if (/^0x[0-9a-f]+$/i.test(part)) {
    const n = Number.parseInt(part.slice(2), 16);
    return Number.isFinite(n) ? n >>> 0 : null;
  }
  if (part.length > 1 && part.startsWith("0") && /^[0-7]+$/.test(part)) {
    const n = Number.parseInt(part, 8);
    return Number.isFinite(n) ? n >>> 0 : null;
  }
  if (/^\d+$/.test(part)) {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n >>> 0 : null;
  }
  return null;
}

function parseWeirdIpv4(host) {
  if (!host || host.includes(":")) return null;
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums = parts.map(parseIpv4NumericPart);
  if (nums.some((n) => n === null)) return null;
  const typed = nums;
  if (typed.length === 1) {
    const n = typed[0] >>> 0;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  if (typed.length === 2) {
    const [a, b] = typed;
    if (a > 255 || b > 0xffffff) return null;
    return [a, (b >>> 16) & 255, (b >>> 8) & 255, b & 255];
  }
  if (typed.length === 3) {
    const [a, b, c] = typed;
    if (a > 255 || b > 255 || c > 0xffff) return null;
    return [a, b, (c >>> 8) & 255, c & 255];
  }
  const [a, b, c, d] = typed;
  if (a > 255 || b > 255 || c > 255 || d > 255) return null;
  return [a, b, c, d];
}

function classifyV4(octets) {
  const a = octets[0];
  const b = octets[1];
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "linklocal";
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return "private";
  if (a === 255 && b === 255 && octets[2] === 255 && octets[3] === 255) return "private";
  return "public";
}

function parseIpv6MappedV4(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const dotted = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return parseWeirdIpv4(dotted[1]);
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
  }
  return null;
}

function classifyIpv6(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = parseIpv6MappedV4(h);
  if (mapped) return classifyV4(mapped);
  if (h === "::1") return "loopback";
  if (h === "::" || h === "0:0:0:0:0:0:0:0") return "unspecified";
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return "private";
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return "linklocal";
  return "public";
}

function denyClass(cls, policy) {
  if (cls === "public") return;
  if (cls === "loopback" || cls === "unspecified") {
    if (!policy.allowLoopback) throw new Error("lattice-gated-fetch: loopback blocked");
    return;
  }
  if (!policy.allowPrivate) throw new Error("lattice-gated-fetch: private/metadata host blocked");
}

function isMetadataName(host) {
  const h = host.replace(/\.+$/, "").toLowerCase();
  return h === "metadata" || h === "metadata.google.internal" || h.endsWith(".internal") || h.endsWith(".local");
}

function defaultLookup(host) {
  const script =
    "const dns=require('node:dns');dns.lookup(" +
    JSON.stringify(host) +
    ",{all:true,verbatim:true},(err,addrs)=>{if(err){process.stderr.write(String(err.message||err));process.exit(2);}process.stdout.write(JSON.stringify((addrs||[]).map(a=>a.address)));});";
  try {
    const out = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(String(out).trim());
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("empty");
    return parsed.map(String);
  } catch {
    throw new Error("lattice-gated-fetch: DNS resolve failed");
  }
}

function classifyAddressString(addr) {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, "");
  if (a.includes(":")) return classifyIpv6(a);
  const v4 = parseWeirdIpv4(a);
  if (v4) return classifyV4(v4);
  throw new Error("lattice-gated-fetch: DNS resolve failed");
}

export function assertUrlNotSsrf(urlInput, lookup = defaultLookup, env = process.env) {
  let u;
  try {
    u = typeof urlInput === "string" ? new URL(urlInput) : urlInput;
  } catch {
    throw new Error("lattice-gated-fetch: invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("lattice-gated-fetch: blocked protocol " + u.protocol);
  }
  if (u.username || u.password) {
    throw new Error("lattice-gated-fetch: userinfo host spoof blocked");
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) throw new Error("lattice-gated-fetch: invalid URL");
  const policy = ssrfPolicyFromEnv(env);
  if (isMetadataName(host)) {
    denyClass("private", policy);
    return;
  }
  const mapped = parseIpv6MappedV4(host);
  if (mapped) {
    denyClass(classifyV4(mapped), policy);
    return;
  }
  if (host.includes(":")) {
    denyClass(classifyIpv6(host), policy);
    return;
  }
  const weird = parseWeirdIpv4(host);
  if (weird) {
    denyClass(classifyV4(weird), policy);
    return;
  }
  const addrs = lookup(host);
  if (!addrs || addrs.length === 0) {
    throw new Error("lattice-gated-fetch: DNS resolve returned no addresses");
  }
  for (const addr of addrs) denyClass(classifyAddressString(addr), policy);
}

export function resolveSocketBase() {
  if (process.env.AEP_SOCKET_BASE) return process.env.AEP_SOCKET_BASE;
  const data = process.env.AEP_DATA || join(homedir(), ".aep");
  return join(data, "sockets");
}

export function resolveLatticeLogBin() {
  return process.env.AEP_LATTICE_LOG_BIN || process.env.AEP_LATTICE_LOG_CLI || "aep-lattice-log";
}

function resolveConfigPath() {
  const data = process.env.AEP_DATA || join(homedir(), ".aep");
  const path = join(data, "base-node.json");
  return existsSync(path) ? path : undefined;
}

export function buildLatticeFrame(event) {
  const bin = resolveLatticeLogBin();
  const args = [];
  const configPath = resolveConfigPath();
  if (configPath) args.push("--config", configPath);
  args.push("build-frame");
  const out = execFileSync(bin, args, {
    input: JSON.stringify(event),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const text = typeof out === "string" ? out : out.toString("utf8");
  const parsed = JSON.parse(text.trim());
  if (!parsed.frame) {
    throw new Error("aep-lattice-log build-frame missing LatticeChannelFrame");
  }
  return parsed;
}

function dockSuffix(dockPort) {
  if (dockPort === "inference_engine") return "inference";
  if (dockPort === "validation_engine") return "validation";
  if (dockPort === "future_features") return "future";
  if (dockPort === "regulation_module") return "regulation";
  return dockPort;
}

function sendLatticeLine(socketPath, line, timeoutMs = 8000) {
  if (!existsSync(socketPath)) {
    throw new Error(`lattice socket not found: ${socketPath}`);
  }
  const script = `
    const net = require("node:net");
    const path = ${JSON.stringify(socketPath)};
    const payload = ${JSON.stringify(`${line}\n`)};
    const timeout = ${timeoutMs};
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
  `;
  const response = execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return (typeof response === "string" ? response : response.toString("utf8")).trim();
}

function responseFromDockAllow(resp) {
  if (!resp || resp.ok !== true) {
    throw new Error((resp && resp.error) || "lattice frame rejected");
  }
  const http = resp.http;
  if (!http) {
    throw new Error("lattice-gated-fetch: dock allow did not return http");
  }
  const raw = String(http.body_b64 || "");
  let body = new Uint8Array(0);
  if (raw) {
    const bin = atob(raw);
    body = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) body[i] = bin.charCodeAt(i);
  }
  const headers = new Headers();
  const pairs = Array.isArray(http.headers) ? http.headers : [];
  for (const pair of pairs) {
    if (Array.isArray(pair) && pair.length >= 2) headers.append(String(pair[0]), String(pair[1]));
  }
  return new Response(body, { status: Number(http.status) || 0, statusText: String(http.status_text || ""), headers });
}

function latticeDockRequest(socketBase, dockPort, event) {
  const socketPath = join(socketBase, dockSuffix(dockPort));
  const sealed = buildLatticeFrame(event);
  const wire = JSON.stringify({ frame: sealed.frame });
  const line = sendLatticeLine(socketPath, wire);
  const resp = JSON.parse(line);
  if (!resp.ok) {
    throw new Error(resp.error ?? "lattice frame rejected");
  }
  return resp;
}

export async function latticeGatedFetch(url, init = {}, meta = {}, socketBase) {
  assertUrlNotSsrf(url);
  if (!latticeStrictEnabled()) {
    return fetch(url, init);
  }
  const base = socketBase ?? resolveSocketBase();
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
  const resp = latticeDockRequest(base, "inference_engine", event);
  const inferencePath = join(base, "inference");
  if (!existsSync(inferencePath)) {
    throw new Error(`inference_engine dock required for lattice-gated fetch: ${inferencePath}`);
  }
  return responseFromDockAllow(resp);
}