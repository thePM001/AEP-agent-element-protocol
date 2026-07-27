import { z } from "zod";

export const PathPermissionSchema = z.object({
  path: z.string(),
  read: z.boolean().default(true),
  write: z.boolean().default(false),
  delete: z.boolean().default(false),
});

export const NetworkPermissionSchema = z.object({
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  protocols: z.array(z.enum(["tcp", "udp", "http", "https"])).default(["tcp"]),
});

export const EnvPermissionSchema = z.object({
  name: z.string(),
  read: z.boolean().default(true),
});

export const AgentPermissionsSchema = z.object({
  agent_id: z.string(),
  trust_ring: z.enum(["sandbox", "user", "system", "enterprise"]),
  allowed_paths: z.array(PathPermissionSchema).default([]),
  allowed_network: z.array(NetworkPermissionSchema).default([]),
  allowed_env: z.array(EnvPermissionSchema).default([]),
  max_file_size: z.number().int().default(10_485_760),
  rate_limit_per_minute: z.number().int().default(60),
});

export type PathPermission = z.infer<typeof PathPermissionSchema>;
export type NetworkPermission = z.infer<typeof NetworkPermissionSchema>;
export type EnvPermission = z.infer<typeof EnvPermissionSchema>;
export type AgentPermissions = z.infer<typeof AgentPermissionsSchema>;

export const DataPermissionCheckSchema = z.object({
  action: z.enum(["read", "write", "delete", "network_connect", "env_read"]),
  target: z.string(),
  agent_permissions: AgentPermissionsSchema,
  /** Optional byte length for write size enforcement */
  byte_length: z.number().int().nonnegative().optional(),
  /** Optional protocol for network_connect (tcp|udp|http|https) */
  protocol: z.enum(["tcp", "udp", "http", "https"]).optional(),
});

export type DataPermissionCheck = z.infer<typeof DataPermissionCheckSchema>;

export interface PermissionResult {
  allowed: boolean;
  reason: string;
}

/** Per-agent sliding-window rate counters (process-local). */
const rateWindows = new Map<string, { count: number; windowStart: number }>();

/** Normalize paths and match with directory boundary (no /foo matching /foobar). */
function pathAllowed(target: string, allowed: string): boolean {
  const norm = (p: string) => {
    const n = p.replace(/\\/g, "/").replace(/\/+/g, "/");
    if (!n || n === "/") return "";
    return n.replace(/\/$/, "") || "";
  };
  const t = norm(target);
  const a = norm(allowed);
  // Empty allow entry must never grant all paths.
  if (!a || a === "/") return false;
  if (!t) return false;
  if (t.includes("..") || a.includes("..")) return false;
  return t === a || t.startsWith(a.endsWith("/") ? a : a + "/");
}

function parseNetworkTarget(target: string): {
  host: string;
  port: number;
  protocol?: string;
} | null {
  // Forms: host:port | protocol://host:port | [ipv6]:port
  const protoMatch = target.match(/^(tcp|udp|http|https):\/\/(.+)$/i);
  let protocol: string | undefined;
  let rest = target;
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase();
    rest = protoMatch[2];
  }
  if (rest.startsWith("[")) {
    const m = rest.match(/^\[([^\]]+)\]:(\d+)$/);
    if (!m) return null;
    const port = parseInt(m[2], 10);
    if (!Number.isFinite(port)) return null;
    return { host: m[1], port, protocol };
  }
  const idx = rest.lastIndexOf(":");
  if (idx <= 0) return null;
  const host = rest.slice(0, idx);
  const port = parseInt(rest.slice(idx + 1), 10);
  if (!host || !Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { host, port, protocol };
}

