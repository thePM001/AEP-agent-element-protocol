import { describe, it, expect } from "vitest";
import {
  checkPermission,
  createDefaultPermissions,
  type DataPermissionCheck,
} from "../src/permissions/types.js";

describe("Data Permission System", () => {
  it("sandbox agent can read /tmp but not /etc", () => {
    const perms = createDefaultPermissions("agent-1", "sandbox");
    
    const readTmp: DataPermissionCheck = { action: "read", target: "/tmp/test.txt", agent_permissions: perms };
    expect(checkPermission(readTmp).allowed).toBe(true);
    
    const readEtc: DataPermissionCheck = { action: "read", target: "/etc/passwd", agent_permissions: perms };
    expect(checkPermission(readEtc).allowed).toBe(false);
  });

  it("enterprise agent can access everything", () => {
    const perms = createDefaultPermissions("agent-2", "enterprise");
    
    const readEtc: DataPermissionCheck = { action: "read", target: "/etc/passwd", agent_permissions: perms };
    expect(checkPermission(readEtc).allowed).toBe(true);
    
    const writeRoot: DataPermissionCheck = { action: "write", target: "/opt/config.yaml", agent_permissions: perms };
    expect(checkPermission(writeRoot).allowed).toBe(true);
  });

  it("user agent can read /home but not delete", () => {
    const perms = createDefaultPermissions("agent-3", "user");
    
    const readHome: DataPermissionCheck = { action: "read", target: "/home/user/data.txt", agent_permissions: perms };
    expect(checkPermission(readHome).allowed).toBe(true);
    
    const deleteHome: DataPermissionCheck = { action: "delete", target: "/home/user/data.txt", agent_permissions: perms };
    expect(checkPermission(deleteHome).allowed).toBe(false);
  });

  it("network permissions restrict by host and port", () => {
    const perms = createDefaultPermissions("agent-4", "sandbox");
    
    const allowed: DataPermissionCheck = { action: "network_connect", target: "127.0.0.1:8080", agent_permissions: perms };
    expect(checkPermission(allowed).allowed).toBe(true);
    
    const blocked: DataPermissionCheck = { action: "network_connect", target: "evil.com:666", agent_permissions: perms };
    expect(checkPermission(blocked).allowed).toBe(false);
  });

  it("env permissions restrict variable access", () => {
    const perms = createDefaultPermissions("agent-5", "user");
    
    const allowed: DataPermissionCheck = { action: "env_read", target: "HOME", agent_permissions: perms };
    expect(checkPermission(allowed).allowed).toBe(true);
    
    const blocked: DataPermissionCheck = { action: "env_read", target: "SECRET_KEY", agent_permissions: perms };
    expect(checkPermission(blocked).allowed).toBe(false);
  });

  it("trust rings enforce progressive rate limits", () => {
    const rings = ["sandbox", "user", "system", "enterprise"] as const;
    
    for (let i = 1; i < rings.length; i++) {
      const perms = createDefaultPermissions("agent", rings[i]);
      const prevPerms = createDefaultPermissions("agent", rings[i - 1]);
      expect(perms.rate_limit_per_minute).toBeGreaterThanOrEqual(prevPerms.rate_limit_per_minute);
    }
  });

  it("enterprise ring has universal path access via root path", () => {
    const perms = createDefaultPermissions("agent", "enterprise");
    expect(perms.allowed_paths).toHaveLength(1);
    expect(perms.allowed_paths[0].path).toBe("/");
    expect(perms.allowed_paths[0].read).toBe(true);
    expect(perms.allowed_paths[0].write).toBe(true);
    expect(perms.allowed_paths[0].delete).toBe(true);
  });

  it("rate limits are enforced per ring", () => {
    expect(createDefaultPermissions("a", "sandbox").rate_limit_per_minute).toBe(10);
    expect(createDefaultPermissions("a", "user").rate_limit_per_minute).toBe(60);
    expect(createDefaultPermissions("a", "system").rate_limit_per_minute).toBe(300);
    expect(createDefaultPermissions("a", "enterprise").rate_limit_per_minute).toBe(1000);
  });

  it("unknown action is denied", () => {
    const perms = createDefaultPermissions("agent", "enterprise");
    const result = checkPermission({ action: "unknown" as any, target: "x", agent_permissions: perms });
    expect(result.allowed).toBe(false);
  });
});
