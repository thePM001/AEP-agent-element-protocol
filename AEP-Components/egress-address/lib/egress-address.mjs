/**
 * One address check for every outbound request of AEP, JavaScript side.
 *
 * The Rust crate aep-egress-address (AEP-Components/egress-address/crate) carries the
 * same range list. The vector file AEP-Components/egress-address/vectors/
 * egress-address-vectors.json holds both to the same answer for every row, so a range
 * added here without the Rust side, or the other way round, fails the vector run.
 *
 * checkUrl reads a URL without any name lookup. checkResolved checks every address of a
 * lookup and returns the set the caller pins its connection to. assertUrlEgress runs both
 * with a lookup function that the caller supplies.
 */

/** Class names as the vector file writes them. */
export const ADDRESS_CLASSES = Object.freeze([
  "public",
  "loopback",
  "unspecified",
  "private",
  "shared",
  "link_local",
  "reserved",
]);

/** An outbound request refused by the address check. */
export class EgressDeny extends Error {
  /**
   * @param {string} kind invalid, scheme, userinfo, name, address, lookup or no_address
   * @param {string} message
   * @param {string | undefined} addressClass the class that closed the request
   */
  constructor(kind, message, addressClass) {
    super(message);
    this.name = "EgressDeny";
    this.kind = kind;
    this.addressClass = addressClass;
  }
}

function ipv4Part(part) {
  if (!part) return null;
  if (/^0x[0-9a-f]*$/i.test(part)) {
    const hex = part.slice(2);
    return hex === "" ? 0 : Number.parseInt(hex, 16);
  }
  if (part.length > 1 && part.startsWith("0")) {
    return /^[0-7]+$/.test(part) ? Number.parseInt(part, 8) : null;
  }
  return /^\d+$/.test(part) ? Number.parseInt(part, 10) : null;
}

/**
 * Read an IPv4 address in every spelling the WHATWG URL standard reads: one to four parts,
 * each decimal, octal with a leading 0 or hexadecimal with 0x. Returns the address as an
 * unsigned 32 bit number, or null when the text is not an IPv4 address.
 */
export function parseIpv4(text) {
  let host = String(text);
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (!host || host.includes(":")) return null;
  const parts = host.split(".");
  if (parts.length > 4) return null;
  const nums = parts.map(ipv4Part);
  if (nums.some((n) => n === null || !Number.isFinite(n))) return null;
  const last = nums[nums.length - 1];
  const head = nums.slice(0, -1);
  if (head.some((n) => n > 255)) return null;
  if (last >= 256 ** (5 - nums.length)) return null;
  let value = last;
  head.forEach((n, i) => {
    value += n * 256 ** (3 - i);
  });
  return value >>> 0;
}

/**
 * Read an IPv6 address, with or without brackets, a zone index or an IPv4 tail. Returns the
 * address as a BigInt, or null when the text is not an IPv6 address.
 */