function checkRateLimit(agentId: string, limit: number): PermissionResult | null {
  if (!limit || limit <= 0) {
    return { allowed: false, reason: "rate_limit_per_minute must be positive" };
  }
  const now = Date.now();
  let w = rateWindows.get(agentId);
  if (!w || now - w.windowStart > 60_000) {
    w = { count: 0, windowStart: now };
    rateWindows.set(agentId, w);
  }
  if (w.count >= limit) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${w.count}/${limit} actions per minute for agent ${agentId}`,
    };
  }
  w.count += 1;
  return null;
}

export function checkPermission(check: DataPermissionCheck): PermissionResult {
  const perms = check.agent_permissions;

  // MEDIUM: enforce rate_limit_per_minute
  const rateDeny = checkRateLimit(perms.agent_id, perms.rate_limit_per_minute);
  if (rateDeny) return rateDeny;

  switch (check.action) {
    case "read": {
      const match = perms.allowed_paths.find(
        (p) => pathAllowed(check.target, p.path) && p.read
      );
      return match
        ? { allowed: true, reason: `Read access granted for ${check.target}` }
        : { allowed: false, reason: `No read permission for ${check.target}` };
    }

    case "write": {
      const match = perms.allowed_paths.find(
        (p) => pathAllowed(check.target, p.path) && p.write
      );
      if (!match) {
        return { allowed: false, reason: `No write permission for ${check.target}` };
      }
      // MEDIUM: max_file_size enforcement when byte_length provided
      if (check.byte_length !== undefined) {
        if (check.byte_length > perms.max_file_size) {
          return {
            allowed: false,
            reason: `Write size ${check.byte_length} exceeds max_file_size ${perms.max_file_size}`,
          };
        }
      }
      return { allowed: true, reason: `Write access granted for ${check.target}` };
    }

    case "delete": {
      const match = perms.allowed_paths.find(
        (p) => pathAllowed(check.target, p.path) && p.delete
      );
      return match
        ? { allowed: true, reason: `Delete access granted for ${check.target}` }
        : { allowed: false, reason: `No delete permission for ${check.target}` };
    }

    case "network_connect": {
      const parsed = parseNetworkTarget(check.target);
      if (!parsed) {
        return {
          allowed: false,
          reason: `Invalid network target (expected host:port or protocol://host:port): ${check.target}`,
        };
      }
      const proto = check.protocol ?? parsed.protocol;
      const match = perms.allowed_network.find((n) => {
        if (n.host !== parsed.host || n.port !== parsed.port) return false;
        // MEDIUM: honor protocols[] when present
        if (proto) {
          return (n.protocols ?? []).includes(
            proto as "tcp" | "udp" | "http" | "https",
          );
        }
        return true;
      });
      return match
        ? { allowed: true, reason: `Network access granted for ${check.target}` }
        : {
            allowed: false,
            reason: proto
              ? `No network permission for ${check.target} (protocol ${proto})`
              : `No network permission for ${check.target}`,
          };
    }

    case "env_read": {
      const match = perms.allowed_env.find(
        (e) => e.name === check.target && e.read
      );
      return match
        ? { allowed: true, reason: `Env access granted for ${check.target}` }
        : { allowed: false, reason: `No env permission for ${check.target}` };
    }

    default:
      return { allowed: false, reason: `Unknown action: ${check.action}` };
  }
}

export function createDefaultPermissions(
  agentId: string,
  trustRing: "sandbox" | "user" | "system" | "enterprise"
): AgentPermissions {
  // LOW: scope user paths to agent home not all of /home
  const home = `/home/${agentId.replace(/[^a-zA-Z0-9._-]/g, "_") || "agent"}`;

  switch (trustRing) {
    case "sandbox":
      return {
        agent_id: agentId,
        trust_ring: trustRing,
        allowed_paths: [
          { path: "/tmp", read: true, write: true, delete: true },
        ],
        allowed_network: [
          { host: "127.0.0.1", port: 8080, protocols: ["http"] },
        ],
        allowed_env: [
          { name: "HOME", read: true },
          { name: "USER", read: true },
        ],
        max_file_size: 1_048_576,
        rate_limit_per_minute: 10,
      };

    case "user":
      return {
        agent_id: agentId,
        trust_ring: trustRing,
        allowed_paths: [
          { path: "/tmp", read: true, write: true, delete: true },
          { path: home, read: true, write: true, delete: false },
          { path: "/var/www", read: true, write: false, delete: false },
        ],
        allowed_network: [
          { host: "127.0.0.1", port: 8080, protocols: ["http"] },
          { host: "127.0.0.1", port: 3000, protocols: ["http"] },
          { host: "127.0.0.1", port: 443, protocols: ["https"] },
        ],
        allowed_env: [
          { name: "HOME", read: true },
          { name: "USER", read: true },
          { name: "PATH", read: true },
        ],
        max_file_size: 10_485_760,
        rate_limit_per_minute: 60,
      };

    case "system":
      return {
        agent_id: agentId,
        trust_ring: trustRing,
        allowed_paths: [
          { path: "/tmp", read: true, write: true, delete: true },
          { path: home, read: true, write: true, delete: true },
          { path: "/var", read: true, write: true, delete: false },
          { path: "/opt", read: true, write: true, delete: false },
          { path: "/etc", read: true, write: false, delete: false },
        ],
        allowed_network: [
          { host: "127.0.0.1", port: 8080, protocols: ["http", "https"] },
          { host: "0.0.0.0", port: 443, protocols: ["https"] },
        ],
        allowed_env: [
          { name: "HOME", read: true },
          { name: "USER", read: true },
          { name: "PATH", read: true },
          { name: "PYTHONPATH", read: true },
        ],
        max_file_size: 104_857_600,
        rate_limit_per_minute: 300,
      };

    case "enterprise":
      // BL-03: fail-closed defaults (deny write/delete unless explicit grant)
      return {
        agent_id: agentId,
        trust_ring: trustRing,
        allowed_paths: [
          { path: home, read: true, write: false, delete: false },
          { path: "/tmp", read: true, write: true, delete: false },
          { path: "/var/tmp", read: true, write: true, delete: false },
        ],
        allowed_network: [
          { host: "127.0.0.1", port: 443, protocols: ["https"] },
        ],
        allowed_env: [
          { name: "HOME", read: true },
          { name: "USER", read: true },
          { name: "PATH", read: true },
        ],
        max_file_size: 1_073_741_824,
        rate_limit_per_minute: 1000,
      };
  }
}
