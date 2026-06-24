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
});

export type DataPermissionCheck = z.infer<typeof DataPermissionCheckSchema>;

export interface PermissionResult {
  allowed: boolean;
  reason: string;
}

export function checkPermission(check: DataPermissionCheck): PermissionResult {
  const perms = check.agent_permissions;

  switch (check.action) {
    case "read": {
      const match = perms.allowed_paths.find(
        (p) => check.target.startsWith(p.path) && p.read
      );
      return match
        ? { allowed: true, reason: `Read access granted for ${check.target}` }
        : { allowed: false, reason: `No read permission for ${check.target}` };
    }

    case "write": {
      const match = perms.allowed_paths.find(
        (p) => check.target.startsWith(p.path) && p.write
      );
      return match
        ? { allowed: true, reason: `Write access granted for ${check.target}` }
        : { allowed: false, reason: `No write permission for ${check.target}` };
    }

    case "delete": {
      const match = perms.allowed_paths.find(
        (p) => check.target.startsWith(p.path) && p.delete
      );
      return match
        ? { allowed: true, reason: `Delete access granted for ${check.target}` }
        : { allowed: false, reason: `No delete permission for ${check.target}` };
    }

    case "network_connect": {
      const [host, portStr] = check.target.split(":");
      const port = parseInt(portStr, 10);
      const match = perms.allowed_network.find(
        (n) => n.host === host && n.port === port
      );
      return match
        ? { allowed: true, reason: `Network access granted for ${check.target}` }
        : { allowed: false, reason: `No network permission for ${check.target}` };
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
          { path: "/home", read: true, write: true, delete: false },
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
          { path: "/home", read: true, write: true, delete: true },
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
      return {
        agent_id: agentId,
        trust_ring: trustRing,
        allowed_paths: [
          { path: "/", read: true, write: true, delete: true },
        ],
        allowed_network: [
          { host: "0.0.0.0", port: 443, protocols: ["http", "https", "tcp"] },
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