export function parseIpv6(text) {
  let h = String(text).toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  const zone = h.indexOf("%");
  if (zone >= 0) h = h.slice(0, zone);
  if (!h.includes(":")) return null;
  const lastColon = h.lastIndexOf(":");
  const tail = h.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return null;
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    h = `${h.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (part) => (part === "" ? [] : part.split(":"));
  const head = groupsOf(halves[0]);
  const rest = halves.length === 2 ? groupsOf(halves[1]) : [];
  let groups;
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    if (head.length + rest.length > 7) return null;
    groups = [...head, ...Array(8 - head.length - rest.length).fill("0"), ...rest];
  }
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(g, 16));
  }
  return value;
}

function v4Range(text, len, cls) {
  const net = parseIpv4(text);
  if (net === null) throw new Error(`egress-address: bad range ${text}`);
  return [net, len, cls];
}

function v6Range(text, len, cls) {
  const net = parseIpv6(text);
  if (net === null) throw new Error(`egress-address: bad range ${text}`);
  return [net, len, cls];
}

/** IPv4 ranges that are not public. The Rust crate holds the same list in V4_RANGES. */
export const V4_RANGES = Object.freeze([
  v4Range("0.0.0.0", 8, "unspecified"),
  v4Range("10.0.0.0", 8, "private"),
  v4Range("100.64.0.0", 10, "shared"),
  v4Range("127.0.0.0", 8, "loopback"),
  v4Range("169.254.0.0", 16, "link_local"),
  v4Range("172.16.0.0", 12, "private"),
  v4Range("192.0.0.0", 24, "reserved"),
  v4Range("192.0.2.0", 24, "reserved"),
  v4Range("192.88.99.0", 24, "reserved"),
  v4Range("192.168.0.0", 16, "private"),
  v4Range("198.18.0.0", 15, "reserved"),
  v4Range("198.51.100.0", 24, "reserved"),
  v4Range("203.0.113.0", 24, "reserved"),
  v4Range("224.0.0.0", 4, "reserved"),
  v4Range("240.0.0.0", 4, "reserved"),
]);

/** IPv6 ranges that are not public. The Rust crate holds the same list in V6_RANGES. */
export const V6_RANGES = Object.freeze([
  v6Range("::", 96, "reserved"),
  v6Range("::ffff:0:0:0", 96, "reserved"),
  v6Range("64:ff9b::", 96, "reserved"),
  v6Range("64:ff9b:1::", 48, "reserved"),
  v6Range("100::", 64, "reserved"),
  v6Range("2001::", 23, "reserved"),
  v6Range("2001:db8::", 32, "reserved"),
  v6Range("2002::", 16, "reserved"),
  v6Range("3fff::", 20, "reserved"),
  v6Range("5f00::", 16, "reserved"),
  v6Range("fc00::", 7, "private"),
  v6Range("fe80::", 10, "link_local"),
  v6Range("fec0::", 10, "private"),
  v6Range("ff00::", 8, "reserved"),
]);

const ALL128 = (1n << 128n) - 1n;

function inV4(addr, net, len) {
  if (len === 0) return true;
  const mask = len === 32 ? 0xffffffff : ~((1 << (32 - len)) - 1) >>> 0;
  return ((addr & mask) >>> 0) === ((net & mask) >>> 0);
}

function inV6(addr, net, len) {
  if (len === 0) return true;
  const mask = ALL128 ^ ((1n << BigInt(128 - len)) - 1n);
  return (addr & mask) === (net & mask);
}

/** Class of an IPv4 address given as an unsigned 32 bit number. */
export function classifyV4(addr) {
  for (const [net, len, cls] of V4_RANGES) {
    if (inV4(addr, net, len)) return cls;
  }
  return "public";
}

/** Class of an IPv6 address given as a BigInt. A mapped address takes its IPv4 class. */
export function classifyV6(addr) {
  if (addr === 0n) return "unspecified";
  if (addr === 1n) return "loopback";
  if (addr >> 32n === 0xffffn) return classifyV4(Number(addr & 0xffffffffn));
  for (const [net, len, cls] of V6_RANGES) {
    if (inV6(addr, net, len)) return cls;
  }
  return inV6(addr, 0x2000n << 112n, 3) ? "public" : "reserved";
}

/** Class of an address written as text, or null when the text is no address. */
export function classifyAddress(text) {
  const v6 = parseIpv6(text);
  if (v6 !== null) return classifyV6(v6);
  const v4 = parseIpv4(text);
  if (v4 !== null) return classifyV4(v4);
  return null;
}

/** The policy of the operator. Only the exact value 1 opens a class group. */
export function egressPolicyFromEnv(env = process.env) {
  return {
    allowLoopback: env.AEP_LATTICE_ALLOW_LOOPBACK === "1",
    allowPrivate: env.AEP_LATTICE_ALLOW_PRIVATE === "1",
  };
}

/** Whether the policy admits the class. Reserved addresses are never admitted. */
export function policyAllows(policy, cls) {
  if (cls === "public") return true;
  if (cls === "loopback" || cls === "unspecified") return Boolean(policy.allowLoopback);
  if (cls === "private" || cls === "shared" || cls === "link_local") return Boolean(policy.allowPrivate);
  return false;
}

/** Class of a reserved name, decided without a lookup, or null for any other name. */
export function nameClass(host) {
  const h = String(host).replace(/\.+$/, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return "loopback";
  if (h === "metadata" || h === "metadata.google.internal" || h.endsWith(".internal") || h.endsWith(".local")) {
    return "link_local";
  }
  return null;
}

/**
 * Check everything that needs no lookup: the scheme, the user info, an address literal and
 * the reserved names. Returns { url, host, port, literal } where literal is the address
 * text of a literal host and null for a name.
 */
export function checkUrl(urlInput, policy) {
  let u;
  try {
    u = urlInput instanceof URL ? urlInput : new URL(String(urlInput));
  } catch {
    throw new EgressDeny("invalid", "egress: invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new EgressDeny("scheme", `egress: scheme ${u.protocol} is not http or https`);
  }
  if (u.username || u.password) {
    throw new EgressDeny("userinfo", "egress: user info in the URL is refused");
  }
  const host = u.hostname.toLowerCase();
  if (!host) throw new EgressDeny("invalid", "egress: invalid URL");
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  let literal = null;
  let cls = null;
  const v6 = host.startsWith("[") ? parseIpv6(host) : null;
  if (v6 !== null) {
    literal = host.slice(1, -1);
    cls = classifyV6(v6);
  } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const v4 = parseIpv4(host);
    if (v4 !== null) {
      literal = host;
      cls = classifyV4(v4);
    }
  }
  if (literal !== null) {
    if (!policyAllows(policy, cls)) {
      throw new EgressDeny("address", `egress: address ${literal} is ${cls} and is refused`, cls);
    }
    return { url: u, host: literal, port, literal };
  }
  if (host.startsWith("[")) throw new EgressDeny("invalid", "egress: invalid URL");
  const named = nameClass(host);
  if (named !== null && !policyAllows(policy, named)) {
    throw new EgressDeny("name", `egress: host ${host} is a ${named} name and is refused`, named);
  }
  return { url: u, host, port, literal: null };
}

/**
 * Check every address of a lookup. All must pass, so one refused answer refuses the whole
 * lookup. Returns the addresses the caller pins its connection to.
 */
export function checkResolved(addrs, policy) {
  const list = Array.isArray(addrs) ? addrs.map(String) : [];
  if (list.length === 0) throw new EgressDeny("no_address", "egress: name lookup returned no address");
  for (const addr of list) {
    const cls = classifyAddress(addr);
    if (cls === null) throw new EgressDeny("lookup", `egress: name lookup returned ${addr}, which is no address`);
    if (!policyAllows(policy, cls)) {
      throw new EgressDeny("address", `egress: address ${addr} is ${cls} and is refused`, cls);
    }
  }
  return [...new Set(list)];
}

/**
 * The whole check for one URL: checkUrl, then for a name one lookup through `lookup` and
 * checkResolved. Returns the checked addresses.
 */
export function assertUrlEgress(urlInput, lookup, policy) {
  const target = checkUrl(urlInput, policy);
  if (target.literal !== null) return [target.literal];
  let addrs;
  try {
    addrs = lookup(target.host);
  } catch (err) {
    if (err instanceof EgressDeny) throw err;
    const deny = new EgressDeny("lookup", `egress: name lookup failed: ${String((err && err.message) || err)}`);
    deny.cause = err;
    throw deny;
  }
  return checkResolved(addrs, policy);
}

/** The one action path on which the Base Node sends an outbound request for an agent. */
export const GATEWAY_ACTION_PATH = "gateway:outbound_http";

function latticeMessage(err, urlInput) {
  if (!(err instanceof EgressDeny)) return "lattice-gated-fetch: DNS resolve failed";
  switch (err.kind) {
    case "invalid":
      return "lattice-gated-fetch: invalid URL";
    case "scheme": {
      let protocol;
      try {
        protocol = (urlInput instanceof URL ? urlInput : new URL(String(urlInput))).protocol;
      } catch {
        protocol = "";
      }
      return `lattice-gated-fetch: blocked protocol ${protocol}`;
    }
    case "userinfo":
      return "lattice-gated-fetch: userinfo host spoof blocked";
    case "no_address":
      return "lattice-gated-fetch: DNS resolve returned no addresses";
    case "lookup":
      return "lattice-gated-fetch: DNS resolve failed";
    default:
      return err.addressClass === "loopback" || err.addressClass === "unspecified"
        ? "lattice-gated-fetch: loopback blocked"
        : "lattice-gated-fetch: private/metadata host blocked";
  }
}

/**
 * The address check of the lattice client helpers: assertUrlEgress with the policy of the
 * environment, refusing with the messages those helpers have always given. Returns the
 * checked addresses.
 */
export function assertLatticeUrl(urlInput, lookup, env = process.env) {
  try {
    return assertUrlEgress(urlInput, lookup, egressPolicyFromEnv(env));
  } catch (err) {
    throw new Error(latticeMessage(err, urlInput), { cause: err });
  }
}
