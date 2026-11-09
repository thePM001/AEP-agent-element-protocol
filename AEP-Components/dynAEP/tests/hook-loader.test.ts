import { afterEach, describe, expect, it } from "vitest";
import { restoreAll, setEnv } from "./support/fakes.js";
import {
  HOOK_NAME_ALIASES,
  NOOP_HOOK_ENV,
  noopValidationHook,
  registerBuiltinHooks,
  resolveHookName,
} from "../bridge/hook-loader.js";
import {
  ActionLattice,
  HookRegistry as LatticeHookRegistry,
  LatticeFilter,
  type LatticeEvent,
} from "../bridge/lattice/index.js";
import { HookRegistry, type HookResult, type ValidationHook } from "../hooks/interface.js";

const lattice = new ActionLattice({
  aep_version: "1.2",
  dynaep_version: "1.0",
  lattice_revision: 1,
  actions: {
    "agent:review": {
      label: "review",
      category: "agent_action",
      parents: [],
      children: [],
      constraints: [{ type: "custom" }],
      agent_permission: ["*"],
    },
  },
});

const reviewEvent: LatticeEvent = {
  source: "test",
  action_path: "agent:review",
  payload: {},
  bridge_timestamp: 1,
  agent_id: "alice",
};

afterEach(() => {
  restoreAll();
});

describe("resolveHookName", () => {
  it("returns null for empty input", () => {
    expect(resolveHookName(null)).toBeNull();
    expect(resolveHookName(undefined)).toBeNull();
    expect(resolveHookName("")).toBeNull();
    expect(resolveHookName("   ")).toBeNull();
  });

  it("maps aliases and trims", () => {
    expect(resolveHookName("mle")).toBe("mle-validator");
    expect(resolveHookName(" mle-validator ")).toBe("mle-validator");
    expect(resolveHookName("noop")).toBe("noop");
  });

  it("passes unknown names through unchanged", () => {
    expect(resolveHookName(" my-hook ")).toBe("my-hook");
  });

  it("shares the alias table with the lattice", () => {
    expect(HOOK_NAME_ALIASES.mle).toBe("mle-validator");
  });
});

describe("registerBuiltinHooks", () => {
  it("registers the noop hook once", () => {
    const reg = new HookRegistry();
    registerBuiltinHooks(reg);
    registerBuiltinHooks(reg);
    expect(reg.list()).toEqual([{ name: "noop", version: "1.0.0" }]);
    expect(reg.get("noop")).toBe(noopValidationHook);
  });

  it("keeps a host-provided hook with the same name", () => {
    const reg = new HookRegistry();
    const custom: ValidationHook = {
      name: "noop",
      version: "2.0.0",
      async validate(): Promise<HookResult> {
        return { passed: true, score: 1, confidence: 1 };
      },
    };
    reg.register(custom);
    registerBuiltinHooks(reg);
    expect(reg.get("noop")).toBe(custom);
  });

  it("does not provide an MLE hook, so mle configs fail closed", async () => {
    const reg = new HookRegistry();
    registerBuiltinHooks(reg);
    const filter = new LatticeFilter(lattice, reg, "mle");
    const r = await filter.filterAsync(reviewEvent);
    expect(r.passed).toBe(false);
    expect(r.constraints_failed[0]?.reason).toBe("Validation hook 'mle' is not registered");
  });
});

describe("noopValidationHook", () => {
  const node = lattice.get("agent:review");

  it("denies by default", async () => {
    setEnv(NOOP_HOOK_ENV, "");
    if (!node) throw new Error("fixture node missing");
    const r = await noopValidationHook.validate(reviewEvent, lattice, node);
    expect(r).toMatchObject({ passed: false, score: 0, confidence: 1 });
    expect(r.details).toMatch(/denied/);
  });

  it("passes when the env switch is 1", async () => {
    setEnv(NOOP_HOOK_ENV, "1");
    if (!node) throw new Error("fixture node missing");
    const r = await noopValidationHook.validate(reviewEvent, lattice, node);
    expect(r).toMatchObject({ passed: true, score: 1, confidence: 1 });
  });

  it("drives LatticeFilter custom constraints end to end", async () => {
    const reg = new HookRegistry();
    registerBuiltinHooks(reg);
    const filter = new LatticeFilter(lattice, reg, "noop");

    setEnv(NOOP_HOOK_ENV, "0");
    const denied = await filter.filterAsync(reviewEvent);
    expect(denied.passed).toBe(false);
    expect(denied.constraints_failed.at(-1)?.reason).toMatch(/Noop hook denied/);

    setEnv(NOOP_HOOK_ENV, "1");
    const allowed = await filter.filterAsync(reviewEvent);
    expect(allowed.passed).toBe(true);
    expect(allowed.constraints_passed).toContain("hook:noop:1.00");
  });
});

describe("hooks/interface re-exports", () => {
  it("re-exports the lattice HookRegistry class", () => {
    expect(HookRegistry).toBe(LatticeHookRegistry);
  });
});
